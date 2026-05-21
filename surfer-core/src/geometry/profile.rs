use super::curves::*;
use crate::model::BoardModel;
use glam::Vec3;

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
            let apex_dev = p_apex.y - p_bot.y;
            apex_y = rail_base_y
                + if apex_dev > 0.0 {
                    world_thick * (apex_dev / slice_thick)
                } else {
                    apex_dev
                };
        }
    }
    apex_y = apex_y.max(rail_base_y - 2.0);

    let mut tuck_y = rail_base_y;
    let mut shoulder_y = rail_base_y + (top_y - rail_base_y) * 0.8;

        if let Some(b) = &blend {
        let p_bot = b.evaluate(0.0);
        let p_top = b.evaluate(1.0);
        let t_tuck = b.t_tuck;
        let p_tuck = b.evaluate(t_tuck);
        let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;
        let p_shoulder = b.evaluate(t_shoulder);
        let slice_thick = p_top.y - p_bot.y;
        let world_thick = top_y - actual_bot_y;
        if slice_thick.abs() > 1e-5 {
            let tuck_dev = p_tuck.y - p_bot.y;
            tuck_y = rail_base_y
                + if tuck_dev > 0.0 {
                    world_thick * (tuck_dev / slice_thick)
                } else {
                    tuck_dev
                };
            let shoulder_dev = p_shoulder.y - p_bot.y;
            shoulder_y = rail_base_y
                + if shoulder_dev > 0.0 {
                    world_thick * (shoulder_dev / slice_thick)
                } else {
                    shoulder_dev
                };
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
            let t_tuck = b.t_tuck;
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

    let rail_coeff = if dist > 0.0 {
        let t = (dist / (bounds.tip_z - mid_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_tail - 1.0) * ease_t
    } else {
        let t = ((-dist) / (mid_z - bounds.nose_z)).clamp(0.0, 1.0);
        let ease_t = t * t * (3.0 - 2.0 * t);
        1.0 + (model.rail_coefficient_nose - 1.0) * ease_t
    };

    let inner_x = if z_inches > bounds.notch_z {
        evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, z_inches)
    } else {
        0.0
    };

    let get_local_rail_coeff = |x: f32| -> f32 {
        let norm_x = if final_apex_x > inner_x {
            ((x - inner_x) / (final_apex_x - inner_x)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        1.0 - (1.0 - rail_coeff) * norm_x
    };

    let apply_rail_coeff = |raw_y: f32, x: f32| -> f32 {
        let coeff = get_local_rail_coeff(x);
        if raw_y < actual_bot_y {
            actual_bot_y + (raw_y - actual_bot_y) // Preserve absolute concave depth
        } else {
            actual_bot_y + (raw_y - actual_bot_y) * coeff
        }
    };

    let apex_y_final = apply_rail_coeff(apex_y, final_apex_x);
    let tuck_y_final = apply_rail_coeff(tuck_y, final_tuck_x);
    let shoulder_y_final = apply_rail_coeff(shoulder_y, final_shoulder_x);

    BoardProfile {
        top_y,
        bot_y: actual_bot_y,
        apex_x: final_apex_x,
        apex_y: apex_y_final,
        tuck_x: final_tuck_x,
        tuck_y: tuck_y_final,
        shoulder_x: final_shoulder_x,
        shoulder_y: shoulder_y_final,
        half_width: outline_pt.x.max(0.0),
        outline_tangent,
        outline_normal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

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

        let p_narrow = get_board_profile_at_z(&model_narrow, z, hint_t);
        let p_wide = get_board_profile_at_z(&model_wide, z, hint_t);

        let narrow_rail_width = p_narrow.apex_x - p_narrow.tuck_x;
        let wide_rail_width = p_wide.apex_x - p_wide.tuck_x;

        assert!(
            wide_rail_width > narrow_rail_width,
            "Rail width should scale proportionally with overall board width."
        );
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

        let profile = get_board_profile_at_z(&model, 50.0, 0.5);

        assert!(
            profile.shoulder_y > 0.5,
            "Deck curvature should be preserved and not fall back to flat lerp. y={}",
            profile.shoulder_y
        );
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

        let profile_right = get_channel_profile_at_z(&model, false, 50.0).unwrap();
        let profile_left = get_channel_profile_at_z(&model, true, 50.0).unwrap();

        assert_eq!(profile_right.1, 1.0);
        assert_eq!(profile_left.1, 0.5);
        assert!(
            profile_right.1 != profile_left.1,
            "Asymmetric channels should have different depths"
        );

        let profile_outside_z = get_channel_profile_at_z(&model, false, 10.0);
        assert!(profile_outside_z.is_none());
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
        let profile_base_mid = get_board_profile_at_z(&model_base, z_center, 0.5);
        let profile_mod_mid = get_board_profile_at_z(&model_mod_v, z_center, 0.5);
        assert!(
            (profile_base_mid.bot_y - profile_mod_mid.bot_y).abs() < 1e-4,
            "Modifiers should taper to 0 at the midpoint"
        );

        // 2. Tail of the board (Z=95)
        let z_tail = 95.0;
        let profile_base_tail = get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod_tail = get_board_profile_at_z(&model_mod_v, z_tail, 0.5);

        assert!(
            (profile_mod_tail.bot_y - profile_base_tail.bot_y).abs() < 1e-4,
            "V-Concave should not alter the stringer rocker height"
        );
        assert!(
            profile_mod_tail.tuck_y < profile_base_tail.tuck_y,
            "V-Concave < 0 (Concave) should physically lower the rails relative to the stringer"
        );

        // Test Rail Coefficient (Thinning the deck shoulder)
        let profile_base = get_board_profile_at_z(&model_base, z_tail, 0.5);
        let profile_mod = get_board_profile_at_z(&model_mod_rail, z_tail, 0.5);

        assert!(
            profile_mod.shoulder_y < profile_base.shoulder_y,
            "Rail coefficient < 1.0 should aggressively thin out the foil/shoulder volume at the tail"
        );
    }
}
