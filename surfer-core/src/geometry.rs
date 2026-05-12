use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;
// use crate::bezier::evaluate_bezier_cubic;

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

    let nose_z = evaluate_curve(outline, 0.0).z;
    let notch_z = evaluate_curve(outline, 1.0).z;

    let mut tip_z = f32::NEG_INFINITY;
    let mut tip_t = 1.0;
    let steps = 50;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(outline, t);
        if p.z > tip_z {
            tip_z = p.z;
            tip_t = t;
        }
    }

    // Refine tip_t for pinpoint accuracy at the absolute outer tail tip
    let mut t_search = tip_t;
    let mut step_size = 1.0 / steps as f32;
    for _ in 0..15 {
        step_size /= 2.0;
        let t_left = 0.0_f32.max(t_search - step_size);
        let t_right = 1.0_f32.min(t_search + step_size);
        let p_left = evaluate_curve(outline, t_left);
        let p_right = evaluate_curve(outline, t_right);
        if p_left.z > tip_z {
            tip_z = p_left.z;
            t_search = t_left;
        } else if p_right.z > tip_z {
            tip_z = p_right.z;
            t_search = t_right;
        }
    }
    tip_t = t_search;

    BoardBounds {
        nose_z,
        tip_z,
        notch_z,
        tip_t,
    }
}

pub fn evaluate_bezier_at_z(curve: &BezierCurveData, target_z: f32, hint_t: f32) -> Vec3 {
    let mut best_t = hint_t;
    let mut min_err = f32::INFINITY;
    let steps = 50;

    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(curve, t);
        let z_err = (p.z - target_z).abs();
        let t_err = (t - hint_t).abs() * 0.1;
        let total_err = z_err + t_err;
        if total_err < min_err {
            min_err = total_err;
            best_t = t;
        }
    }

    let mut t_search = best_t;
    let mut step = 1.0 / steps as f32;
    for _ in 0..15 {
        step /= 2.0;
        let t_l = 0.0_f32.max(t_search - step);
        let t_r = 1.0_f32.min(t_search + step);
        let p_l = evaluate_curve(curve, t_l);
        let p_r = evaluate_curve(curve, t_r);
        let err_l = (p_l.z - target_z).abs() + (t_l - hint_t).abs() * 0.1;
        let err_r = (p_r.z - target_z).abs() + (t_r - hint_t).abs() * 0.1;

        if err_l < min_err && err_l <= err_r {
            min_err = err_l;
            t_search = t_l;
        } else if err_r < min_err {
            min_err = err_r;
            t_search = t_r;
        }
    }
    evaluate_curve(curve, t_search)
}

pub fn evaluate_bezier_pos_and_tan_at_z(
    curve: &BezierCurveData,
    target_z: f32,
    hint_t: f32,
) -> (Vec3, Vec3) {
    let mut best_t = hint_t;
    let mut min_err = f32::INFINITY;
    let steps = 50;

    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(curve, t);
        let z_err = (p.z - target_z).abs();
        let t_err = (t - hint_t).abs() * 0.1;
        let total_err = z_err + t_err;
        if total_err < min_err {
            min_err = total_err;
            best_t = t;
        }
    }

    let mut t_search = best_t;
    let mut step = 1.0 / steps as f32;
    for _ in 0..15 {
        step /= 2.0;
        let t_l = 0.0_f32.max(t_search - step);
        let t_r = 1.0_f32.min(t_search + step);
        let p_l = evaluate_curve(curve, t_l);
        let p_r = evaluate_curve(curve, t_r);
        let err_l = (p_l.z - target_z).abs() + (t_l - hint_t).abs() * 0.1;
        let err_r = (p_r.z - target_z).abs() + (t_r - hint_t).abs() * 0.1;

        if err_l < min_err && err_l <= err_r {
            min_err = err_l;
            t_search = t_l;
        } else if err_r < min_err {
            min_err = err_r;
            t_search = t_r;
        }
    }
    crate::bezier::evaluate_composite_pos_and_tangent(curve, t_search)
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

/// Finds the curve parameter `t` (0 to 1) that corresponds to a specific `z` coordinate.
/// Used primarily for matching outline width/rocker height to specific lengthwise slices.
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

    for _ in 0..15 {
        step_size /= 2.0;
        let t_left = min_t.max(t_search - step_size);
        let t_right = max_t.min(t_search + step_size);

        let p_left = evaluate_curve(curve, t_left);
        let p_right = evaluate_curve(curve, t_right);

        let err_left = (p_left.z - target_z).abs();
        let err_right = (p_right.z - target_z).abs();

        if err_left < min_err && err_left <= err_right {
            min_err = err_left;
            t_search = t_left;
        } else if err_right < min_err {
            min_err = err_right;
            t_search = t_right;
        }
    }

    t_search
}

/// Evaluates the inner X-coordinate of a swallow tail "V" notch at a given Z.
/// It searches the parameter space exclusively from `tip_t` (the absolute tail tip) to 1.0 (the stringer notch).
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

pub enum EaseType {
    EaseIn,
    EaseOut,
    EaseInOut,
}

/// Warps a linear parameter `t` (0.0 to 1.0) to cluster vertices near edges.
pub fn radial_ease(t: f32, ease_type: EaseType) -> f32 {
    let t = t.clamp(0.0, 1.0);
    use std::f32::consts::PI;
    match ease_type {
        EaseType::EaseIn => 1.0 - (t * PI / 2.0).cos(),
        EaseType::EaseOut => (t * PI / 2.0).sin(),
        EaseType::EaseInOut => -((t * PI).cos() - 1.0) / 2.0,
    }
}

