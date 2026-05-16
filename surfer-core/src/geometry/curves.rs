use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

#[inline]
pub fn evaluate_curve_derivative(curve: &BezierCurveData, t: f32) -> Vec3 {
    let num_segments = curve.control_points.len().saturating_sub(1);
    if num_segments == 0 {
        return Vec3::ZERO;
    }
    let num_segments_f = num_segments as f32;
    let scaled_t = t * num_segments_f;
    let mut segment_idx = scaled_t.floor() as usize;
    if segment_idx >= num_segments {
        segment_idx = num_segments - 1;
    }
    let local_t = scaled_t - segment_idx as f32;

    let p0 = curve.control_points[segment_idx];
    let p1 = curve.control_points[segment_idx + 1];
    let t0 = curve
        .tangents2
        .get(segment_idx)
        .copied()
        .unwrap_or_else(|| p0.lerp(p1, 1.0 / 3.0));
    let t1 = curve
        .tangents1
        .get(segment_idx + 1)
        .copied()
        .unwrap_or_else(|| p0.lerp(p1, 2.0 / 3.0));

    let weights = curve.weights.as_ref().and_then(|w| {
        if w.len() > segment_idx + 1 {
            Some((w[segment_idx], 1.0, 1.0, w[segment_idx + 1]))
        } else {
            None
        }
    });

    let local_d1 = if let Some((w0, w1, w2, w3)) = weights {
        crate::bezier::evaluate_rational_first_derivative(p0, t0, t1, p1, w0, w1, w2, w3, local_t)
    } else {
        crate::bezier::evaluate_bezier_first_derivative(p0, t0, t1, p1, local_t)
    };

    local_d1 * num_segments_f
}

#[inline]
pub fn evaluate_curve(curve: &BezierCurveData, t: f32) -> Vec3 {
    let num_segments = curve.control_points.len().saturating_sub(1);
    if num_segments == 0 {
        return curve.control_points.first().copied().unwrap_or(Vec3::ZERO);
    }
    let scaled_t = t * num_segments as f32;
    let mut segment_idx = scaled_t.floor() as usize;
    if segment_idx >= num_segments {
        segment_idx = num_segments - 1;
    }
    let local_t = scaled_t - segment_idx as f32;

    let p0 = curve.control_points[segment_idx];
    let p1 = curve.control_points[segment_idx + 1];
    let t0 = curve
        .tangents2
        .get(segment_idx)
        .copied()
        .unwrap_or_else(|| p0.lerp(p1, 1.0 / 3.0));
    let t1 = curve
        .tangents1
        .get(segment_idx + 1)
        .copied()
        .unwrap_or_else(|| p0.lerp(p1, 2.0 / 3.0));

    let weights = curve.weights.as_ref().and_then(|w| {
        if w.len() > segment_idx + 1 {
            Some((w[segment_idx], 1.0, 1.0, w[segment_idx + 1]))
        } else {
            None
        }
    });

    if let Some((w0, w1, w2, w3)) = weights {
        crate::bezier::evaluate_rational_bezier_cubic(p0, t0, t1, p1, w0, w1, w2, w3, local_t)
    } else {
        crate::bezier::evaluate_bezier_cubic(p0, t0, t1, p1, local_t)
    }
}

pub struct BoardBounds {
    pub nose_z: f32,
    pub tip_z: f32,
    pub notch_z: f32,
    pub tip_t: f32,
}

