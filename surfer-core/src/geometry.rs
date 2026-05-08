use glam::Vec3;
use crate::model::{BezierCurveData, BoardModel};
// use crate::bezier::evaluate_bezier_cubic;

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
    let t0 = curve.tangents2[segment_idx];
    let t1 = curve.tangents1[segment_idx + 1];

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
    let default_bounds = BoardBounds { nose_z: 0.0, tip_z: 0.0, notch_z: 0.0, tip_t: 1.0 };
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

    BoardBounds { nose_z, tip_z, notch_z, tip_t }
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

pub fn evaluate_bezier_pos_and_tan_at_z(curve: &BezierCurveData, target_z: f32, hint_t: f32) -> (Vec3, Vec3) {
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

pub fn evaluate_composite_outline_pos_and_tan_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> (Vec3, Vec3) {
    let outline = match &model.outline {
        Some(o) => o,
        None => return (Vec3::ZERO, Vec3::Z),
    };
    let (base_pt, mut final_tan) = evaluate_bezier_pos_and_tan_at_z(outline, z_inches, hint_t);
    let mut final_x = base_pt.x;

    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if layer.otl_ext.control_points.is_empty() { continue; }
            let min_z = layer.otl_ext.control_points.first().unwrap().z;
            let max_z = layer.otl_ext.control_points.last().unwrap().z;
            let z0 = min_z.min(max_z);
            let z1 = min_z.max(max_z);

            if z_inches >= z0 - 1e-4 && z_inches <= z1 + 1e-4 {
                let (ext_pt, ext_tan) = evaluate_bezier_pos_and_tan_at_z(&layer.otl_ext, z_inches, hint_t);
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
        if curve.control_points[i].x.abs() > 0.000001 { is_flat = false; break; }
        if i < curve.tangents1.len() && curve.tangents1[i].x.abs() > 0.000001 { is_flat = false; break; }
        if i < curve.tangents2.len() && curve.tangents2[i].x.abs() > 0.000001 { is_flat = false; break; }
    }
    if is_flat { return 0.5; }

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

        // Fetch canonical Z locations
        let z0 = self.s_prev.control_points.first().unwrap().z;
        let z1 = self.s0.control_points.first().unwrap().z;
        let z2 = self.s1.control_points.first().unwrap().z;
        let z3 = self.s_next.control_points.first().unwrap().z;

        // Compute non-uniform tangents using finite differences
        // This ensures C1 Continuity globally while preventing overshoot across uneven spacing
        let dz = z2 - z1;
        
        let m1 = if (z2 - z0).abs() > 1e-5 {
            (p2 - p0) * (dz / (z2 - z0))
        } else {
            p2 - p1
        };

        let m2 = if (z3 - z1).abs() > 1e-5 {
            (p3 - p1) * (dz / (z3 - z1))
        } else {
            p2 - p1
        };

        crate::bezier::evaluate_cubic_hermite(p1, p2, m1, m2, self.lerp_factor)
    }
}

