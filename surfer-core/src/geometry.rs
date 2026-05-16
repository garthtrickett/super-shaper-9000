pub mod curves;
pub use curves::*;
pub mod profile;
pub use profile::*;
pub mod surface;
pub use surface::*;
use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;
// use crate::bezier::evaluate_bezier_cubic;

#[inline]


#[inline]











    curve: &BezierCurveData,
    target_z: f32,
    hint_t: f32,
) -> (Vec3, Vec3) {
    let t = evaluate_bezier_t_at_z_robust(curve, target_z, hint_t);
    crate::bezier::evaluate_composite_pos_and_tangent(curve, t)
}


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



/// Finds the curve parameter `t` (0 to 1) that corresponds to a specific `z` coordinate.
/// Used primarily for matching outline width/rocker height to specific lengthwise slices.


/// Evaluates the inner X-coordinate of a swallow tail "V" notch at a given Z.
/// It searches the parameter space exclusively from `tip_t` (the absolute tail tip) to 1.0 (the stringer notch).




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



impl<'a> BlendResult<'a> {
    

    

    
}


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


/// Evaluates the analytical surface normals at the absolute Z-poles (nose or tail) of the board.
/// Returns (top_normal, bottom_normal).

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

    let cross = t_u.cross(t_v);
    let mut n = if cross.length_squared() > 1e-6 {
        cross.normalize()
    } else {
        Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0)
    };
    if side < 0.0 {
        n = -n;
    }

    let pt = get_point_at_uv_base(model, u, v_outer, z_inches, inner_x, side);
    if pt.x.abs() < 1e-4 && inner_x < 1e-4 {
        n.x = 0.0;
        let len_sq = n.length_squared();
        if len_sq > 1e-6 {
            n /= len_sq.sqrt();
        } else {
            n = Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0);
        }
    }

    n
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
    

    #[test]
    

    #[test]
    

    

    #[test]
    

    

    

    

    

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
    

    

    #[test]
    fn deleted_test_rail_does_not_collapse_at_pin_tail() {}

    #[test]
    

    

    

    

    #[test]
    

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

    

    

    

    

    

    
}

pub fn get_curve<'a>(model: &'a BoardModel, curve_name: &str) -> Option<&'a BezierCurveData> {
    match curve_name {
        "outline" => model.outline.as_ref(),
        "rockerTop" => model.rocker_top.as_ref(),
        "rockerBottom" => model.rocker_bottom.as_ref(),
        "apexOutline" => model.apex_outline.as_ref(),
        "railOutline" => model.rail_outline.as_ref(),
        "apexRocker" => model.apex_rocker.as_ref(),
        "deckShoulder" => model.deck_shoulder.as_ref(),
        name if name.starts_with("crossSection_") => {
            let idx: usize = name.strip_prefix("crossSection_")?.parse().ok()?;
            model.cross_sections.get(idx)
        }
        name if name.starts_with("outlineLayer_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 3 {
                let idx: usize = parts[1].parse().ok()?;
                let layer = model.outline_layers.as_ref()?.get(idx)?;
                return if parts[2] == "ext" {
                    Some(&layer.otl_ext)
                } else if parts[2] == "int" {
                    Some(&layer.otl_int)
                } else {
                    None
                };
            }
            None
        }
        name if name.starts_with("channel_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 4 {
                let idx: usize = parts[1].parse().ok()?;
                let side = parts[2];
                let curve_type = parts[3];
                let channel = model.bottom_channels.as_ref()?.get(idx)?;
                return match (side, curve_type) {
                    ("left", "outline") => Some(&channel.left_outline),
                    ("right", "outline") => Some(&channel.right_outline),
                    ("left", "depth") => Some(&channel.left_depth),
                    ("right", "depth") => Some(&channel.right_depth),
                    _ => None,
                };
            }
            None
        }
        _ => None,
    }
}

pub fn find_closest_t_to_ray(curve: &BezierCurveData, ro: Vec3, rd: Vec3) -> f32 {
    let mut best_t = 0.0;
    let mut min_dist_sq = f32::INFINITY;
    let steps = 100;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let pt = evaluate_curve(curve, t);
        let w = pt - ro;
        let cross = w.cross(rd);
        let dist_sq = cross.length_squared();
        if dist_sq < min_dist_sq {
            min_dist_sq = dist_sq;
            best_t = t;
        }
    }

    let mut t_search = best_t;
    let mut step = 1.0 / steps as f32;
    for _ in 0..10 {
        step /= 2.0;
        let t_l = 0.0_f32.max(t_search - step);
        let t_r = 1.0_f32.min(t_search + step);
        let pt_l = evaluate_curve(curve, t_l);
        let pt_r = evaluate_curve(curve, t_r);
        let dist_l = (pt_l - ro).cross(rd).length_squared();
        let dist_r = (pt_r - ro).cross(rd).length_squared();

        if dist_l < min_dist_sq && dist_l <= dist_r {
            min_dist_sq = dist_l;
            t_search = t_l;
        } else if dist_r < min_dist_sq {
            min_dist_sq = dist_r;
            t_search = t_r;
        }
    }
    t_search
}