pub fn get_board_bounds(model: &BoardModel) -> BoardBounds {
    let default_bounds = BoardBounds {
        nose_z: 0.0,
        tip_z: 0.0,
        notch_z: 0.0,
        tip_t: 1.0,
    };
    let outline = match &model.outline {
        Some(o) => o,
        None => return default_bounds,
    };
    if outline.control_points.is_empty() {
        return default_bounds;
    }

    let out_nose_z = evaluate_curve(outline, 0.0).z;
    let notch_z = evaluate_curve(outline, 1.0).z;

    let mut out_tip_z = f32::NEG_INFINITY;
    let mut tip_t = 1.0;
    let steps = 50;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(outline, t);
        if p.z > out_tip_z {
            out_tip_z = p.z;
            tip_t = t;
        }
    }

    let mut t_search = tip_t;
    let mut step_size = 1.0 / steps as f32;
    for _ in 0..15 {
        step_size /= 2.0;
        let t_left = 0.0_f32.max(t_search - step_size);
        let t_right = 1.0_f32.min(t_search + step_size);
        let p_left = evaluate_curve(outline, t_left);
        let p_right = evaluate_curve(outline, t_right);
        if p_left.z > out_tip_z {
            out_tip_z = p_left.z;
            t_search = t_left;
        } else if p_right.z > out_tip_z {
            out_tip_z = p_right.z;
            t_search = t_right;
        }
    }
    tip_t = t_search;

    // Use Rocker for absolute Z bounds to prevent amputation when outline caps are stripped
    let nose_z = if let Some(rb) = &model.rocker_bottom {
        evaluate_curve(rb, 0.0).z.min(out_nose_z)
    } else {
        out_nose_z
    };

    let mut tip_z = if let Some(rb) = &model.rocker_bottom {
        evaluate_curve(rb, 1.0).z.max(out_tip_z)
    } else {
        out_tip_z
    };

    // If the rocker is somehow shorter than the outline, fall back to the outline's tip
    if out_tip_z > tip_z {
        tip_z = out_tip_z;
    }

    BoardBounds {
        nose_z,
        tip_z,
        notch_z,
        tip_t,
    }
}

fn evaluate_bezier_t_at_z_robust(curve: &BezierCurveData, target_z: f32, hint_t: f32) -> f32 {
    let mut best_t = hint_t;
    let mut min_z_err = f32::INFINITY;
    let steps = 50;

    // 1. Scan the grid
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(curve, t);
        let z_err = (p.z - target_z).abs();

        if z_err < min_z_err - 1e-4 {
            min_z_err = z_err;
            best_t = t;
        } else if (z_err - min_z_err).abs() <= 1e-4 && (t - hint_t).abs() < (best_t - hint_t).abs()
        {
            best_t = t;
        }
    }

    // 2. Explicitly test the hint_t to avoid grid quantization loss on exact matches
    let hint_p = evaluate_curve(curve, hint_t);
    let hint_z_err = (hint_p.z - target_z).abs();
    if hint_z_err < min_z_err - 1e-4 {
        best_t = hint_t;
    } else if (hint_z_err - min_z_err).abs() <= 1e-4 {
        best_t = hint_t; // hint_t is closer to hint_t than best_t is
    }

    // 3. Strict refinement loop focusing solely on minimizing Z error
    let mut t_search = best_t;
    let mut step = 1.0 / steps as f32;
    for _ in 0..20 {
        step /= 2.0;
        let t_l = 0.0_f32.max(t_search - step);
        let t_r = 1.0_f32.min(t_search + step);
        let p_l = evaluate_curve(curve, t_l);
        let p_r = evaluate_curve(curve, t_r);
        let err_l = (p_l.z - target_z).abs();
        let err_r = (p_r.z - target_z).abs();
        let err_curr = (evaluate_curve(curve, t_search).z - target_z).abs();

        if err_l < err_curr && err_l <= err_r {
            t_search = t_l;
        } else if err_r < err_curr {
            t_search = t_r;
        }
    }

    t_search
}

pub fn evaluate_bezier_at_z(curve: &BezierCurveData, target_z: f32, hint_t: f32) -> Vec3 {
    let t = evaluate_bezier_t_at_z_robust(curve, target_z, hint_t);
    evaluate_curve(curve, t)
}

pub fn evaluate_bezier_pos_and_tan_at_z(
    curve: &BezierCurveData,
    target_z: f32,
    hint_t: f32,
) -> (Vec3, Vec3) {
    let t = evaluate_bezier_t_at_z_robust(curve, target_z, hint_t);
    crate::bezier::evaluate_composite_pos_and_tangent(curve, t)
}

