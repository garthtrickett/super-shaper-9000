use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub fn cleanup_vertical_ends(mut curve: BezierCurveData, is_thickness: bool) -> BezierCurveData {
    if curve.control_points.len() < 3 {
        return curve;
    }

    let is_cap = |dz: f32, d_cross: f32| -> bool {
        // Strip if it's perfectly flat in Z (micro-cap)
        if dz < 0.05 {
            return true;
        }
        // Strip if the slope is nearly vertical (a cap closing the shape)
        if d_cross > 0.2 && d_cross > dz * 4.0 {
            return true;
        }
        false
    };

    // 1. Clean up START
    loop {
        let p0 = curve.control_points[0];
        let p1 = curve.control_points[1];
        let dz = (p1.z - p0.z).abs();
        let d_cross = if is_thickness {
            (p1.y - p0.y).abs()
        } else {
            (p1.x - p0.x).abs()
        };

        if is_cap(dz, d_cross) {
            curve.control_points.remove(0);
            curve.tangents1.remove(0);
            curve.tangents2.remove(0);
            if let Some(w) = &mut curve.weights {
                w.remove(0);
            }
            if curve.control_points.len() < 3 {
                break;
            }
        } else {
            break;
        }
    }

    // 2. Clean up END
    loop {
        let len = curve.control_points.len();
        let p_last = curve.control_points[len - 1];
        let p_prev = curve.control_points[len - 2];
        let dz = (p_last.z - p_prev.z).abs();
        let d_cross = if is_thickness {
            (p_last.y - p_prev.y).abs()
        } else {
            (p_last.x - p_prev.x).abs()
        };

        if is_cap(dz, d_cross) {
            curve.control_points.pop();
            curve.tangents1.pop();
            curve.tangents2.pop();
            if let Some(w) = &mut curve.weights {
                w.pop();
            }
            if curve.control_points.len() < 3 {
                break;
            }
        } else {
            break;
        }
    }

    curve
}

pub fn inject_export_caps(mut curve: BezierCurveData, is_thickness: bool) -> BezierCurveData {
    if curve.control_points.is_empty() {
        return curve;
    }

    let check_val = |p: Vec3| -> f32 {
        if is_thickness {
            p.y
        } else {
            p.x
        }
    };

    let first_p = curve.control_points[0];
    if check_val(first_p).abs() > 1e-4 {
        let mut new_p = first_p;
        if is_thickness {
            new_p.y = 0.0;
        } else {
            new_p.x = 0.0;
        }
        curve.control_points.insert(0, new_p);
        curve.tangents1.insert(0, new_p);
        curve.tangents2.insert(0, new_p);

        if let Some(w) = &mut curve.weights {
            w.insert(0, 1.0);
        }
    }

    let last_p = *curve.control_points.last().unwrap();
    if check_val(last_p).abs() > 1e-4 {
        let mut new_p = last_p;
        if is_thickness {
            new_p.y = 0.0;
        } else {
            new_p.x = 0.0;
        }
        curve.control_points.push(new_p);
        curve.tangents1.push(new_p);
        curve.tangents2.push(new_p);

        if let Some(w) = &mut curve.weights {
            w.push(1.0);
        }
    }

    curve
}

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
        nose_z: -model.length / 2.0,
        tip_z: model.length / 2.0,
        notch_z: model.length / 2.0,
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

    // With unified endpoint synchronization implemented, the outline's boundaries
    // represent the absolute, canonical start and end Z-positions of the board.
    let nose_z = out_nose_z;
    let tip_z = out_tip_z;

    BoardBounds {
        nose_z,
        tip_z,
        notch_z,
        tip_t,
    }
}

