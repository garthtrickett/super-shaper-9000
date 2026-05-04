use glam::Vec3;
use crate::model::{BezierCurveData, BoardModel};
use crate::bezier::evaluate_bezier_cubic;

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

    evaluate_bezier_cubic(p0, t0, t1, p1, local_t)
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

pub fn evaluate_composite_outline_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> Vec3 {
    let outline = match &model.outline {
        Some(o) => o,
        None => return Vec3::ZERO,
    };
    let base_pt = evaluate_bezier_at_z(outline, z_inches, hint_t);
    let mut final_x = base_pt.x;

    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if layer.otl_ext.control_points.is_empty() { continue; }
            let min_z = layer.otl_ext.control_points.first().unwrap().z;
            let max_z = layer.otl_ext.control_points.last().unwrap().z;
            let z0 = min_z.min(max_z);
            let z1 = min_z.max(max_z);

            if z_inches >= z0 - 0.01 && z_inches <= z1 + 0.01 {
                let ext_pt = evaluate_bezier_at_z(&layer.otl_ext, z_inches, hint_t);
                final_x = ext_pt.x;
            }
        }
    }
    Vec3::new(final_x, base_pt.y, base_pt.z)
}

/// Finds the curve parameter `t` (0 to 1) that corresponds to a specific `z` coordinate.
/// Used primarily for matching outline width/rocker height to specific lengthwise slices.
pub fn find_v_at_z(curve: &BezierCurveData, target_z: f32, _min_t: f32, max_t: f32) -> f32 {
    let mut best_t = 0.0;
    let mut min_err = f32::INFINITY;
    let steps = 50;
    
    // Initial coarse search
    for i in 0..=steps {
        let t = i as f32 / steps as f32 * max_t;
        let p = evaluate_curve(curve, t);
        let err = (p.z - target_z).abs();
        if err < min_err {
            min_err = err;
            best_t = t;
        }
    }

    // Fine binary search around the best coarse result
    let mut t_search = best_t;
    let mut step_size = max_t / steps as f32;
    
    for _ in 0..15 {
        step_size /= 2.0;
        let t_left = 0.0_f32.max(t_search - step_size);
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

pub fn get_cross_section_blend_at_z<'a>(cross_sections: &'a [BezierCurveData], z_inches: f32) -> Option<BlendResult<'a>> {
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

pub struct BoardProfile {
    pub top_y: f32,
    pub bot_y: f32,
    pub apex_x: f32,
    pub apex_y: f32,
    pub tuck_x: f32,
    pub tuck_y: f32,
    pub half_width: f32,
}

pub fn get_board_profile_at_z(model: &BoardModel, z_inches: f32, hint_t: f32) -> BoardProfile {
    let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, hint_t);
    let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, hint_t);
    let outline_pt = evaluate_composite_outline_at_z(model, z_inches, hint_t);
    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

    let mut top_y = top_pt.y;
    if top_y < bot_pt.y { top_y = bot_pt.y; }

    let mut apex_x = outline_pt.x.max(0.0);
    let mut apex_y = bot_pt.y + (top_y - bot_pt.y) * 0.3;

    if let Some(ao) = &model.apex_outline {
        if !ao.control_points.is_empty() {
            apex_x = evaluate_bezier_at_z(ao, z_inches, hint_t).x.max(0.0);
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
    apex_y = apex_y.clamp(bot_pt.y, top_y);

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
    tuck_y = tuck_y.min(top_y);

    let mut tuck_x = outline_pt.x.max(0.0);
    if let Some(ro) = &model.rail_outline {
        if !ro.control_points.is_empty() {
            tuck_x = evaluate_bezier_at_z(ro, z_inches, hint_t).x.max(0.0);
        }
    }
    let final_apex_x = apex_x.max(0.001);
    let final_tuck_x = tuck_x.max(0.0).min(final_apex_x);

    BoardProfile {
        top_y, bot_y: bot_pt.y,
        apex_x: final_apex_x, apex_y,
        tuck_x: final_tuck_x, tuck_y,
        half_width: outline_pt.x.max(0.0)
    }
}

pub fn get_point_at_uv(model: &BoardModel, u: f32, v: f32, z_inches: f32, inner_x: f32) -> Vec3 {
    let profile = get_board_profile_at_z(model, z_inches, v);
    let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

    if blend.is_none() {
        let py = profile.bot_y + (profile.top_y - profile.bot_y) * u;
        return Vec3::new(profile.half_width, py, z_inches);
    }
    let b = blend.unwrap();

    let p_bot = b.evaluate(0.0);
    let p_top = b.evaluate(1.0);
    let p_apex = b.evaluate(b.t_apex);
    let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
    let p_tuck = b.evaluate(t_tuck);

    let slice_bot_y = p_bot.y;
    let slice_top_y = p_top.y;
    let slice_apex_x = p_apex.x.max(0.001);
    let slice_apex_y = p_apex.y;
    let slice_tuck_x = p_tuck.x.max(0.001);
    let slice_tuck_y = p_tuck.y;

    let p = b.evaluate(u);
    let mut px;
    let mut py;

    if u <= t_tuck {
        let norm_x = if slice_tuck_x > 1e-5 { p.x / slice_tuck_x } else { 0.0 };
        px = norm_x * profile.tuck_x;
    } else if u <= b.t_apex {
        let range_x = slice_apex_x - slice_tuck_x;
        let norm_x = if range_x > 1e-5 { (p.x - slice_tuck_x) / range_x } else { 0.0 };
        px = profile.tuck_x + norm_x * (profile.apex_x - profile.tuck_x);
    } else {
        let norm_x = if slice_apex_x > 1e-5 { p.x / slice_apex_x } else { 0.0 };
        px = norm_x * profile.apex_x;
    }

    if px < inner_x { px = inner_x; }

    if u <= t_tuck {
        let range_y = slice_tuck_y - slice_bot_y;
        let norm_y = if range_y.abs() > 1e-5 { (p.y - slice_bot_y) / range_y } else { 0.0 };
        py = profile.bot_y + norm_y * (profile.tuck_y - profile.bot_y);
    } else if u <= b.t_apex {
        let range_y = slice_apex_y - slice_tuck_y;
        let norm_y = if range_y.abs() > 1e-5 { (p.y - slice_tuck_y) / range_y } else { 0.0 };
        py = profile.tuck_y + norm_y * (profile.apex_y - profile.tuck_y);
    } else {
        let range_y = slice_top_y - slice_apex_y;
        let norm_y = if range_y.abs() > 1e-5 { (p.y - slice_apex_y) / range_y } else { 0.0 };
        py = profile.apex_y + norm_y * (profile.top_y - profile.apex_y);
    }

    if u <= b.t_apex {
        py = py.clamp(profile.bot_y - 2.0, profile.top_y);
    } else {
        py = py.clamp(profile.bot_y, profile.top_y);
    }

    Vec3::new(px, py, z_inches)
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
    fn test_cross_section_blend_hermite() {
        let cs1 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 10.0), Vec3::new(5.0, 0.0, 10.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 0.0, 20.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
        };
        let cs3 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 30.0), Vec3::new(5.0, 0.0, 30.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
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
        };
        let cs2 = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 20.0), Vec3::new(10.0, 0.0, 20.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
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
}