pub fn evaluate_composite_outline_pos_and_tan_at_z(
    model: &BoardModel,
    z_inches: f32,
    hint_t: f32,
) -> (Vec3, Vec3) {
    let outline = match &model.outline {
        Some(o) => o,
        None => return (Vec3::ZERO, Vec3::Z),
    };
    let (base_pt, mut final_tan) = evaluate_bezier_pos_and_tan_at_z(outline, z_inches, hint_t);
    let mut final_x = base_pt.x;

    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if !layer.active || layer.otl_ext.control_points.is_empty() {
                continue;
            }
            let min_z = layer.otl_ext.control_points.first().unwrap().z;
            let max_z = layer.otl_ext.control_points.last().unwrap().z;
            let z0 = min_z.min(max_z);
            let z1 = min_z.max(max_z);

            if z_inches >= z0 - 1e-4 && z_inches <= z1 + 1e-4 {
                let (ext_pt, ext_tan) =
                    evaluate_bezier_pos_and_tan_at_z(&layer.otl_ext, z_inches, hint_t);
                final_x = ext_pt.x;
                final_tan = ext_tan;
            }
        }
    }
    (Vec3::new(final_x, base_pt.y, base_pt.z), final_tan)
}

pub fn evaluate_composite_outline_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> Vec3 {
    evaluate_composite_outline_pos_and_tan_at_z(model, z_inches, hint_t).0
}

pub fn find_v_at_z(curve: &BezierCurveData, target_z: f32, min_t: f32, max_t: f32) -> f32 {
    let mut best_t = min_t;
    let mut min_err = f32::INFINITY;
    let steps = 50;

    // Initial coarse search
    for i in 0..=steps {
        let t = min_t + (i as f32 / steps as f32) * (max_t - min_t);
        let p = evaluate_curve(curve, t);
        let err = (p.z - target_z).abs();
        if err < min_err {
            min_err = err;
            best_t = t;
        }
    }

    // Fine binary search around the best coarse result
    let mut t_search = best_t;
    let mut step_size = (max_t - min_t) / steps as f32;

    for _ in 0..20 {
        step_size /= 2.0;
        let t_left = min_t.max(t_search - step_size);
        let t_right = max_t.min(t_search + step_size);

        let p_left = evaluate_curve(curve, t_left);
        let p_right = evaluate_curve(curve, t_right);

        let err_left = (p_left.z - target_z).abs();
        let err_right = (p_right.z - target_z).abs();
        let err_curr = (evaluate_curve(curve, t_search).z - target_z).abs();

        if err_left < err_curr && err_left <= err_right {
            t_search = t_left;
        } else if err_right < err_curr {
            t_search = t_right;
        }
    }

    t_search
}

pub fn evaluate_notch_inner_x(curve: &BezierCurveData, tip_t: f32, target_z: f32) -> f32 {
    if tip_t >= 0.999 {
        return 0.0; // Standard block/pintail (Not a swallow tail)
    }
    let t = find_v_at_z(curve, target_z, tip_t, 1.0);
    evaluate_curve(curve, t).x.max(0.0)
}

pub fn find_apex_t(curve: &BezierCurveData) -> f32 {
    let mut is_flat = true;
    for i in 0..curve.control_points.len() {
        if curve.control_points[i].x.abs() > 0.000001 {
            is_flat = false;
            break;
        }
        if i < curve.tangents1.len() && curve.tangents1[i].x.abs() > 0.000001 {
            is_flat = false;
            break;
        }
        if i < curve.tangents2.len() && curve.tangents2[i].x.abs() > 0.000001 {
            is_flat = false;
            break;
        }
    }
    if is_flat {
        return 0.5;
    }

    let mut best_t = 0.5;
    let mut max_x = f32::NEG_INFINITY;
    let steps = 20;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(curve, t);
        if p.x > max_x {
            max_x = p.x;
            best_t = t;
        }
    }
    let mut search_t = best_t;
    let mut step_size = 1.0 / steps as f32;
    for _ in 0..3 {
        step_size /= 10.0;
        let start_t = 0.0_f32.max(search_t - step_size * 5.0);
        let end_t = 1.0_f32.min(search_t + step_size * 5.0);
        max_x = f32::NEG_INFINITY;
        let mut t = start_t;
        while t <= end_t {
            let p = evaluate_curve(curve, t);
            if p.x > max_x {
                max_x = p.x;
                best_t = t;
            }
            t += step_size;
        }
        search_t = best_t;
    }
    best_t
}