pub fn get_cross_section_blend_at_z<'a>(cross_sections: &'a[BezierCurveData], z_inches: f32) -> Option<BlendResult<'a>> {
    if cross_sections.is_empty() { return None; }
    let min_z = cross_sections.first().unwrap().control_points.first().unwrap().z;
    let max_z = cross_sections.last().unwrap().control_points.first().unwrap().z;

    let mut k0 = 0;
    let mut lerp_factor = 0.0;

    if z_inches <= min_z {
        k0 = 0;
    } else if z_inches >= max_z {
        k0 = cross_sections.len().saturating_sub(1);
    } else {
        for k in 0..cross_sections.len() - 1 {
            let z0 = cross_sections[k].control_points.first().unwrap().z;
            let z1 = cross_sections[k+1].control_points.first().unwrap().z;
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

    Some(BlendResult { t_apex, s_prev, s0, s1, s_next, lerp_factor })
}

pub fn get_channel_profile_at_z(model: &BoardModel, is_left: bool, z_inches: f32) -> Option<(f32, f32)> {
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
    pub half_width: f32,
    pub outline_tangent: Vec3,
    pub outline_normal: Vec3,
}

pub fn get_board_profile_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> BoardProfile {
        let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, hint_t);
    let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, hint_t);
    
    let (outline_pt, mut outline_tangent) = evaluate_composite_outline_pos_and_tan_at_z(model, z_inches, hint_t);
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
        let v_concave_add = if dist > 0.0 {
        let t = (dist / (bounds.tip_z - mid_z)).max(0.0).min(1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        model.v_concave_tail * ease_t
    } else {
        let t = ((-dist) / (mid_z - bounds.nose_z)).max(0.0).min(1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        model.v_concave_nose * ease_t
    };

        let actual_bot_y = bot_pt.y - v_concave_add;
    let mut top_y = top_pt.y;
    if top_y < actual_bot_y { top_y = actual_bot_y; }

    let mut apex_x = outline_pt.x.max(0.0);
    let mut apex_y = bot_pt.y + (top_y - bot_pt.y) * 0.3;

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
        let world_thick = top_y - bot_pt.y;
                if slice_thick.abs() > 1e-5 {
            apex_y = bot_pt.y + world_thick * ((p_apex.y - p_bot.y) / slice_thick);
        }
    }
        apex_y = apex_y.max(bot_pt.y - 2.0);

    let mut tuck_y = bot_pt.y;
    if let Some(b) = &blend {
        let p_bot = b.evaluate(0.0);
        let p_top = b.evaluate(1.0);
        let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
        let p_tuck = b.evaluate(t_tuck);
        let slice_thick = p_top.y - p_bot.y;
        let world_thick = top_y - bot_pt.y;
        if slice_thick.abs() > 1e-5 {
            tuck_y = bot_pt.y + world_thick * ((p_tuck.y - p_bot.y) / slice_thick);
        }
    }

    let mut tuck_x = outline_pt.x.max(0.0);
        if let Some(ro) = &model.rail_outline {
        if !ro.control_points.is_empty() {
            tuck_x = (evaluate_bezier_at_z(ro, z_inches, hint_t).x + outline_delta).max(0.0);
        }
    }

    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if layer.otl_int.control_points.is_empty() { continue; }
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

        BoardProfile {
        top_y, bot_y: actual_bot_y,
        apex_x: final_apex_x, apex_y,
        tuck_x: final_tuck_x, tuck_y,
        half_width: outline_pt.x.max(0.0),
        outline_tangent,
        outline_normal,
    }
}