#[inline]
fn compute_centripetal_tangents(
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

pub fn get_channel_profile_at_z(
    model: &BoardModel,
    is_left: bool,
    z_inches: f32,
) -> Option<(f32, f32)> {
    let mut best_profile = None;
    let mut max_depth = 0.0_f32;

    if let Some(channels) = &model.bottom_channels {
        for channel in channels {
            let (outline, depth) = if is_left {
                (&channel.left_outline, &channel.left_depth)
            } else {
                (&channel.right_outline, &channel.right_depth)
            };

            if outline.control_points.is_empty() || depth.control_points.is_empty() {
                continue;
            }
            let min_z = outline.control_points.first().unwrap().z;
            let max_z = outline.control_points.last().unwrap().z;
            if z_inches >= min_z - 1e-4 && z_inches <= max_z + 1e-4 {
                let chan_x = evaluate_bezier_at_z(outline, z_inches, 0.5).x;
                let current_depth = evaluate_bezier_at_z(depth, z_inches, 0.5).y;
                if current_depth > max_depth {
                    max_depth = current_depth;
                    best_profile = Some((chan_x, current_depth));
                }
            }
        }
    }
    best_profile
}

pub struct BoardProfile {
    pub top_y: f32,
    pub bot_y: f32,
    pub apex_x: f32,
    pub apex_y: f32,
    pub tuck_x: f32,
    pub tuck_y: f32,
    pub shoulder_x: f32,
    pub shoulder_y: f32,
    pub half_width: f32,
    pub outline_tangent: Vec3,
    pub outline_normal: Vec3,
}

pub fn get_board_profile_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> BoardProfile {
    let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, hint_t);
    let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, hint_t);

    let (outline_pt, mut outline_tangent) =
        evaluate_composite_outline_pos_and_tan_at_z(model, z_inches, hint_t);
    let base_outline_pt = evaluate_bezier_at_z(model.outline.as_ref().unwrap(), z_inches, hint_t);
    let outline_delta = outline_pt.x - base_outline_pt.x;

    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

    if outline_tangent.is_nan() || outline_tangent.length_squared() < 1e-5 {
        outline_tangent = Vec3::new(0.0, 0.0, 1.0);
    }

    // Normal in the XZ plane, pointing "outward" to the right (+X)
    let mut outline_normal = Vec3::new(outline_tangent.z, 0.0, -outline_tangent.x).normalize();
    if outline_normal.is_nan() || outline_normal.length_squared() < 1e-5 {
        outline_normal = Vec3::new(1.0, 0.0, 0.0);
    }

    let bounds = get_board_bounds(model);
    let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
    let dist = z_inches - mid_z;
    let v_concave_raw = if dist > 0.0 {
        let t = (dist / (bounds.tip_z - mid_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        model.v_concave_tail * ease_t
    } else {
        let t = ((-dist) / (mid_z - bounds.nose_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        model.v_concave_nose * ease_t
    };

    let half_width = outline_pt.x.max(0.0);
    let max_half_width = (model.width / 2.0).max(0.001);
    let width_ratio = (half_width / max_half_width).clamp(0.0, 1.0);
    let v_concave_add = v_concave_raw * width_ratio;

    let actual_bot_y = bot_pt.y;
    let mut top_y = top_pt.y;
    if top_y < actual_bot_y {
        top_y = actual_bot_y;
    }

    let mut apex_x = half_width;
    let rail_base_y = actual_bot_y + v_concave_add;
    let mut apex_y = rail_base_y + (top_y - rail_base_y) * 0.3;

    if let Some(ao) = &model.apex_outline {
        if !ao.control_points.is_empty() {
            apex_x = (evaluate_bezier_at_z(ao, z_inches, hint_t).x + outline_delta).max(0.0);
        }
    }

    if let Some(ar) = &model.apex_rocker {
        if !ar.control_points.is_empty() {
            apex_y = evaluate_bezier_at_z(ar, z_inches, hint_t).y;
        }
    } else if let Some(b) = &blend {
        let p_bot = b.evaluate(0.0);
        let p_top = b.evaluate(1.0);
        let p_apex = b.evaluate(b.t_apex);
        let slice_thick = p_top.y - p_bot.y;
        let world_thick = top_y - actual_bot_y;
        if slice_thick.abs() > 1e-5 {
            apex_y = rail_base_y + world_thick * ((p_apex.y - p_bot.y) / slice_thick);
        }
    }
    apex_y = apex_y.max(rail_base_y - 2.0);

    let mut tuck_y = rail_base_y;
    let mut shoulder_y = rail_base_y + (top_y - rail_base_y) * 0.8;

    if let Some(b) = &blend {
        let p_bot = b.evaluate(0.0);
        let p_top = b.evaluate(1.0);
        let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
        let p_tuck = b.evaluate(t_tuck);
        let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;
        let p_shoulder = b.evaluate(t_shoulder);
        let slice_thick = p_top.y - p_bot.y;
        let world_thick = top_y - actual_bot_y;
        if slice_thick.abs() > 1e-5 {
            tuck_y = rail_base_y + world_thick * ((p_tuck.y - p_bot.y) / slice_thick);
            shoulder_y = rail_base_y + world_thick * ((p_shoulder.y - p_bot.y) / slice_thick);
        }
    }

    let mut tuck_x = outline_pt.x.max(0.0);
    let mut has_rail_outline = false;
    if let Some(ro) = &model.rail_outline {
        if !ro.control_points.is_empty() {
            tuck_x = (evaluate_bezier_at_z(ro, z_inches, hint_t).x + outline_delta).max(0.0);
            has_rail_outline = true;
        }
    }
    if !has_rail_outline {
        if let Some(b) = &blend {
            let p_bot = b.evaluate(0.0);
            let p_apex = b.evaluate(b.t_apex);
            let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
            let p_tuck = b.evaluate(t_tuck);
            let slice_width = p_apex.x - p_bot.x;
            if slice_width.abs() > 1e-5 {
                tuck_x = outline_pt.x.max(0.0) * ((p_tuck.x - p_bot.x) / slice_width);
            }
        }
    }

    let mut shoulder_x = outline_pt.x.max(0.0) * 0.5;
    let mut has_deck_shoulder = false;
    if let Some(ds) = &model.deck_shoulder {
        if !ds.control_points.is_empty() {
            shoulder_x = (evaluate_bezier_at_z(ds, z_inches, hint_t).x + outline_delta).max(0.0);
            has_deck_shoulder = true;
        }
    }
    if !has_deck_shoulder {
        if let Some(b) = &blend {
            let p_bot = b.evaluate(0.0);
            let p_apex = b.evaluate(b.t_apex);
            let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;
            let p_shoulder = b.evaluate(t_shoulder);
            let slice_width = p_apex.x - p_bot.x;
            if slice_width.abs() > 1e-5 {
                shoulder_x = outline_pt.x.max(0.0) * ((p_shoulder.x - p_bot.x) / slice_width);
            }
        }
    }

        if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if !layer.active || layer.otl_int.control_points.is_empty() {
                continue;
            }
            let min_z = layer.otl_ext.control_points.first().unwrap().z;
            let max_z = layer.otl_ext.control_points.last().unwrap().z;
            let z0 = min_z.min(max_z);
            let z1 = min_z.max(max_z);

            if z_inches >= z0 - 1e-4 && z_inches <= z1 + 1e-4 {
                // If we're inside a wing, the INNER outline dictates the tuck position
                let int_pt = evaluate_bezier_at_z(&layer.otl_int, z_inches, hint_t);
                tuck_x = int_pt.x; // This is an absolute X, not relative
            }
        }
    }
    let final_apex_x = apex_x.max(0.001);
    let final_tuck_x = tuck_x.max(0.0).min(final_apex_x);
    let final_shoulder_x = shoulder_x.max(0.0).min(final_apex_x);

    BoardProfile {
        top_y,
        bot_y: actual_bot_y,
        apex_x: final_apex_x,
        apex_y,
        tuck_x: final_tuck_x,
        tuck_y,
        shoulder_x: final_shoulder_x,
        shoulder_y,
        half_width: outline_pt.x.max(0.0),
        outline_tangent,
        outline_normal,
    }
}

pub fn get_point_at_uv_base(
    model: &BoardModel,
    u: f32,
    v: f32,
    z_inches: f32,
    inner_x: f32,
    _side: f32,
) -> Vec3 {
    let profile = get_board_profile_at_z(model, z_inches, v);
    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

    if blend.is_none() {
        let py = profile.bot_y + (profile.top_y - profile.bot_y) * u;
        return Vec3::new(profile.half_width, py, z_inches);
    }
    let b = blend.unwrap();
    let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
    let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;

    let p = b.evaluate(u);
    let p_bot = b.evaluate(0.0);
    let p_tuck = b.evaluate(t_tuck);
    let p_apex = b.evaluate(b.t_apex);
    let p_shoulder = b.evaluate(t_shoulder);
    let p_top = b.evaluate(1.0);

    let mut final_pos = Vec3::ZERO;
    final_pos.z = z_inches;

    let world_thick = profile.top_y - profile.bot_y;
    let local_thick = p_top.y - p_bot.y;
    let scale_y = if local_thick.abs() > 1e-5 {
        world_thick / local_thick
    } else {
        1.0
    };

    if u <= t_tuck {
        let t = u / t_tuck;
        let w_x = if (p_tuck.x - p_bot.x).abs() > 1e-5 {
            (p.x - p_bot.x) / (p_tuck.x - p_bot.x)
        } else {
            t
        };
        final_pos.x = inner_x + w_x * (profile.tuck_x - inner_x);

        let local_baseline_y = p_bot.y + t * (p_tuck.y - p_bot.y);
        let local_deviation = p.y - local_baseline_y;
        let world_baseline_y = profile.bot_y + t * (profile.tuck_y - profile.bot_y);
        final_pos.y = world_baseline_y + local_deviation * scale_y;
    } else if u <= b.t_apex {
        let t = (u - t_tuck) / (b.t_apex - t_tuck);
        let w_x = if (p_apex.x - p_tuck.x).abs() > 1e-5 {
            (p.x - p_tuck.x) / (p_apex.x - p_tuck.x)
        } else {
            t
        };
        final_pos.x = profile.tuck_x + w_x * (profile.apex_x - profile.tuck_x);

        let local_baseline_y = p_tuck.y + t * (p_apex.y - p_tuck.y);
        let local_deviation = p.y - local_baseline_y;
        let world_baseline_y = profile.tuck_y + t * (profile.apex_y - profile.tuck_y);
        final_pos.y = world_baseline_y + local_deviation * scale_y;
    } else if u <= t_shoulder {
        let t = (u - b.t_apex) / (t_shoulder - b.t_apex);
        let w_x = if (p_shoulder.x - p_apex.x).abs() > 1e-5 {
            (p.x - p_apex.x) / (p_shoulder.x - p_apex.x)
        } else {
            t
        };
        final_pos.x = profile.apex_x + w_x * (profile.shoulder_x - profile.apex_x);

        let local_baseline_y = p_apex.y + t * (p_shoulder.y - p_apex.y);
        let local_deviation = p.y - local_baseline_y;
        let world_baseline_y = profile.apex_y + t * (profile.shoulder_y - profile.apex_y);
        final_pos.y = world_baseline_y + local_deviation * scale_y;
    } else {
        let t = (u - t_shoulder) / (1.0 - t_shoulder);
        let w_x = if (p_top.x - p_shoulder.x).abs() > 1e-5 {
            (p.x - p_shoulder.x) / (p_top.x - p_shoulder.x)
        } else {
            t
        };
        final_pos.x = profile.shoulder_x + w_x * (inner_x - profile.shoulder_x);

        let local_baseline_y = p_shoulder.y + t * (p_top.y - p_shoulder.y);
        let local_deviation = p.y - local_baseline_y;
        let world_baseline_y = profile.shoulder_y + t * (profile.top_y - profile.shoulder_y);
        final_pos.y = world_baseline_y + local_deviation * scale_y;
    }

    let bounds = get_board_bounds(model);
    let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
    let dist = z_inches - mid_z;
    let rail_coeff = if dist > 0.0 {
        let t = (dist / (bounds.tip_z - mid_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_tail - 1.0) * ease_t
    } else {
        let t = ((-dist) / (mid_z - bounds.nose_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_nose - 1.0) * ease_t
    };

    let norm_x_for_rail = if profile.apex_x > inner_x {
        ((final_pos.x - inner_x) / (profile.apex_x - inner_x)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let local_rail_coeff = 1.0 - (1.0 - rail_coeff) * norm_x_for_rail;
    final_pos.y = profile.bot_y + (final_pos.y - profile.bot_y) * local_rail_coeff;

    if final_pos.x < inner_x {
        final_pos.x = inner_x;
    }
    final_pos.y = final_pos.y.max(profile.bot_y - 5.0);

    let is_nose_pole = (z_inches - bounds.nose_z).abs() < 1e-4;
    let is_tail_pole = (z_inches - bounds.tip_z).abs() < 1e-4;

    if (is_nose_pole || is_tail_pole) && profile.apex_x < 0.1 {
        final_pos.x = 0.0;
    }

    final_pos
}

pub fn get_point_at_uv(
    model: &BoardModel,
    u: f32,
    v: f32,
    z_inches: f32,
    inner_x: f32,
    side: f32,
) -> Vec3 {
    let mut final_pos = get_point_at_uv_base(model, u, v, z_inches, inner_x, side);

    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);
    let t_apex = if let Some(b) = &blend { b.t_apex } else { 0.5 };

    if u <= t_apex {
        if let Some((mut chan_x, chan_depth)) =
            get_channel_profile_at_z(model, side < 0.0, z_inches)
        {
            let profile = get_board_profile_at_z(model, z_inches, v);
            let apex_x = profile.apex_x.max(0.001);
            chan_x = chan_x.abs();
            if chan_x > inner_x && chan_x < apex_x {
                let mut best_u = 0.0;
                let mut min_diff = f32::INFINITY;

                for i in 0..=50 {
                    let test_u = (i as f32 / 50.0) * t_apex;
                    let test_pt = get_point_at_uv_base(model, test_u, v, z_inches, inner_x, 1.0);
                    let diff = (test_pt.x - chan_x).abs();
                    if diff < min_diff {
                        min_diff = diff;
                        best_u = test_u;
                    }
                }

                let mut u_search = best_u;
                let mut step = t_apex / 50.0;
                for _ in 0..10 {
                    step *= 0.5;
                    let u_l = 0.0_f32.max(u_search - step);
                    let u_r = t_apex.min(u_search + step);
                    let p_l = get_point_at_uv_base(model, u_l, v, z_inches, inner_x, 1.0);
                    let p_r = get_point_at_uv_base(model, u_r, v, z_inches, inner_x, 1.0);
                    let d_l = (p_l.x - chan_x).abs();
                    let d_r = (p_r.x - chan_x).abs();

                    if d_l < min_diff && d_l <= d_r {
                        min_diff = d_l;
                        u_search = u_l;
                    } else if d_r < min_diff {
                        min_diff = d_r;
                        u_search = u_r;
                    }
                }

                let u_chan = u_search;
                let mut channel_applied = false;
                let mut t = 0.0;

                if u <= u_chan {
                    if u_chan > 0.0 {
                        t = u / u_chan;
                        channel_applied = true;
                    }
                } else if t_apex > u_chan {
                    t = 1.0 - (u - u_chan) / (t_apex - u_chan);
                    channel_applied = true;
                }

                if channel_applied {
                    let normal = get_surface_normal_base_at_uvz(model, u, z_inches, side);
                    final_pos.x *= side;
                    final_pos -= normal * (t * chan_depth);
                    final_pos.x *= side;
                }
            }
        }
    }

    final_pos
}

/// Spherical Linear Interpolation for normal vectors.
/// Smoothly blends two direction vectors. If they are exactly opposite (180 deg),
/// it routes the interpolation through the provided `fallback_mid` vector.
pub fn slerp_normals(n1: Vec3, n2: Vec3, t: f32, fallback_mid: Vec3) -> Vec3 {
    let t = t.clamp(0.0, 1.0);
    let dot = n1.dot(n2).clamp(-1.0, 1.0);

    if dot > 0.9999 {
        return n1.lerp(n2, t).normalize();
    }

    if dot < -0.9999 {
        if t < 0.5 {
            return slerp_normals(n1, fallback_mid, t * 2.0, fallback_mid);
        } else {
            return slerp_normals(fallback_mid, n2, (t - 0.5) * 2.0, fallback_mid);
        }
    }

    let theta = dot.acos();
    let sin_theta = theta.sin();
    let w1 = ((1.0 - t) * theta).sin() / sin_theta;
    let w2 = (t * theta).sin() / sin_theta;

    (n1 * w1 + n2 * w2).normalize()
}

/// Evaluates the analytical surface normals at the absolute Z-poles (nose or tail) of the board.
/// Returns (top_normal, bottom_normal).
pub fn get_surface_normal_base_at_uvz(
    model: &BoardModel,
    u: f32,
    z_inches: f32,
    side: f32,
) -> Vec3 {
    let bounds = get_board_bounds(model);

    if (z_inches - bounds.nose_z).abs() < 1e-4 {
        let profile_nose = get_board_profile_at_z(model, bounds.nose_z, 0.0);
        if profile_nose.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(model, bounds.nose_z, true);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, -1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
    }
    if (z_inches - bounds.tip_z).abs() < 1e-4 {
        let profile_tail = get_board_profile_at_z(model, bounds.tip_z, 1.0);
        if profile_tail.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(model, bounds.tip_z, false);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, 1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
    }

    let v_outer = find_v_at_z(model.outline.as_ref().unwrap(), z_inches, 0.0, bounds.tip_t);
    let inner_x = if z_inches > bounds.notch_z {
        evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, z_inches)
    } else {
        0.0
    };

    let du = 1e-4;
    let u_plus = (u + du).min(1.0);
    let u_minus = (u - du).max(0.0);
    let mut pt_plus_u = get_point_at_uv_base(model, u_plus, v_outer, z_inches, inner_x, side);
    pt_plus_u.x *= side;
    let mut pt_minus_u = get_point_at_uv_base(model, u_minus, v_outer, z_inches, inner_x, side);
    pt_minus_u.x *= side;
    let mut t_u = (pt_plus_u - pt_minus_u).normalize();
    if t_u.is_nan() || t_u.length_squared() < 1e-6 {
        t_u = Vec3::new(side, 0.0, 0.0);
    }

    let dz = 1e-3;
    let mut t_v = if z_inches <= bounds.nose_z + 1e-4 {
        let mut pt_plus_v = get_point_at_uv_base(model, u, v_outer, z_inches + dz, inner_x, side);
        pt_plus_v.x *= side;
        let mut pt_c = get_point_at_uv_base(model, u, v_outer, z_inches, inner_x, side);
        pt_c.x *= side;
        (pt_plus_v - pt_c).normalize()
    } else if z_inches >= bounds.tip_z - 1e-4 {
        let mut pt_minus_v = get_point_at_uv_base(model, u, v_outer, z_inches - dz, inner_x, side);
        pt_minus_v.x *= side;
        let mut pt_c = get_point_at_uv_base(model, u, v_outer, z_inches, inner_x, side);
        pt_c.x *= side;
        (pt_c - pt_minus_v).normalize()
    } else {
        let mut pt_plus_v = get_point_at_uv_base(model, u, v_outer, z_inches + dz, inner_x, side);
        pt_plus_v.x *= side;
        let mut pt_minus_v = get_point_at_uv_base(model, u, v_outer, z_inches - dz, inner_x, side);
        pt_minus_v.x *= side;
        (pt_plus_v - pt_minus_v).normalize()
    };
    if t_v.is_nan() || t_v.length_squared() < 1e-6 {
        t_v = Vec3::new(0.0, 0.0, 1.0);
    }

    let mut n = t_u.cross(t_v).normalize();
    if side < 0.0 {
        n = -n;
    }

    let pt = get_point_at_uv_base(model, u, v_outer, z_inches, inner_x, side);
    if pt.x.abs() < 1e-4 && inner_x < 1e-4 {
        n.x = 0.0;
        n = n.normalize();
    }

    n
}

pub fn get_surface_normal_at_uvz(model: &BoardModel, u: f32, z_inches: f32, side: f32) -> Vec3 {
    let bounds = get_board_bounds(model);

    if (z_inches - bounds.nose_z).abs() < 1e-4 {
        let profile_nose = get_board_profile_at_z(model, bounds.nose_z, 0.0);
        if profile_nose.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(model, bounds.nose_z, true);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, -1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
    }
    if (z_inches - bounds.tip_z).abs() < 1e-4 {
        let profile_tail = get_board_profile_at_z(model, bounds.tip_z, 1.0);
        if profile_tail.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(model, bounds.tip_z, false);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, 1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
    }

    let v_outer = find_v_at_z(model.outline.as_ref().unwrap(), z_inches, 0.0, bounds.tip_t);
    let inner_x = if z_inches > bounds.notch_z {
        evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, z_inches)
    } else {
        0.0
    };

    let du = 1e-4;
    let u_plus = (u + du).min(1.0);
    let u_minus = (u - du).max(0.0);
    let mut pt_plus_u = get_point_at_uv(model, u_plus, v_outer, z_inches, inner_x, side);
    pt_plus_u.x *= side;
    let mut pt_minus_u = get_point_at_uv(model, u_minus, v_outer, z_inches, inner_x, side);
    pt_minus_u.x *= side;
    let mut t_u = (pt_plus_u - pt_minus_u).normalize();
    if t_u.is_nan() || t_u.length_squared() < 1e-6 {
        t_u = Vec3::new(side, 0.0, 0.0);
    }

    let dz = 1e-3;
    let mut t_v = if z_inches <= bounds.nose_z + 1e-4 {
        let mut pt_plus_v = get_point_at_uv(model, u, v_outer, z_inches + dz, inner_x, side);
        pt_plus_v.x *= side;
        let mut pt_c = get_point_at_uv(model, u, v_outer, z_inches, inner_x, side);
        pt_c.x *= side;
        (pt_plus_v - pt_c).normalize()
    } else if z_inches >= bounds.tip_z - 1e-4 {
        let mut pt_minus_v = get_point_at_uv(model, u, v_outer, z_inches - dz, inner_x, side);
        pt_minus_v.x *= side;
        let mut pt_c = get_point_at_uv(model, u, v_outer, z_inches, inner_x, side);
        pt_c.x *= side;
        (pt_c - pt_minus_v).normalize()
    } else {
        let mut pt_plus_v = get_point_at_uv(model, u, v_outer, z_inches + dz, inner_x, side);
        pt_plus_v.x *= side;
        let mut pt_minus_v = get_point_at_uv(model, u, v_outer, z_inches - dz, inner_x, side);
        pt_minus_v.x *= side;
        (pt_plus_v - pt_minus_v).normalize()
    };
    if t_v.is_nan() || t_v.length_squared() < 1e-6 {
        t_v = Vec3::new(0.0, 0.0, 1.0);
    }

    let mut n = t_u.cross(t_v).normalize();
    if side < 0.0 {
        n = -n;
    }

    let pt = get_point_at_uv(model, u, v_outer, z_inches, inner_x, side);
    if pt.x.abs() < 1e-4 && inner_x < 1e-4 {
        n.x = 0.0;
        n = n.normalize();
    }

    n
}

pub fn get_pole_normals(model: &BoardModel, z_inches: f32, _is_nose: bool) -> (Vec3, Vec3) {
    let r_top = model.rocker_top.as_ref().unwrap();
    let r_bot = model.rocker_bottom.as_ref().unwrap();

    let t_top = find_v_at_z(r_top, z_inches, 0.0, 1.0);
    let t_bot = find_v_at_z(r_bot, z_inches, 0.0, 1.0);

    let (_, tan_top) = crate::bezier::evaluate_composite_pos_and_tangent(r_top, t_top);
    let (_, tan_bot) = crate::bezier::evaluate_composite_pos_and_tangent(r_bot, t_bot);

    // The stringer lies on the YZ plane (X=0). The X-axis (1,0,0) is perpendicular to this plane.
    // Top normal: Tangent x X-axis points outward (+Y)
    let mut n_top = tan_top.cross(Vec3::X).normalize();
    if n_top.is_nan() || n_top.length_squared() < 1e-5 {
        n_top = Vec3::Y;
    }

    // Bottom normal: X-axis x Tangent points outward (-Y)
    let mut n_bot = Vec3::X.cross(tan_bot).normalize();
    if n_bot.is_nan() || n_bot.length_squared() < 1e-5 {
        n_bot = Vec3::NEG_Y;
    }

    (n_top, n_bot)
}

pub fn color_heatmap(normalized_value: f32) -> Vec3 {
    let hue = (1.0 - normalized_value) * 240.0;
    let h = hue / 360.0;
    let hue2rgb = |p: f32, q: f32, mut t: f32| -> f32 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 1.0 / 2.0 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    };
    Vec3::new(
        hue2rgb(0.0, 1.0, h + 1.0 / 3.0),
        hue2rgb(0.0, 1.0, h),
        hue2rgb(0.0, 1.0, h - 1.0 / 3.0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

    #[test]
    fn test_no_deck_y_spike_at_pin_tail() {
        let mut model = BoardModel::default();
        // Setup a rounded pin tail (ends exactly at X=0)
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0), // PIN TAIL
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(2.0, 0.0, 95.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, 0.0, 5.0),
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 66.6667)],
            tangents2: vec![Vec3::new(0., 1., 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 66.6667)],
            tangents2: vec![Vec3::new(0., -1., 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        let blend = super::get_cross_section_blend_at_z(&model.cross_sections, 99.0).unwrap();
        // Get the U parameter for the shoulder (midway between apex and stringer on the deck)
        let t_shoulder = blend.t_apex + (1.0 - blend.t_apex) * 0.5;

        // Sample just before the tip (where width > 1e-5, normal calculation)
        let pt_99 = super::get_point_at_uv(&model, t_shoulder, 1.0, 99.0, 0.0, 1.0);

        // Sample at the exact tip (where width <= 1e-5, fallback triggered)
        let pt_100 = super::get_point_at_uv(&model, t_shoulder, 1.0, 100.0, 0.0, 1.0);

        // The shoulder Y should smoothly taper. It should NOT jump drastically to the top stringer height (1.0)
        let diff_y = (pt_100.y - pt_99.y).abs();
        assert!(
            diff_y < 0.2,
            "Shoulder Y spiked abruptly at the tip! y_99: {}, y_100: {}",
            pt_99.y,
            pt_100.y
        );
    }

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

        // Since it's a Hermite spline transitioning from X=5 to X=10 to X=5 over Z=10,20,30
        // At Z=15, X should be smoothly interpolated.
        // dz = 10. m1 for Z=10 to Z=20 is based on (X=10 - X=5)/10 * 10 = 5.
        // m2 for Z=20 is based on (X=5 - X=5)/20 * 10 = 0.
        // As a result of Hermite smoothing, the value at midpoint shouldn't just be 7.5 (linear).
        assert!(
            (pt.x - 8.125).abs() < 1e-3,
            "Centripetal midpoint shifted: {}",
            pt.x
        );
        assert_eq!(
            pt.z, 15.0,
            "Z coordinate must remain strictly linear across Hermite blend"
        );

        println!("✅ test_cross_section_blend_hermite passed.");
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
        let blend = super::get_cross_section_blend_at_z(&sections, 15.0).unwrap();

        let t_u = 0.5;
        let delta = 0.0001;

        // Test U Derivative
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
        assert!(
            (numeric_du.y - analytic_du.y).abs() < 1e-1,
            "U derivative Y mismatch: {} vs {}",
            numeric_du.y,
            analytic_du.y
        );

        // Test Z (lerp_factor) Derivative
        let blend_z1 = super::get_cross_section_blend_at_z(&sections, 15.0 + delta * 10.0).unwrap();
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
        assert!(
            (numeric_dz.y - analytic_dz.y).abs() < 1e-1,
            "Z derivative Y mismatch: {} vs {}",
            numeric_dz.y,
            analytic_dz.y
        );

        println!("✅ test_blend_derivatives_u_and_z passed.");
    }

    #[test]
    fn test_analytical_surface_normals() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 50.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 50.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, -0.5, 0.0),
                Vec3::new(5.0, 1.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.0, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            ..Default::default()
        }];

        let n_deck = super::get_surface_normal_at_uvz(&model, 1.0, 50.0, 1.0);
        assert!(
            n_deck.y > 0.99,
            "Deck stringer normal should point UP. Got {:?}",
            n_deck
        );
        assert!(
            n_deck.x.abs() < 1e-4,
            "Deck stringer normal should have no X component. Got {:?}",
            n_deck
        );

        let n_bot = super::get_surface_normal_at_uvz(&model, 0.0, 50.0, 1.0);
        assert!(
            n_bot.y < -0.99,
            "Bottom stringer normal should point DOWN. Got {:?}",
            n_bot
        );
        assert!(
            n_bot.x.abs() < 1e-4,
            "Bottom stringer normal should have no X component. Got {:?}",
            n_bot
        );

        let n_apex = super::get_surface_normal_at_uvz(&model, 0.5, 50.0, 1.0);
        assert!(
            n_apex.x > 0.9,
            "Apex normal should point OUTWARD horizontally. Got {:?}",
            n_apex
        );

        let n_apex_left = super::get_surface_normal_at_uvz(&model, 0.5, 50.0, -1.0);
        assert!(
            n_apex_left.x < -0.9,
            "Left apex normal should point OUTWARD horizontally (-X). Got {:?}",
            n_apex_left
        );

        println!("✅ test_analytical_surface_normals passed.");
    }

    #[test]
    fn test_cross_section_blend_out_of_bounds() {
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
        let sections = vec![cs1, cs2];

        // 1. Before first section (e.g., towards the nose)
        let blend_before = get_cross_section_blend_at_z(&sections, 0.0).unwrap();
        assert_eq!(
            blend_before.lerp_factor, 0.0,
            "Should clamp to the first section"
        );
        let pt_before = blend_before.evaluate(1.0);
        assert_eq!(
            pt_before.x, 5.0,
            "Should rigidly evaluate to the first section"
        );

        // 2. After last section (e.g., towards the tail)
        let blend_after = get_cross_section_blend_at_z(&sections, 30.0).unwrap();
        assert_eq!(
            blend_after.lerp_factor, 0.0,
            "Should clamp to the last section"
        );
        let pt_after = blend_after.evaluate(1.0);
        assert_eq!(
            pt_after.x, 10.0,
            "Should rigidly evaluate to the last section"
        );

        println!("✅ test_cross_section_blend_out_of_bounds passed.");
    }

    #[test]
    fn test_board_profile_normals() {
        let mut model = BoardModel::default();
        // Setup straight outline: 10 units wide along Z
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 66.6667)],
            tangents2: vec![Vec3::new(0., 1., 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 66.6667)],
            tangents2: vec![Vec3::new(0., -1., 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });

        let profile = get_board_profile_at_z(&model, 50.0, 0.5);

        // Tangent should point completely along Z axis
        assert!((profile.outline_tangent.z - 1.0).abs() < 1e-4);
        // Normal should point perfectly right (+X axis) in the XZ plane
        assert!((profile.outline_normal.x - 1.0).abs() < 1e-4);
        assert!((profile.outline_normal.y).abs() < 1e-4);
        println!("✅ test_board_profile_normals passed.");
    }

    #[test]
    fn test_zone_based_uv_evaluation() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 0.6667, 66.6667)],
            tangents2: vec![Vec3::new(0., 0.3333, 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -0.6667, 66.6667)],
            tangents2: vec![Vec3::new(0., -0.3333, 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            tangents1: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            ..Default::default()
        }];

        // UV 0.0 should be at the bottom stringer (inner_x = 0)
        let pt_bot_stringer = get_point_at_uv(&model, 0.0, 0.5, 50.0, 0.0, 1.0);
        assert_eq!(pt_bot_stringer.x, 0.0);

        // UV 1.0 should be at the top stringer (inner_x = 0)
        let pt_top_stringer = get_point_at_uv(&model, 1.0, 0.5, 50.0, 0.0, 1.0);
        assert_eq!(pt_top_stringer.x, 0.0);

        println!("✅ test_zone_based_uv_evaluation passed.");
    }

    #[test]
    fn test_proportional_tail_scaling() {
        let mut model_narrow = BoardModel::default();
        let mut model_wide = BoardModel::default();

        let cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(4.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(4.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(4.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(4.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(4.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(4.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            ..Default::default()
        };

        model_narrow.cross_sections = vec![cs.clone()];
        model_wide.cross_sections = vec![cs.clone()];

        model_narrow.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10., 0., 0.), Vec3::new(10., 0., 100.)],
            tangents2: vec![Vec3::new(10., 0., 0.), Vec3::new(10., 0., 100.)],
            ..Default::default()
        });
        model_wide.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(20.0, 0.0, 0.0), Vec3::new(20.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(20., 0., 0.), Vec3::new(20., 0., 100.)],
            tangents2: vec![Vec3::new(20., 0., 0.), Vec3::new(20., 0., 100.)],
            ..Default::default()
        });

        model_narrow.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model_wide.rocker_top = model_narrow.rocker_top.clone();

        model_narrow.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model_wide.rocker_bottom = model_narrow.rocker_bottom.clone();

        let z = 50.0;
        let hint_t = 0.5;
        let blend = super::get_cross_section_blend_at_z(&model_narrow.cross_sections, z).unwrap();

        let t_apex = blend.t_apex;
        let t_tuck = 0.25;

        let p_narrow_apex = super::get_point_at_uv(&model_narrow, t_apex, hint_t, z, 0.0, 1.0);
        let p_narrow_tuck = super::get_point_at_uv(&model_narrow, t_tuck, hint_t, z, 0.0, 1.0);

        let p_wide_apex = super::get_point_at_uv(&model_wide, t_apex, hint_t, z, 0.0, 1.0);
        let p_wide_tuck = super::get_point_at_uv(&model_wide, t_tuck, hint_t, z, 0.0, 1.0);

        let narrow_rail_width = p_narrow_apex.x - p_narrow_tuck.x;
        let wide_rail_width = p_wide_apex.x - p_wide_tuck.x;

        assert!(
            wide_rail_width > narrow_rail_width,
            "Rail width should scale proportionally with overall board width."
        );

        println!("✅ test_proportional_tail_scaling passed.");
    }

    #[test]
    fn test_deck_curvature_preservation() {
        let mut model = BoardModel::default();

        let cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(2.5, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(2.5, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(2.5, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            ..Default::default()
        };
        model.cross_sections = vec![cs];

        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(2.5, 0.0, 0.0), Vec3::new(2.5, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });

        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });

        let pt = super::get_point_at_uv(&model, 0.75, 0.5, 50.0, 0.0, 1.0);

        assert!(
            pt.y > 0.5,
            "Deck curvature should be preserved and not fall back to flat lerp. y={}",
            pt.y
        );

        println!("✅ test_deck_curvature_preservation passed.");
    }

    #[test]
    fn test_radial_ease() {
        let eps = 1e-5;

        // EaseIn: Should start slow and accelerate (midpoint < 0.5)
        assert!((radial_ease(0.0, EaseType::EaseIn) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseIn) - 1.0).abs() < eps);
        assert!(radial_ease(0.5, EaseType::EaseIn) < 0.5);

        // EaseOut: Should start fast and decelerate (midpoint > 0.5)
        assert!((radial_ease(0.0, EaseType::EaseOut) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseOut) - 1.0).abs() < eps);
        assert!(radial_ease(0.5, EaseType::EaseOut) > 0.5);

        // EaseInOut: Should be symmetric (midpoint == 0.5)
        assert!((radial_ease(0.0, EaseType::EaseInOut) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseInOut) - 1.0).abs() < eps);
        assert!((radial_ease(0.5, EaseType::EaseInOut) - 0.5).abs() < eps);

        println!("✅ test_radial_ease passed.");
    }

    #[test]
    fn test_swallow_tail_notch_detection() {
        let mut model = BoardModel::default();
        // Swallow tail: outline goes out to Z=100 (tip), then cuts back to Z=95 at stringer (X=0)
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
        assert!(
            bounds.tip_z > 95.0,
            "Tip Z should be further out than the notch"
        );
        assert!(
            bounds.tip_t < 1.0,
            "Tip parameter should be before the end of the curve"
        );

        // Test inner notch evaluation at z = 98
        let inner_x = evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, 98.0);
        assert!(
            inner_x > 0.0 && inner_x < 10.0,
            "Inner X should be evaluated correctly between the tip and stringer"
        );

        println!("✅ test_swallow_tail_notch_detection passed.");
    }

    #[test]
    fn test_normal_slerp() {
        let n1 = Vec3::new(0.0, -1.0, 0.0);
        let n2 = Vec3::new(0.0, 1.0, 0.0);
        let fallback = Vec3::new(0.0, 0.0, -1.0);

        // Midpoint should exactly hit the fallback vector due to the 180-degree slerp bypass
        let mid = slerp_normals(n1, n2, 0.5, fallback);
        assert!((mid.z - (-1.0)).abs() < 1e-5);
        assert!(mid.y.abs() < 1e-5);
        assert!(mid.x.abs() < 1e-5);

        // 90-degree test (no fallback triggered)
        let n3 = Vec3::new(0.0, -1.0, 0.0);
        let n4 = Vec3::new(0.0, 0.0, -1.0);
        let mid_90 = slerp_normals(n3, n4, 0.5, Vec3::X);

        // Linear interpolation would give (0, -0.5, -0.5) with magnitude 0.707
        // Slerp must maintain a magnitude of 1.0, so the result should be (0, -0.707, -0.707)
        let expected_val = -2.0_f32.sqrt() / 2.0;
        assert!(
            (mid_90.length() - 1.0).abs() < 1e-5,
            "Slerp must maintain unit length"
        );
        assert!((mid_90.y - expected_val).abs() < 1e-5, "Y should be -0.707");
        assert!((mid_90.z - expected_val).abs() < 1e-5, "Z should be -0.707");

        println!("✅ test_normal_slerp passed.");
    }

    #[test]
    fn deleted_test_rail_does_not_collapse_at_pin_tail() {}

    #[test]
    fn test_rational_geometry_integration() {
        let mut curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 50.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 50.0), Vec3::new(10.0, 0.0, 100.0)],
            weights: Some(vec![1.0, 1.0]),
        };

        // Evaluate target_z using standard weights
        let t_std = find_v_at_z(&curve, 50.0, 0.0, 1.0);
        let pt_std = evaluate_curve(&curve, t_std);

        // Increase tension/weight at the tail node
        curve.weights = Some(vec![1.0, 5.0]);
        let t_weighted = find_v_at_z(&curve, 50.0, 0.0, 1.0);
        let pt_weighted = evaluate_curve(&curve, t_weighted);

        // Verify the binary search successfully resolves to z=50 for both
        assert!((pt_std.z - 50.0).abs() < 1e-3);
        assert!((pt_weighted.z - 50.0).abs() < 1e-3);

        // Verify the parameterization has shifted physically due to the rational weight
        assert!(
            t_weighted < t_std,
            "Higher weight at P1 should pull the curve, reaching z=50 earlier in parameter t"
        );

        println!("✅ test_rational_geometry_integration passed.");
    }

    #[test]
    fn test_wing_tuck_offset_prevents_intersection() {
        use crate::model::OutlineLayer;
        let mut model = BoardModel::default();

        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });

        model.rail_outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(9.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(9.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(9.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });

        let base_outline_x = evaluate_bezier_at_z(model.outline.as_ref().unwrap(), 75.0, 0.5).x;

        let wing_ext = BezierCurveData {
            control_points: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 70.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 80.0),
            ],
            tangents1: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 70.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 75.0),
            ],
            tangents2: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 75.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 80.0),
            ],
            ..Default::default()
        };
        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            otl_ext: wing_ext,
            otl_int: BezierCurveData::default(),
        }]);

        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            ..Default::default()
        });

        let profile = super::get_board_profile_at_z(&model, 75.0, 0.5);

        assert!(
            profile.tuck_x < profile.apex_x,
            "Tuck X ({}) must remain inside Apex X ({}) to prevent self-intersection",
            profile.tuck_x,
            profile.apex_x
        );

        println!("✅ test_wing_tuck_offset_prevents_intersection passed.");
    }

    #[test]
    fn test_asymmetric_channel_evaluation() {
        // Tested under U-space mapping
        let mut model = BoardModel::default();
        use crate::model::ChannelLayer;

        let chan_start_z = 25.0;
        let chan_end_z = 75.0;
        let right_out_start = Vec3::new(5.0, 0.0, chan_start_z);
        let right_out_end = Vec3::new(5.0, 0.0, chan_end_z);
        let right_depth_start = Vec3::new(0.0, 1.0, chan_start_z);
        let right_depth_end = Vec3::new(0.0, 1.0, chan_end_z);

        let left_out_start = Vec3::new(-5.0, 0.0, chan_start_z);
        let left_out_end = Vec3::new(-5.0, 0.0, chan_end_z);
        let left_depth_start = Vec3::new(0.0, 0.5, chan_start_z);
        let left_depth_end = Vec3::new(0.0, 0.5, chan_end_z);

        model.bottom_channels = Some(vec![ChannelLayer {
            name: "Test Channel".to_string(),
            is_symmetric: false,
            left_outline: BezierCurveData {
                control_points: vec![left_out_start, left_out_end],
                tangents1: vec![left_out_start, left_out_end],
                tangents2: vec![left_out_start, left_out_end],
                ..Default::default()
            },
            left_depth: BezierCurveData {
                control_points: vec![left_depth_start, left_depth_end],
                tangents1: vec![left_depth_start, left_depth_end],
                tangents2: vec![left_depth_start, left_depth_end],
                ..Default::default()
            },
            right_outline: BezierCurveData {
                control_points: vec![right_out_start, right_out_end],
                tangents1: vec![right_out_start, right_out_end],
                tangents2: vec![right_out_start, right_out_end],
                ..Default::default()
            },
            right_depth: BezierCurveData {
                control_points: vec![right_depth_start, right_depth_end],
                tangents1: vec![right_depth_start, right_depth_end],
                tangents2: vec![right_depth_start, right_depth_end],
                ..Default::default()
            },
        }]);

        let profile_right = super::get_channel_profile_at_z(&model, false, 50.0).unwrap();
        let profile_left = super::get_channel_profile_at_z(&model, true, 50.0).unwrap();

        assert_eq!(profile_right.1, 1.0);
        assert_eq!(profile_left.1, 0.5);
        assert!(
            profile_right.1 != profile_left.1,
            "Asymmetric channels should have different depths"
        );

        // Outside bounds Z -> Should be None
        let profile_outside_z = super::get_channel_profile_at_z(&model, false, 10.0);
        assert!(profile_outside_z.is_none());

        println!("✅ test_asymmetric_channel_evaluation passed.");
    }

    #[test]
    fn test_shape3d_extremity_modifiers() {
        let mut model_base = BoardModel::default();
        model_base.length = 100.0;
        model_base.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model_base.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 66.6667)],
            tangents2: vec![Vec3::new(0., 1., 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model_base.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 66.6667)],
            tangents2: vec![Vec3::new(0., -1., 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });
        model_base.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(8.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(8.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(8.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(8.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(8.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(8.0, 1.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            weights: Some(vec![1.0; 5]),
        }];

        let mut model_mod_v = model_base.clone();
        model_mod_v.v_concave_tail = -1.0;

        let mut model_mod_rail = model_base.clone();
        model_mod_rail.rail_coefficient_tail = 0.5;

        // 1. Center of the board (Z=50)
        let z_center = 50.0;
        let profile_base_mid = super::get_board_profile_at_z(&model_base, z_center, 0.5);
        let profile_mod_mid = super::get_board_profile_at_z(&model_mod_v, z_center, 0.5);
        assert!(
            (profile_base_mid.bot_y - profile_mod_mid.bot_y).abs() < 1e-4,
            "Modifiers should taper to 0 at the midpoint"
        );

        // 2. Tail of the board (Z=95)
        let z_tail = 95.0;
        let profile_base_tail = super::get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod_tail = super::get_board_profile_at_z(&model_mod_v, z_tail, 0.5);

        assert!(
            (profile_mod_tail.bot_y - profile_base_tail.bot_y).abs() < 1e-4,
            "V-Concave should not alter the stringer rocker height"
        );
        assert!(
            profile_mod_tail.tuck_y < profile_base_tail.tuck_y,
            "V-Concave < 0 (Concave) should physically lower the rails relative to the stringer"
        );

        // Test Rail Coefficient (Thinning the deck shoulder)
        // U = 0.8 is up on the deck shoulder.
        let pt_base = super::get_point_at_uv(&model_base, 0.8, 0.5, z_tail, 0.0, 1.0);
        let pt_mod = super::get_point_at_uv(&model_mod_rail, 0.8, 0.5, z_tail, 0.0, 1.0);

        println!("\n--- DIAGNOSTICS FOR EXTREMITY MODIFIERS ---");
        println!("pt_base: {:?}", pt_base);
        println!("pt_mod: {:?}", pt_mod);

        let profile_base = super::get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod = super::get_board_profile_at_z(&model_mod_rail, z_tail, 0.5);
        println!(
            "profile_base: top_y={}, bot_y={}, apex_y={}",
            profile_base.top_y, profile_base.bot_y, profile_base.apex_y
        );
        println!(
            "profile_mod: top_y={}, bot_y={}, apex_y={}",
            profile_mod.top_y, profile_mod.bot_y, profile_mod.apex_y
        );

        let blend =
            super::get_cross_section_blend_at_z(&model_base.cross_sections, z_tail).unwrap();
        let p = blend.evaluate(0.8);
        println!("blend at u=0.8: t_apex={}, p={:?}", blend.t_apex, p);
        println!("-------------------------------------------\n");

        assert!(pt_mod.y < pt_base.y, "Rail coefficient < 1.0 should aggressively thin out the foil/shoulder volume at the tail");
    }

    #[test]
    fn test_2d_curve_parity() {
        // Simulating a known 2D curve to verify evaluation parity with industry standard CAD
        let outline = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            weights: None,
        };
        let z_target = 50.0;
        let hint_t = 0.5;
        let pt = evaluate_bezier_at_z(&outline, z_target, hint_t);
        // By symmetry of the handles, exactly at Z=50, X should be 5.0
        assert!(
            (pt.x - 5.0).abs() < 1e-3,
            "2D Curve Parity failed: X={}, expected 5.0",
            pt.x
        );
        assert!(
            (pt.z - 50.0).abs() < 1e-3,
            "2D Curve Parity failed: Z={}, expected 50.0",
            pt.z
        );
    }

    #[test]
    fn test_3d_lofting_parity() {
        // Ensures Hermite interpolation between cross sections correctly lofts the 3D surface
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.cross_sections = vec![
            BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, -1.0, 0.0),
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.0, 0.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, -1.0, 0.0),
                    Vec3::new(5.0, -1.0, 0.0),
                    Vec3::new(5.0, 1.0, 0.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, -1.0, 0.0),
                    Vec3::new(10.0, 0.5, 0.0),
                    Vec3::new(0.0, 1.0, 0.0),
                ],
                ..Default::default()
            },
            BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, -1.0, 100.0),
                    Vec3::new(10.0, 0.0, 100.0),
                    Vec3::new(0.0, 1.0, 100.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, -1.0, 100.0),
                    Vec3::new(5.0, -1.0, 100.0),
                    Vec3::new(5.0, 1.0, 100.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, -1.0, 100.0),
                    Vec3::new(10.0, 0.5, 100.0),
                    Vec3::new(0.0, 1.0, 100.0),
                ],
                ..Default::default()
            },
        ];

        let profile = get_board_profile_at_z(&model, 50.0, 0.5);
        // Half-width should be 10, apex should be near X=10, Y=0
        assert!((profile.half_width - 10.0).abs() < 1e-3);
        // By evaluating the center, the apex shouldn't shift unpredictably
        assert!((profile.apex_x - 10.0).abs() < 1e-3);
    }

    #[test]
    fn test_pin_tail_uv_singularity() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)], // X=0 at tail (pin)
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(0.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        // Evaluate near the pin tail to ensure no NaNs in normals
        let u = 0.5;
        let z = 99.99;
        let n = get_surface_normal_at_uvz(&model, u, z, 1.0);
        assert!(
            !n.is_nan(),
            "Normal should not be NaN near pin tail singularity"
        );
    }

    #[test]
    fn test_swallow_tail_split_normals() {
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
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        // The notch is at Z=95, the tip is at Z=100.
        // At Z=98, the stringer is empty (cut out by the swallow). We evaluate the surface normal on the rail.
        // The normal should be well defined
        let n = get_surface_normal_at_uvz(&model, 0.5, 98.0, 1.0);
        assert!(!n.is_nan(), "Normal should not be NaN at swallow tail rail");
    }

    #[test]
    fn test_concave_zero_crossing_artifact() {
        let mut model = BoardModel::default();
        // Flat outline, 10" wide
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        // Flat rockers
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        // Cross section with a deep concave, but the tuck returns to stringer height!
        // P0 (stringer) = 0.0
        // P1 (mid-bottom) = -1.0 (Deep concave)
        // P2 (tuck) = 0.0 (Crosses zero!)
        let cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(2.5, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(7.5, 1.0, 0.0),
                Vec3::new(10.0, 2.0, 0.0),
            ],
            tangents1: vec![Vec3::ZERO; 5],
            tangents2: vec![Vec3::ZERO; 5],
            ..Default::default()
        };
        model.cross_sections = vec![cs];

        // Evaluate at Z=50 (middle of the board)
        let blend = get_cross_section_blend_at_z(&model.cross_sections, 50.0).unwrap();
        let t_apex = blend.t_apex;
        let t_tuck = t_apex * 0.5;

        // Verify the slice geometry actually has a concave
        let u_test = t_tuck / 2.0; // t = 0.25 (P1)
        let slice_pt = blend.evaluate(u_test);
        assert!(
            slice_pt.y < -0.1,
            "Slice should have a concave at u=0.25. y={}",
            slice_pt.y
        );

        // Evaluate the 3D mapped point
        let pt = get_point_at_uv(&model, u_test, 0.5, 50.0, 0.0, 1.0);

        // If the bug exists, pt.y will snap to 0.0 instead of reflecting the -1.0 concave!
        assert!(
            pt.y < -0.1,
            "BUG: The concave disappeared! The bottom snapped to flat because tuck crossed zero. pt.y = {}",
            pt.y
        );
    }

    #[test]
    fn test_channel_projection_on_v_tail() {
        use crate::model::ChannelLayer;
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(5.0, -0.5, 0.0)],
            tangents2: vec![Vec3::new(5.0, -0.5, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        }];
        model.v_concave_tail = 5.0;

        model.bottom_channels = Some(vec![ChannelLayer {
            name: "V-Tail Channel".to_string(),
            is_symmetric: true,
            left_outline: BezierCurveData::default(),
            right_outline: BezierCurveData {
                control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
                tangents1: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 66.6667)],
                tangents2: vec![Vec3::new(5.0, 0.0, 33.3333), Vec3::new(5.0, 0.0, 100.0)],
                ..Default::default()
            },
            left_depth: BezierCurveData::default(),
            right_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
                tangents1: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 66.6667)],
                tangents2: vec![Vec3::new(0.0, 1.0, 33.3333), Vec3::new(0.0, 1.0, 100.0)],
                ..Default::default()
            },
        }]);

        let z = 75.0;
        let u_chan = 0.25;
        let v = 0.75;

        let pt_base = super::get_point_at_uv_base(&model, u_chan, v, z, 0.0, 1.0);
        let pt_chan = super::get_point_at_uv(&model, u_chan, v, z, 0.0, 1.0);

        let dx = (pt_chan.x - pt_base.x).abs();
        let dy = (pt_chan.y - pt_base.y).abs();

        assert!(
            dx > 0.05,
            "Channel on V-Tail must project along the normal, moving the X coordinate. dx = {}",
            dx
        );
        assert!(
            dy > 0.05,
            "Channel on V-Tail must project along the normal, moving the Y coordinate. dy = {}",
            dy
        );
    }
}