#[inline]
pub fn compute_centripetal_tangents(
    v0: Vec3,
    v1: Vec3,
    v2: Vec3,
    v3: Vec3,
    dt0: f32,
    dt1: f32,
    dt2: f32,
) -> (Vec3, Vec3) {
    let m1 = if dt1 < 1e-5 || dt0 < 1e-5 {
        v2 - v1
    } else {
        let d1 = (v1 - v0) / dt0;
        let d2 = (v2 - v1) / dt1;
        (d1 * dt1 + d2 * dt0) * (dt1 / (dt0 + dt1))
    };

    let m2 = if dt1 < 1e-5 {
        Vec3::ZERO
    } else if dt2 < 1e-5 {
        v2 - v1
    } else {
        let d2 = (v2 - v1) / dt1;
        let d3 = (v3 - v2) / dt2;
        (d2 * dt2 + d3 * dt1) * (dt1 / (dt1 + dt2))
    };

    (m1, m2)
}

pub struct BlendResult<'a> {
    pub t_apex: f32,
    pub s_prev: &'a BezierCurveData,
    pub s0: &'a BezierCurveData,
    pub s1: &'a BezierCurveData,
    pub s_next: &'a BezierCurveData,
    pub lerp_factor: f32,
}

impl<'a> BlendResult<'a> {
    pub fn evaluate(&self, t_mid: f32) -> Vec3 {
        let p0 = evaluate_curve(self.s_prev, t_mid);
        let p1 = evaluate_curve(self.s0, t_mid);
        let p2 = evaluate_curve(self.s1, t_mid);
        let p3 = evaluate_curve(self.s_next, t_mid);

        let z1 = self.s0.control_points.first().unwrap().z;
        let z2 = self.s1.control_points.first().unwrap().z;
        let dz = z2 - z1;

        let dt0 = p0.distance(p1).sqrt();
        let dt1 = p1.distance(p2).sqrt();
        let dt2 = p2.distance(p3).sqrt();

        let (mut m1, mut m2) = compute_centripetal_tangents(p0, p1, p2, p3, dt0, dt1, dt2);

        // Preserve mathematically strict Z linearity
        m1.z = dz;
        m2.z = dz;

        crate::bezier::evaluate_cubic_hermite(p1, p2, m1, m2, self.lerp_factor)
    }

    pub fn evaluate_derivative_u(&self, t_mid: f32) -> Vec3 {
        let dp0 = evaluate_curve_derivative(self.s_prev, t_mid);
        let dp1 = evaluate_curve_derivative(self.s0, t_mid);
        let dp2 = evaluate_curve_derivative(self.s1, t_mid);
        let dp3 = evaluate_curve_derivative(self.s_next, t_mid);

        let p0 = evaluate_curve(self.s_prev, t_mid);
        let p1 = evaluate_curve(self.s0, t_mid);
        let p2 = evaluate_curve(self.s1, t_mid);
        let p3 = evaluate_curve(self.s_next, t_mid);

        let dt0 = p0.distance(p1).sqrt();
        let dt1 = p1.distance(p2).sqrt();
        let dt2 = p2.distance(p3).sqrt();

        let (mut m1, mut m2) = compute_centripetal_tangents(dp0, dp1, dp2, dp3, dt0, dt1, dt2);

        // U-derivative of Z is 0 (cross sections are flat in Z)
        m1.z = 0.0;
        m2.z = 0.0;

        crate::bezier::evaluate_cubic_hermite(dp1, dp2, m1, m2, self.lerp_factor)
    }

    pub fn evaluate_derivative_z(&self, t_mid: f32) -> Vec3 {
        let p0 = evaluate_curve(self.s_prev, t_mid);
        let p1 = evaluate_curve(self.s0, t_mid);
        let p2 = evaluate_curve(self.s1, t_mid);
        let p3 = evaluate_curve(self.s_next, t_mid);

        let z1 = self.s0.control_points.first().unwrap().z;
        let z2 = self.s1.control_points.first().unwrap().z;
        let dz = z2 - z1;

        let dt0 = p0.distance(p1).sqrt();
        let dt1 = p1.distance(p2).sqrt();
        let dt2 = p2.distance(p3).sqrt();

        let (mut m1, mut m2) = compute_centripetal_tangents(p0, p1, p2, p3, dt0, dt1, dt2);

        m1.z = dz;
        m2.z = dz;

        crate::bezier::evaluate_cubic_hermite_derivative(p1, p2, m1, m2, self.lerp_factor)
    }
}