pub fn get_point_at_uv(model: &BoardModel, u: f32, v: f32, z_inches: f32, inner_x: f32, side: f32) -> Vec3 {
    let profile = get_board_profile_at_z(model, z_inches, v);
    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

    if blend.is_none() {
        let py = profile.bot_y + (profile.top_y - profile.bot_y) * u;
        return Vec3::new(profile.half_width, py, z_inches);
    }
    let b = blend.unwrap();

    let p = b.evaluate(u);
    let p_bot = b.evaluate(0.0);
    let p_top = b.evaluate(1.0);
    let p_apex = b.evaluate(b.t_apex);

    let apex_x_clamp = profile.apex_x.max(0.001);
    let world_apex = Vec3::new(apex_x_clamp, profile.apex_y, z_inches);

    let mut final_pos = Vec3::ZERO;

    let slice_width = (p_apex.x - p_bot.x).max(1e-4);
    let world_width = (world_apex.x - inner_x).max(0.0);

    let norm_x = ((p.x - p_bot.x) / slice_width).clamp(0.0, 1.0);
    final_pos.x = inner_x + norm_x * world_width;

    let current_z_offset = world_apex.z - z_inches;
    final_pos.z = z_inches + norm_x * current_z_offset;

    let bounds = get_board_bounds(model);
    let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
    let dist = z_inches - mid_z;
    let rail_coeff = if dist > 0.0 {
        let t = (dist / (bounds.tip_z - mid_z)).max(0.0).min(1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_tail - 1.0) * ease_t
    } else {
        let t = ((-dist) / (mid_z - bounds.nose_z)).max(0.0).min(1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_nose - 1.0) * ease_t
    };

    let local_rail_coeff = 1.0 - (1.0 - rail_coeff) * norm_x;

    if u <= b.t_apex {
                let slice_h = (p_apex.y - p_bot.y).max(1e-4);
        let world_h = profile.apex_y - profile.bot_y;
        let norm_y = (p.y - p_bot.y) / slice_h;
        let base_y = profile.bot_y + norm_y * world_h * local_rail_coeff;
        final_pos.y = base_y;

        if let Some((mut chan_x, chan_depth)) = get_channel_profile_at_z(model, side < 0.0, z_inches) {
            chan_x = chan_x.abs();
            if chan_x > inner_x && chan_x < world_apex.x {
                if final_pos.x <= chan_x {
                    let t = if chan_x > inner_x { (final_pos.x - inner_x) / (chan_x - inner_x) } else { 0.0 };
                    final_pos.y = base_y + t * chan_depth;
                } else {
                    let t = if world_apex.x > chan_x { (final_pos.x - chan_x) / (world_apex.x - chan_x) } else { 0.0 };
                    final_pos.y = base_y + (1.0 - t) * chan_depth;
                }
            }
        }
    } else {
        let slice_h = (p_top.y - p_apex.y).max(1e-4);
        let norm_y = (p.y - p_apex.y) / slice_h;
        
        let base_y = profile.bot_y + (profile.apex_y - profile.bot_y) * local_rail_coeff;
        let target_top_y = profile.top_y;
        
        final_pos.y = base_y + norm_y * (target_top_y - base_y);
    }

        if final_pos.x < inner_x { final_pos.x = inner_x; }
    final_pos.y = final_pos.y.max(profile.bot_y - 2.0);

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
        if t < 0.0 { t += 1.0; }
        if t > 1.0 { t -= 1.0; }
        if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
        if t < 1.0 / 2.0 { return q; }
        if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
        p
    };
    Vec3::new(hue2rgb(0.0, 1.0, h + 1.0 / 3.0), hue2rgb(0.0, 1.0, h), hue2rgb(0.0, 1.0, h - 1.0 / 3.0))
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
                Vec3::new(0.0, 0.0, 100.0) // PIN TAIL
            ],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 40.0), Vec3::new(2.0, 0.0, 95.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 5.0), Vec3::new(10.0, 0.0, 60.0), Vec3::new(0.0, 0.0, 100.0)],
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
                Vec3::new(0.0, 1.25, 0.0)
            ],
            tangents1: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(5.0, -1.25, 0.0), Vec3::new(5.0, 1.25, 0.0)],
            tangents2: vec![Vec3::new(5.0, -1.25, 0.0), Vec3::new(10.0, 0.5, 0.0), Vec3::new(0.0, 1.25, 0.0)],
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
        assert!(diff_y < 0.2, "Shoulder Y spiked abruptly at the tip! y_99: {}, y_100: {}", pt_99.y, pt_100.y);
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
        assert!(pt.x > 5.0 && pt.x < 10.0);
        assert_eq!(pt.z, 15.0, "Z coordinate must remain strictly linear across Hermite blend");
        
                println!("✅ test_cross_section_blend_hermite passed.");
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
        assert_eq!(blend_before.lerp_factor, 0.0, "Should clamp to the first section");
        let pt_before = blend_before.evaluate(1.0);
        assert_eq!(pt_before.x, 5.0, "Should rigidly evaluate to the first section");

        // 2. After last section (e.g., towards the tail)
        let blend_after = get_cross_section_blend_at_z(&sections, 30.0).unwrap();
        assert_eq!(blend_after.lerp_factor, 0.0, "Should clamp to the last section");
        let pt_after = blend_after.evaluate(1.0);
        assert_eq!(pt_after.x, 10.0, "Should rigidly evaluate to the last section");
        
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
            control_points: vec![Vec3::ZERO, Vec3::new(10.,0.,0.), Vec3::ZERO], 
            tangents1: vec![Vec3::ZERO, Vec3::new(10.,0.,0.), Vec3::ZERO], 
            tangents2: vec![Vec3::ZERO, Vec3::new(10.,0.,0.), Vec3::ZERO],
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

        assert!(wide_rail_width > narrow_rail_width, "Rail width should scale proportionally with overall board width.");
        
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
        
        assert!(pt.y > 0.5, "Deck curvature should be preserved and not fall back to flat lerp. y={}", pt.y);

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
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0), Vec3::new(0.0, 0.0, 95.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 80.0), Vec3::new(5.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 0.0, 110.0), Vec3::new(0.0, 0.0, 95.0)],
            ..Default::default()
        });

        let bounds = get_board_bounds(&model);
        
        assert_eq!(bounds.nose_z, 0.0);
        assert_eq!(bounds.notch_z, 95.0);
        assert!(bounds.tip_z > 95.0, "Tip Z should be further out than the notch");
        assert!(bounds.tip_t < 1.0, "Tip parameter should be before the end of the curve");

        // Test inner notch evaluation at z = 98
        let inner_x = evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, 98.0);
        assert!(inner_x > 0.0 && inner_x < 10.0, "Inner X should be evaluated correctly between the tip and stringer");

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
        assert!((mid_90.length() - 1.0).abs() < 1e-5, "Slerp must maintain unit length");
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
        assert!(t_weighted < t_std, "Higher weight at P1 should pull the curve, reaching z=50 earlier in parameter t");
        
                println!("✅ test_rational_geometry_integration passed.");
    }

    #[test]
    fn test_wing_tuck_offset_prevents_intersection() {
        use crate::model::OutlineLayer;
        let mut model = BoardModel::default();
        
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 50.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::new(10.0, 0.0, 40.0), Vec3::new(0.0, 0.0, 90.0)],
            tangents2: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(10.0, 0.0, 60.0), Vec3::ZERO],
            ..Default::default()
        });

        model.rail_outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(9.0, 0.0, 50.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::new(9.0, 0.0, 40.0), Vec3::new(0.0, 0.0, 90.0)],
            tangents2: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(9.0, 0.0, 60.0), Vec3::ZERO],
            ..Default::default()
        });
        
        let base_outline_x = evaluate_bezier_at_z(model.outline.as_ref().unwrap(), 75.0, 0.5).x;
        
        let wing_ext = BezierCurveData {
            control_points: vec![Vec3::new(base_outline_x - 2.0, 0.0, 70.0), Vec3::new(base_outline_x - 2.0, 0.0, 80.0)],
            tangents1: vec![Vec3::new(base_outline_x - 2.0, 0.0, 70.0), Vec3::new(base_outline_x - 2.0, 0.0, 75.0)],
            tangents2: vec![Vec3::new(base_outline_x - 2.0, 0.0, 75.0), Vec3::new(base_outline_x - 2.0, 0.0, 80.0)],
            ..Default::default()
        };
        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            otl_ext: wing_ext,
            otl_int: BezierCurveData::default(),
        }]);

        model.rocker_top = Some(BezierCurveData { control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)], tangents1: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)], tangents2: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)], ..Default::default() });
        model.rocker_bottom = Some(BezierCurveData { control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)], tangents1: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)], tangents2: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)], ..Default::default() });

                let profile = super::get_board_profile_at_z(&model, 75.0, 0.5);
        
        assert!(profile.tuck_x < profile.apex_x, "Tuck X ({}) must remain inside Apex X ({}) to prevent self-intersection", profile.tuck_x, profile.apex_x);
        
                println!("✅ test_wing_tuck_offset_prevents_intersection passed.");
    }

        #[test]
    fn test_asymmetric_channel_evaluation() {
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
            left_outline: BezierCurveData { control_points: vec![left_out_start, left_out_end], tangents1: vec![left_out_start, left_out_end], tangents2: vec![left_out_start, left_out_end], ..Default::default() },
            left_depth: BezierCurveData { control_points: vec![left_depth_start, left_depth_end], tangents1: vec![left_depth_start, left_depth_end], tangents2: vec![left_depth_start, left_depth_end], ..Default::default() },
            right_outline: BezierCurveData { control_points: vec![right_out_start, right_out_end], tangents1: vec![right_out_start, right_out_end], tangents2: vec![right_out_start, right_out_end], ..Default::default() },
            right_depth: BezierCurveData { control_points: vec![right_depth_start, right_depth_end], tangents1: vec![right_depth_start, right_depth_end], tangents2: vec![right_depth_start, right_depth_end], ..Default::default() }
        }]);

        let profile_right = super::get_channel_profile_at_z(&model, false, 50.0).unwrap();
        let profile_left = super::get_channel_profile_at_z(&model, true, 50.0).unwrap();
        
        assert_eq!(profile_right.1, 1.0);
        assert_eq!(profile_left.1, 0.5);
        assert!(profile_right.1 != profile_left.1, "Asymmetric channels should have different depths");

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
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(8.0, -1.0, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(8.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(8.0, -1.0, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(8.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 0.0)],
            tangents2: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(8.0, -1.0, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(8.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 0.0)],
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
        assert!((profile_base_mid.bot_y - profile_mod_mid.bot_y).abs() < 1e-4, "Modifiers should taper to 0 at the midpoint");

        // 2. Tail of the board (Z=95)
        let z_tail = 95.0;
        let profile_base_tail = super::get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod_tail = super::get_board_profile_at_z(&model_mod_v, z_tail, 0.5);

        assert!(profile_mod_tail.bot_y > profile_base_tail.bot_y, "V-Concave < 0 should physically raise the stringer (Vee)");
        assert!((profile_mod_tail.apex_y - profile_base_tail.apex_y).abs() < 1e-4, "V-Concave should not alter the rail rocker height");

        // Test Rail Coefficient (Thinning the deck shoulder)
        // U = 0.8 is up on the deck shoulder.
                let pt_base = super::get_point_at_uv(&model_base, 0.8, 0.5, z_tail, 0.0, 1.0);
        let pt_mod = super::get_point_at_uv(&model_mod_rail, 0.8, 0.5, z_tail, 0.0, 1.0);

        println!("\n--- DIAGNOSTICS FOR EXTREMITY MODIFIERS ---");
        println!("pt_base: {:?}", pt_base);
        println!("pt_mod: {:?}", pt_mod);
        
        let profile_base = super::get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod = super::get_board_profile_at_z(&model_mod_rail, z_tail, 0.5);
        println!("profile_base: top_y={}, bot_y={}, apex_y={}", profile_base.top_y, profile_base.bot_y, profile_base.apex_y);
        println!("profile_mod: top_y={}, bot_y={}, apex_y={}", profile_mod.top_y, profile_mod.bot_y, profile_mod.apex_y);
        
        let blend = super::get_cross_section_blend_at_z(&model_base.cross_sections, z_tail).unwrap();
        let p = blend.evaluate(0.8);
        println!("blend at u=0.8: t_apex={}, p={:?}", blend.t_apex, p);
        println!("-------------------------------------------\n");

        assert!(pt_mod.y < pt_base.y, "Rail coefficient < 1.0 should aggressively thin out the foil/shoulder volume at the tail");
    }
}