pub fn evaluate_bezier_t_at_z_robust(curve: &BezierCurveData, target_z: f32, hint_t: f32) -> f32 {
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
            if !layer.active {
                continue;
            }

            // If otl_int is empty (single-curve layer, e.g. the synthetic test),
            // the outer outline of the board is otl_ext.
            // If otl_int is present (dual-curve wing layer), it is otl_int.
            let target_curve = if layer.otl_int.control_points.is_empty() {
                &layer.otl_ext
            } else {
                &layer.otl_int
            };

            if target_curve.control_points.is_empty() {
                continue;
            }

            let min_z = target_curve.control_points.first().unwrap().z;
            let max_z = target_curve.control_points.last().unwrap().z;
            let z0 = min_z.min(max_z);
            let z1 = min_z.max(max_z);

            if z_inches >= z0 - 1e-4 && z_inches <= z1 + 1e-4 {
                let (pt, tan) = evaluate_bezier_pos_and_tan_at_z(target_curve, z_inches, hint_t);
                final_x = pt.x;
                final_tan = tan;
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
    if let Some(ar) = curve.apex_ratio {
        return ar;
    }

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
    pub t_tuck: f32,
    pub s_prev: &'a BezierCurveData,
    pub s0: &'a BezierCurveData,
    pub s1: &'a BezierCurveData,
    pub s_next: &'a BezierCurveData,
    pub lerp_factor: f32,
    pub a0: f32,
    pub a1: f32,
    pub a2: f32,
    pub b1: f32,
    pub b2: f32,
    pub b3: f32,
    pub dz: f32,
}

impl<'a> BlendResult<'a> {
    pub fn evaluate(&self, t_mid: f32) -> Vec3 {
        let p1 = evaluate_curve(self.s0, t_mid);
        let p2 = evaluate_curve(self.s1, t_mid);

        let p_prev = evaluate_curve(self.s_prev, t_mid);
        let p0 = evaluate_curve(self.s0, t_mid);
        let p1_eval = evaluate_curve(self.s1, t_mid);
        let p_next = evaluate_curve(self.s_next, t_mid);

        let mut m1 = p_prev * self.a0 + p0 * self.a1 + p1_eval * self.a2;
        let mut m2 = p0 * self.b1 + p1_eval * self.b2 + p_next * self.b3;

        m1.z = self.dz;
        m2.z = self.dz;

        crate::bezier::evaluate_cubic_hermite(p1, p2, m1, m2, self.lerp_factor)
    }

    pub fn evaluate_derivative_u(&self, t_mid: f32) -> Vec3 {
        let dp1 = evaluate_curve_derivative(self.s0, t_mid);
        let dp2 = evaluate_curve_derivative(self.s1, t_mid);

        let dp_prev = evaluate_curve_derivative(self.s_prev, t_mid);
        let dp0 = evaluate_curve_derivative(self.s0, t_mid);
        let dp1_eval = evaluate_curve_derivative(self.s1, t_mid);
        let dp_next = evaluate_curve_derivative(self.s_next, t_mid);

        let mut m1 = dp_prev * self.a0 + dp0 * self.a1 + dp1_eval * self.a2;
        let mut m2 = dp0 * self.b1 + dp1_eval * self.b2 + dp_next * self.b3;

        m1.z = 0.0;
        m2.z = 0.0;

        crate::bezier::evaluate_cubic_hermite(dp1, dp2, m1, m2, self.lerp_factor)
    }

    pub fn evaluate_derivative_z(&self, t_mid: f32) -> Vec3 {
        let p1 = evaluate_curve(self.s0, t_mid);
        let p2 = evaluate_curve(self.s1, t_mid);

        let p_prev = evaluate_curve(self.s_prev, t_mid);
        let p0 = evaluate_curve(self.s0, t_mid);
        let p1_eval = evaluate_curve(self.s1, t_mid);
        let p_next = evaluate_curve(self.s_next, t_mid);

        let mut m1 = p_prev * self.a0 + p0 * self.a1 + p1_eval * self.a2;
        let mut m2 = p0 * self.b1 + p1_eval * self.b2 + p_next * self.b3;

        m1.z = self.dz;
        m2.z = self.dz;

        crate::bezier::evaluate_cubic_hermite_derivative(p1, p2, m1, m2, self.lerp_factor)
    }
}

pub fn get_cross_section_blend_at_z<'a>(
    cross_sections: &'a [BezierCurveData],
    z_inches: f32,
) -> Option<BlendResult<'a>> {
    let valid_sections: Vec<&'a BezierCurveData> = cross_sections
        .iter()
        .filter(|cs| {
            cs.control_points.len() > 1 && !cs.control_points.iter().all(|p| p.x.abs() < 1e-4)
        })
        .collect();

    if valid_sections.is_empty() {
        return None;
    }
    let min_z = valid_sections
        .first()
        .unwrap()
        .control_points
        .first()
        .unwrap()
        .z;
    let max_z = valid_sections
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
        k0 = valid_sections.len().saturating_sub(1);
    } else {
        for k in 0..valid_sections.len() - 1 {
            let z0 = valid_sections[k].control_points.first().unwrap().z;
            let z1 = valid_sections[k + 1].control_points.first().unwrap().z;
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
    let k1 = (k0 + 1).min(valid_sections.len() - 1);
    let k_next = (k0 + 2).min(valid_sections.len() - 1);

    let s_prev = valid_sections[k_prev];
    let s0 = valid_sections[k0];
    let s1 = valid_sections[k1];
    let s_next = valid_sections[k_next];

    let t_apex0 = find_apex_t(s0);
    let t_apex1 = find_apex_t(s1);
    // Apex parameter interpolation remains strictly linear
    let t_apex = (t_apex0 + (t_apex1 - t_apex0) * lerp_factor).clamp(0.0, 1.0);

    let t_tuck0 = s0.tuck_ratio.unwrap_or_else(|| 0.01_f32.max(t_apex0 * 0.5));
    let t_tuck1 = s1.tuck_ratio.unwrap_or_else(|| 0.01_f32.max(t_apex1 * 0.5));
    let t_tuck = (t_tuck0 + (t_tuck1 - t_tuck0) * lerp_factor).clamp(0.0, 1.0);

    let v_prev = s_prev.control_points.first().copied().unwrap_or(Vec3::ZERO);
    let v0 = s0.control_points.first().copied().unwrap_or(Vec3::ZERO);
    let v1 = s1.control_points.first().copied().unwrap_or(Vec3::ZERO);
    let v_next = s_next.control_points.first().copied().unwrap_or(Vec3::ZERO);

    let dt0 = v0.distance(v_prev).sqrt();
    let dt1 = v1.distance(v0).sqrt();
    let dt2 = v_next.distance(v1).sqrt();
    let dz = v1.z - v0.z;

    let (a0, a1, a2) = if dt1 < 1e-5 || dt0 < 1e-5 {
        (0.0, -1.0, 1.0)
    } else {
        let k = dt1 / (dt0 + dt1);
        let a0 = -(dt1 / dt0) * k;
        let a2 = (dt0 / dt1) * k;
        let a1 = -a0 - a2;
        (a0, a1, a2)
    };

    let (b1, b2, b3) = if dt1 < 1e-5 {
        (0.0, 0.0, 0.0)
    } else if dt2 < 1e-5 {
        (-1.0, 1.0, 0.0)
    } else {
        let k2 = dt1 / (dt1 + dt2);
        let b1 = -(dt2 / dt1) * k2;
        let b3 = (dt1 / dt2) * k2;
        let b2 = -b1 - b3;
        (b1, b2, b3)
    };

    Some(BlendResult {
        t_apex,
        t_tuck,
        s_prev,
        s0,
        s1,
        s_next,
        lerp_factor,
        a0,
        a1,
        a2,
        b1,
        b2,
        b3,
        dz,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bezier::*;
    use crate::model::BezierCurveData;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn test_cubic_hermite_z_linearity() {
        // This test proves that while X and Y can curve smoothly, Z remains mathematically
        // linear. This is critical for 3D lofting to prevent self-intersecting meshes.
        let p1 = Vec3::new(0.0, 0.0, 10.0);
        let p2 = Vec3::new(0.0, 0.0, 20.0);

        let dz = 10.0;
        let m1 = Vec3::new(0.0, 0.0, dz);
        let m2 = Vec3::new(0.0, 0.0, dz);

        let mid = evaluate_cubic_hermite(p1, p2, m1, m2, 0.5);
        assert_eq!(
            mid.z, 15.0,
            "Z coordinate must remain perfectly linear to prevent bulging"
        );
        println!("✅ test_cubic_hermite_z_linearity passed.");
    }

    #[test]
    fn test_derivatives_and_curvature() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // 1. Straight line
        let t0_straight = Vec3::new(1.0, 0.0, 0.0);
        let t1_straight = Vec3::new(2.0, 0.0, 0.0);

        let d2_straight = evaluate_bezier_second_derivative(p0, t0_straight, t1_straight, p1, 0.5);
        assert_eq!(d2_straight, Vec3::ZERO);

        let quill_straight =
            evaluate_curvature_quill(p0, t0_straight, t1_straight, p1, None, 0.5, 1.0);
        assert_eq!(quill_straight, Vec3::ZERO);

        // 2. Bent curve
        let t0_bent = Vec3::new(1.0, 1.0, 0.0);
        let t1_bent = Vec3::new(2.0, 1.0, 0.0);

        let d1_bent = evaluate_bezier_first_derivative(p0, t0_bent, t1_bent, p1, 0.5);
        let quill_bent = evaluate_curvature_quill(p0, t0_bent, t1_bent, p1, None, 0.5, 1.0);

        // The magnitude of the quill should be greater than 0 since the curve is bent
        assert!(
            quill_bent.length() > 0.0,
            "Curvature quill should be non-zero for a bent curve"
        );

        // The dot product of the first derivative and principal normal (quill) should be 0 (perpendicular)
        assert!(
            d1_bent.dot(quill_bent).abs() < 1e-5,
            "Quill should be perpendicular to tangent"
        );

        println!("✅ test_derivatives_and_curvature passed.");
    }

    #[test]
    fn test_evaluate_bezier_cubic() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 0.0, 0.0);
        let t1 = Vec3::new(2.0, 0.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // Evaluated exactly at the midpoint
        let mid = evaluate_bezier_cubic(p0, t0, t1, p1, 0.5);

        // A straight line bezier should evaluate precisely to its midpoint
        assert_eq!(mid.x, 1.5);
        assert_eq!(mid.y, 0.0);
        assert_eq!(mid.z, 0.0);
        println!("✅ evaluate_bezier_cubic passed.");
    }

    #[test]
    fn test_insert_node() {
        let mut curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 5.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, -5.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            weights: None,
            ..Default::default()
        };

        let new_idx = insert_node(&mut curve, 0.5);

        assert_eq!(new_idx, Some(1));
        assert_eq!(curve.control_points.len(), 3);
        assert_eq!(curve.tangents1.len(), 3);
        assert_eq!(curve.tangents2.len(), 3);

        let expected_mid = evaluate_bezier_cubic(
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(5.0, -5.0, 0.0),
            Vec3::new(5.0, 5.0, 0.0),
            Vec3::new(10.0, 0.0, 0.0),
            0.5,
        );
        assert_eq!(curve.control_points[1], expected_mid);
        println!("✅ test_insert_node passed.");
    }

    #[test]
    fn test_sample_curve() {
        let curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };

        let samples = sample_curve(&curve, 2);
        assert_eq!(samples.len(), 3);

        assert_eq!(samples[0].x, 0.0);
        assert_eq!(samples[1].x, 5.0);
        assert_eq!(samples[2].x, 10.0);
        println!("✅ sample_curve passed and generated expected vertex distribution.");
    }

    #[test]
    fn test_solve_g2_tangent_collinear_safety() {
        let anchor = Vec3::new(0.0, 0.0, 0.0);

        // Create perfectly flat source and target segments along the X-axis
        let f_source = Vec3::new(-10.0, 0.0, 0.0);
        let t_source = Vec3::new(-5.0, 0.0, 0.0);
        let f_target = Vec3::new(10.0, 0.0, 0.0);

        let t_target = solve_g2_tangent(anchor, t_source, f_source, f_target);

        // G2 solver should intercept the collinearity and fallback to smooth G1
        // rather than outputting NaN/Infinity.
        assert!(
            !t_target.x.is_nan(),
            "G2 solver exploded to NaN on flat geometry!"
        );
        assert_eq!(
            t_target.x, 5.0,
            "G2 solver should return mirrored G1 vector for collinear inputs"
        );
        assert_eq!(t_target.y, 0.0);
        assert_eq!(t_target.z, 0.0);
    }

    #[test]
    fn test_solve_g2_tangent() {
        let anchor = Vec3::new(0.0, 0.0, 0.0);

        // Source curve (Left side, evaluates at t=1)
        let f_source = Vec3::new(-2.0, 1.0, 0.0); // A1
        let t_source = Vec3::new(-1.0, 0.0, 0.0); // A2

        // Target curve (Right side, evaluates at t=0)
        let f_target = Vec3::new(2.0, -2.0, 0.0); // B2

        let t_target = solve_g2_tangent(anchor, t_source, f_source, f_target);

        // Expected mathematically: c = sqrt(2). t_target = (sqrt(2), 0, 0)
        let c_expected = 2.0_f32.sqrt();
        assert!((t_target.x - c_expected).abs() < 1e-5);
        assert_eq!(t_target.y, 0.0);
        assert_eq!(t_target.z, 0.0);

        // Verify dynamically using evaluate_curvature_quill
        let quill_src = evaluate_curvature_quill(
            Vec3::new(-3.0, 0.0, 0.0), // Arbitrary A0
            f_source,
            t_source,
            anchor,
            None,
            1.0,
            1.0,
        );

        let quill_tgt = evaluate_curvature_quill(
            anchor,
            t_target,
            f_target,
            Vec3::new(3.0, 0.0, 0.0), // Arbitrary B3
            None,
            0.0,
            1.0,
        );

        // Quills must match in length (curvature magnitude) perfectly across the joint.
        assert!(
            (quill_src.length() - quill_tgt.length()).abs() < 1e-5,
            "G2 Curvatures must match!"
        );

        println!("✅ test_solve_g2_tangent passed.");
    }

    #[test]
    fn test_rational_bezier_equivalence() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 1.0, 0.0);
        let t1 = Vec3::new(2.0, -1.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        let t = 0.3;
        let std_pos = evaluate_bezier_cubic(p0, t0, t1, p1, t);
        let rat_pos = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);

        assert!(
            (std_pos - rat_pos).length() < 1e-5,
            "Rational with weights 1.0 must match Standard"
        );

        let std_d1 = evaluate_bezier_first_derivative(p0, t0, t1, p1, t);
        let rat_d1 = evaluate_rational_first_derivative(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);
        assert!(
            (std_d1 - rat_d1).length() < 1e-5,
            "Rational d1 with weights 1.0 must match Standard"
        );

        let std_d2 = evaluate_bezier_second_derivative(p0, t0, t1, p1, t);
        let rat_d2 = evaluate_rational_second_derivative(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);
        assert!(
            (std_d2 - rat_d2).length() < 1e-4,
            "Rational d2 with weights 1.0 must match Standard"
        );
    }

    #[test]
    fn test_rational_weight_pull() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 5.0, 0.0);
        let t1 = Vec3::new(2.0, 5.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        let mid_std = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, 0.5);

        // Increase weight of P0
        let mid_pulled = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 10.0, 1.0, 1.0, 1.0, 0.5);

        // P0 is at origin, so mid_pulled should be closer to origin than mid_std
        assert!(
            mid_pulled.length() < mid_std.length(),
            "Increasing P0 weight should pull curve towards P0"
        );
    }

    #[test]
    fn test_rational_derivatives_endpoints() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 1.0, 0.0);
        let t1 = Vec3::new(2.0, -1.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // t = 0
        let d1_start = evaluate_rational_first_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 0.0);
        let d2_start = evaluate_rational_second_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 0.0);
        assert!(
            !d1_start.is_nan() && !d2_start.is_nan(),
            "Derivatives should not be NaN at t=0"
        );

        // t = 1
        let d1_end = evaluate_rational_first_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 1.0);
        let d2_end = evaluate_rational_second_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 1.0);
        assert!(
            !d1_end.is_nan() && !d2_end.is_nan(),
            "Derivatives should not be NaN at t=1"
        );
    }

    #[test]
    fn test_adaptive_sampling() {
        // Curve 1: Straight line
        let straight = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };
        let t_straight = adaptive_sample_t(&straight, 5.0, 0.1);
        // With depth < 3 forced, it should split into 8 segments -> 9 points
        assert_eq!(t_straight.len(), 9);

        // Curve 2: Highly bent curve
        let bent = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 10.0, 0.0)],
            tangents2: vec![Vec3::new(0.0, 10.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };
        let t_bent = adaptive_sample_t(&bent, 5.0, 0.1);
        // The bent curve requires more subdivisions to meet the angle tolerance
        assert!(
            t_bent.len() > 9,
            "Bent curve should subdivide heavily compared to a straight curve"
        );

        println!("✅ test_adaptive_sampling passed.");
    }

    #[test]
    fn test_uv_arc_length_uniformity() {
        let curve = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(20.0, 0.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(15.0, 0.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(15.0, 0.0, 0.0),
                Vec3::new(20.0, 0.0, 0.0),
            ],
            ..Default::default()
        };

        // Create a highly asymmetrical parameterization via weights
        let mut asym_curve = curve.clone();
        asym_curve.weights = Some(vec![1.0, 10.0, 1.0]);

        let table = build_arc_length_table(&asym_curve, 1000);

        let t25 = get_t_at_arc_length_ratio(&table, 0.25);
        let t50 = get_t_at_arc_length_ratio(&table, 0.50);
        let t75 = get_t_at_arc_length_ratio(&table, 0.75);

        let p0 = evaluate_composite_pos_and_tangent(&asym_curve, 0.0).0;
        let p25 = evaluate_composite_pos_and_tangent(&asym_curve, t25).0;
        let p50 = evaluate_composite_pos_and_tangent(&asym_curve, t50).0;
        let p75 = evaluate_composite_pos_and_tangent(&asym_curve, t75).0;
        let p100 = evaluate_composite_pos_and_tangent(&asym_curve, 1.0).0;

        let d1 = p0.distance(p25);
        let d2 = p25.distance(p50);
        let d3 = p50.distance(p75);
        let d4 = p75.distance(p100);

        let avg = (d1 + d2 + d3 + d4) / 4.0;

        // Assert that physical distance between arc-length mapped points is roughly equal
        assert!((d1 - avg).abs() < 0.1, "D1 mismatch: {} vs {}", d1, avg);
        assert!((d2 - avg).abs() < 0.1, "D2 mismatch: {} vs {}", d2, avg);
        assert!((d3 - avg).abs() < 0.1, "D3 mismatch: {} vs {}", d3, avg);
        assert!((d4 - avg).abs() < 0.1, "D4 mismatch: {} vs {}", d4, avg);

        println!("✅ test_uv_arc_length_uniformity passed.");
    }

    #[test]
    fn test_parametric_fin_synthesis_alignment() {
        let mut model = BoardModel::default();
        model.length = 72.0;
        model.width = 20.0;
        model.thickness = 2.5;
        model.fin_setup = "thruster".to_string();
        model.front_fin_z = 11.0;
        model.front_fin_x = 1.25;
        model.rear_fin_z = 3.5;
        model.rear_fin_x = 0.0;

        // Give it simple rockers and outline so get_board_profile_at_z evaluation works
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, -36.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 0.0, 36.0),
            ],
            tangents1: vec![Vec3::ZERO; 3],
            tangents2: vec![Vec3::ZERO; 3],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.25, -36.0), Vec3::new(0.0, 1.25, 36.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.25, -36.0), Vec3::new(0.0, -1.25, 36.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![Vec3::ZERO; 3],
            tangents2: vec![Vec3::ZERO; 3],
            ..Default::default()
        }];

        let fins = crate::geometry::synthesize_parametric_fins(&model);
        assert!(!fins.is_empty(), "Fins should be synthesized");

        // Verify side fin properties
        let side_fin = fins.iter().find(|f| f.name == "Fin_sides").unwrap();
        assert_eq!(side_fin.even, true);
        assert_eq!(side_fin.central, false);

        // Verify side fin alignment to rocker bottom surface height
        let ctx = crate::geometry::ZRingContext::new(&model, side_fin.z);
        let u = if ctx.profile.half_width > 1e-4 {
            (side_fin.x / ctx.profile.half_width).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let pt = ctx.get_point_at_uv(u, 1.0);
        assert_relative_eq!(side_fin.y, pt.y, epsilon = 1e-4);
    }

    #[test]
    fn test_parametric_fin_setup_symmetry() {
        let mut model = BoardModel::default();
        model.length = 72.0;
        model.width = 20.0;
        model.thickness = 2.5;
        model.front_fin_z = 11.0;
        model.front_fin_x = 1.25;
        model.rear_fin_z = 3.5;
        model.rear_fin_x = 1.5;

        // Simple default curves
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, -36.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 0.0, 36.0),
            ],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.25, -36.0), Vec3::new(0.0, 1.25, 36.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.25, -36.0), Vec3::new(0.0, -1.25, 36.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        // Twin setup -> 2 physical fins (1 pair represented by even: true)
        model.fin_setup = "twin".to_string();
        let fins_twin = crate::geometry::synthesize_parametric_fins(&model);
        assert_eq!(fins_twin.len(), 1);
        let physical_twin_count: usize = fins_twin.iter().map(|f| if f.even { 2 } else { 1 }).sum();
        assert_eq!(physical_twin_count, 2);

        // Thruster setup -> 3 physical fins (1 pair of side fins + 1 central center fin)
        model.fin_setup = "thruster".to_string();
        let fins_thruster = crate::geometry::synthesize_parametric_fins(&model);
        assert_eq!(fins_thruster.len(), 2);
        let physical_thruster_count: usize = fins_thruster
            .iter()
            .map(|f| if f.even { 2 } else { 1 })
            .sum();
        assert_eq!(physical_thruster_count, 3);

        // Quad setup -> 4 physical fins (1 pair of front side fins + 1 pair of rear side fins)
        model.fin_setup = "quad".to_string();
        let fins_quad = crate::geometry::synthesize_parametric_fins(&model);
        assert_eq!(fins_quad.len(), 2);
        let physical_quad_count: usize = fins_quad.iter().map(|f| if f.even { 2 } else { 1 }).sum();
        assert_eq!(physical_quad_count, 4);
    }
}