pub fn get_cross_section_blend_at_z<'a>(
    cross_sections: &'a [BezierCurveData],
    z_inches: f32,
) -> Option<BlendResult<'a>> {
    if cross_sections.is_empty() {
        return None;
    }
    let min_z = cross_sections
        .first()
        .unwrap()
        .control_points
        .first()
        .unwrap()
        .z;
    let max_z = cross_sections
        .last()
        .unwrap()
        .control_points
        .first()
        .unwrap()
        .z;

    let mut k0 = 0;
    let mut lerp_factor = 0.0;

    if z_inches <= min_z {
        k0 = 0;
    } else if z_inches >= max_z {
        k0 = cross_sections.len().saturating_sub(1);
    } else {
        for k in 0..cross_sections.len() - 1 {
            let z0 = cross_sections[k].control_points.first().unwrap().z;
            let z1 = cross_sections[k + 1].control_points.first().unwrap().z;
            if z_inches >= z0 && z_inches <= z1 {
                k0 = k;
                let dz = z1 - z0;
                if dz > 1e-5 {
                    lerp_factor = (z_inches - z0) / dz;
                }
                break;
            }
        }
    }

    let k_prev = k0.saturating_sub(1);
    let k1 = (k0 + 1).min(cross_sections.len() - 1);
    let k_next = (k0 + 2).min(cross_sections.len() - 1);

    let s_prev = &cross_sections[k_prev];
    let s0 = &cross_sections[k0];
    let s1 = &cross_sections[k1];
    let s_next = &cross_sections[k_next];

    let t_apex0 = find_apex_t(s0);
    let t_apex1 = find_apex_t(s1);
    // Apex parameter interpolation remains strictly linear
    let t_apex = (t_apex0 + (t_apex1 - t_apex0) * lerp_factor).clamp(0.0, 1.0);

    Some(BlendResult {
        t_apex,
        s_prev,
        s0,
        s1,
        s_next,
        lerp_factor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

    #[test]
    fn test_cross_section_blend_hermite() {
        let cs1 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(5.0, 0.0, 10.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 0.0, 20.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        };
        let cs3 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 30.0), Vec3::new(5.0, 0.0, 30.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        };

        let sections = vec![cs1, cs2, cs3];
        let blend = get_cross_section_blend_at_z(&sections, 15.0).unwrap();

        assert_eq!(blend.lerp_factor, 0.5);

        // evaluate at t_mid = 1.0 (the outer edge of the cross section)
        let pt = blend.evaluate(1.0);

        assert!(
            (pt.x - 8.125).abs() < 1e-3,
            "Centripetal midpoint shifted: {}",
            pt.x
        );
        assert_eq!(
            pt.z, 15.0,
            "Z coordinate must remain strictly linear across Hermite blend"
        );
    }

    #[test]
    fn test_centripetal_prevents_overshoot() {
        let cs0 = BezierCurveData {
            control_points: vec![Vec3::new(0., 0., 0.), Vec3::new(10., 0., 0.)],
            ..Default::default()
        };
        let cs1 = BezierCurveData {
            control_points: vec![Vec3::new(0., 0., 100.), Vec3::new(10., 0., 100.)],
            ..Default::default()
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0., 0., 101.), Vec3::new(2., 0., 101.)],
            ..Default::default()
        };
        let cs3 = BezierCurveData {
            control_points: vec![Vec3::new(0., 0., 102.), Vec3::new(0., 0., 102.)],
            ..Default::default()
        };
        let sections = vec![cs0, cs1, cs2, cs3];

        let blend = get_cross_section_blend_at_z(&sections, 100.5).unwrap();
        let pt = blend.evaluate(1.0);

        assert!(
            pt.x <= 10.0 && pt.x >= 2.0,
            "Overshoot detected! X ballooned to {}",
            pt.x
        );
    }

    #[test]
    fn test_blend_derivatives_u_and_z() {
        let cs1 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(5.0, 0.0, 10.0)],
            tangents1: vec![Vec3::ZERO, Vec3::new(2.5, 0.0, 10.0)],
            tangents2: vec![Vec3::new(2.5, 0.0, 10.0), Vec3::ZERO],
            ..Default::default()
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 5.0, 20.0)],
            tangents1: vec![Vec3::ZERO, Vec3::new(5.0, 2.5, 20.0)],
            tangents2: vec![Vec3::new(5.0, 2.5, 20.0), Vec3::ZERO],
            ..Default::default()
        };
        let cs3 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 30.0), Vec3::new(5.0, 0.0, 30.0)],
            tangents1: vec![Vec3::ZERO, Vec3::new(2.5, 0.0, 30.0)],
            tangents2: vec![Vec3::new(2.5, 0.0, 30.0), Vec3::ZERO],
            ..Default::default()
        };

        let sections = vec![cs1, cs2, cs3];
        let blend = get_cross_section_blend_at_z(&sections, 15.0).unwrap();

        let t_u = 0.5;
        let delta = 0.0001;

        let pt0 = blend.evaluate(t_u);
        let pt1 = blend.evaluate(t_u + delta);
        let numeric_du = (pt1 - pt0) / delta;
        let analytic_du = blend.evaluate_derivative_u(t_u);

        assert!(
            (numeric_du.x - analytic_du.x).abs() < 1e-1,
            "U derivative X mismatch: {} vs {}",
            numeric_du.x,
            analytic_du.x
        );

        let blend_z1 = get_cross_section_blend_at_z(&sections, 15.0 + delta * 10.0).unwrap();
        let pt_z0 = blend.evaluate(t_u);
        let pt_z1 = blend_z1.evaluate(t_u);

        let numeric_dz = (pt_z1 - pt_z0) / delta;
        let analytic_dz = blend.evaluate_derivative_z(t_u);

        assert!(
            (numeric_dz.x - analytic_dz.x).abs() < 1e-1,
            "Z derivative X mismatch: {} vs {}",
            numeric_dz.x,
            analytic_dz.x
        );
    }

    #[test]
    fn test_cross_section_blend_out_of_bounds() {
        let cs1 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(5.0, 0.0, 10.0)],
            ..Default::default()
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 0.0, 20.0)],
            ..Default::default()
        };
        let sections = vec![cs1, cs2];

        let blend_before = get_cross_section_blend_at_z(&sections, 0.0).unwrap();
        assert_eq!(blend_before.lerp_factor, 0.0);
        let pt_before = blend_before.evaluate(1.0);
        assert_eq!(pt_before.x, 5.0);

        let blend_after = get_cross_section_blend_at_z(&sections, 30.0).unwrap();
        assert_eq!(blend_after.lerp_factor, 0.0);
        let pt_after = blend_after.evaluate(1.0);
        assert_eq!(pt_after.x, 10.0);
    }

    #[test]
    fn test_2d_curve_parity() {
        let outline = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            weights: None,
        };
        let z_target = 50.0;
        let hint_t = 0.5;
        let pt = evaluate_bezier_at_z(&outline, z_target, hint_t);
        assert!((pt.x - 5.0).abs() < 1e-3);
        assert!((pt.z - 50.0).abs() < 1e-3);
    }

    #[test]
    fn test_swallow_tail_notch_detection() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 100.0),
                Vec3::new(0.0, 0.0, 95.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 80.0),
                Vec3::new(5.0, 0.0, 100.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 20.0),
                Vec3::new(10.0, 0.0, 110.0),
                Vec3::new(0.0, 0.0, 95.0),
            ],
            ..Default::default()
        });

        let bounds = get_board_bounds(&model);

        assert_eq!(bounds.nose_z, 0.0);
        assert_eq!(bounds.notch_z, 95.0);
        assert!(bounds.tip_z > 95.0);
        assert!(bounds.tip_t < 1.0);

        let inner_x = evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, 98.0);
        assert!(inner_x > 0.0 && inner_x < 10.0);
    }

    #[test]
    fn test_rational_geometry_integration() {
        let mut curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 50.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 50.0), Vec3::new(10.0, 0.0, 100.0)],
            weights: Some(vec![1.0, 1.0]),
        };

        let t_std = find_v_at_z(&curve, 50.0, 0.0, 1.0);
        let pt_std = evaluate_curve(&curve, t_std);

        curve.weights = Some(vec![1.0, 5.0]);
        let t_weighted = find_v_at_z(&curve, 50.0, 0.0, 1.0);
        let pt_weighted = evaluate_curve(&curve, t_weighted);

        assert!((pt_std.z - 50.0).abs() < 1e-3);
        assert!((pt_weighted.z - 50.0).abs() < 1e-3);
        assert!(t_weighted < t_std);
    }
}
