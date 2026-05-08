use glam::Vec3;
use crate::model::*;
use crate::geometry::{evaluate_bezier_at_z, get_board_bounds};

fn get_curve_mut<'a>(model: &'a mut BoardModel, curve_name: &str) -> Option<&'a mut BezierCurveData> {
    match curve_name {
        "outline" => model.outline.as_mut(),
        "rockerTop" => model.rocker_top.as_mut(),
        "rockerBottom" => model.rocker_bottom.as_mut(),
        "apexOutline" => model.apex_outline.as_mut(),
        "railOutline" => model.rail_outline.as_mut(),
        "apexRocker" => model.apex_rocker.as_mut(),
                name if name.starts_with("crossSection_") => {
            let idx_str = name.strip_prefix("crossSection_")?;
            let idx: usize = idx_str.parse().ok()?;
            model.cross_sections.get_mut(idx)
        },
        name if name.starts_with("outlineLayer_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 3 {
                let idx: usize = parts[1].parse().ok()?;
                if let Some(layers) = &mut model.outline_layers {
                    if let Some(layer) = layers.get_mut(idx) {
                        return if parts[2] == "ext" {
                            Some(&mut layer.otl_ext)
                        } else if parts[2] == "int" {
                            Some(&mut layer.otl_int)
                        } else {
                            None
                        };
                    }
                }
            }
                        None
        },
        name if name.starts_with("channel_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 3 {
                let idx: usize = parts[1].parse().ok()?;
                if let Some(channels) = &mut model.bottom_channels {
                    if let Some(channel) = channels.get_mut(idx) {
                        return if parts[2] == "outline" {
                            Some(&mut channel.outline)
                        } else if parts[2] == "depth" {
                            Some(&mut channel.depth)
                        } else {
                            None
                        };
                    }
                }
            }
            None
        },
        _ => None
    }
}

pub fn push_history(model: &mut BoardModel) {
        let snapshot = ManualSnapshot {
        outline: model.outline.clone(),
        outline_layers: model.outline_layers.clone(),
        bottom_channels: model.bottom_channels.clone(),
        rail_outline: model.rail_outline.clone(),
        apex_outline: model.apex_outline.clone(),
        rocker_top: model.rocker_top.clone(),
        rocker_bottom: model.rocker_bottom.clone(),
        apex_rocker: model.apex_rocker.clone(),
        cross_sections: model.cross_sections.clone(),
    };

    let mut history = model.history.take().unwrap_or_default();
    let idx = model.history_index.unwrap_or(0);

    if history.len() > idx + 1 {
        history.truncate(idx + 1);
    }

    history.push(snapshot);
    if history.len() > 50 {
        history.remove(0);
    }

    model.history_index = Some(history.len().saturating_sub(1));
    model.history = Some(history);
}

fn scale_curve_width(curve: &mut Option<BezierCurveData>, factor: f32) {
    if let Some(c) = curve.as_mut() {
        for p in &mut c.control_points { p.x *= factor; }
        for p in &mut c.tangents1 { p.x *= factor; }
        for p in &mut c.tangents2 { p.x *= factor; }
    }
}

fn scale_curve_thickness(curve: &mut Option<BezierCurveData>, factor: f32) {
    if let Some(c) = curve.as_mut() {
        for p in &mut c.control_points { p.y *= factor; }
        for p in &mut c.tangents1 { p.y *= factor; }
        for p in &mut c.tangents2 { p.y *= factor; }
    }
}

fn apply_tail_type(model: &mut BoardModel) {
    let is_swallow = model.tail_type == "swallow";
    let depth = model.swallow_depth;
    let width = model.width;

    let outline = match model.outline.as_mut() {
        Some(o) => o,
        None => return,
    };
    let len = outline.control_points.len();
    if len < 2 { return; }

    let last_z = outline.control_points[len - 1].z;
    let prev_z = outline.control_points[len - 2].z;
    let currently_swallow = last_z < prev_z - 0.1;

    if is_swallow && !currently_swallow {
        let tip_z = outline.control_points[len - 1].z;
        
        // Old tail point becomes the prong
        outline.control_points[len - 1].x = (width / 4.0).max(1.0);
        
        // Add the notch
        let notch_z = tip_z - depth;
        let notch_pos = Vec3::new(0.0, 0.0, notch_z);
        
        outline.control_points.push(notch_pos);
        let incoming = notch_pos - Vec3::new(1.0, 0.0, -1.0);
        outline.tangents1.push(incoming);
        outline.tangents2.push(notch_pos);
        if let Some(w) = &mut outline.weights {
            w.push(1.0);
        }
    } else if !is_swallow && currently_swallow {
        outline.control_points.pop();
        outline.tangents1.pop();
        outline.tangents2.pop();
        if let Some(w) = &mut outline.weights {
            w.pop();
        }
        let new_len = outline.control_points.len();
        outline.control_points[new_len - 1].x = 0.0;
    } else if is_swallow && currently_swallow {
        let tip_z = outline.control_points[len - 2].z;
        let new_notch_z = tip_z - depth;
        let delta_z = new_notch_z - outline.control_points[len - 1].z;
        outline.control_points[len - 1].z = new_notch_z;
        outline.tangents1[len - 1].z += delta_z;
        outline.tangents2[len - 1].z += delta_z;
    }
}

pub fn update(model: &mut BoardModel, action: BoardAction) -> Vec<Effect> {
    let mut effects = Vec::new();

    match action {
                BoardAction::UpdateNumber { param, value } => match param.as_str() {
            "length" => model.length = value,
            "width" => model.width = value,
            "swallowDepth" => {
                model.swallow_depth = value;
                apply_tail_type(model);
            }
            "thickness" => model.thickness = value,
            "frontFinZ" => model.front_fin_z = value,
            "frontFinX" => model.front_fin_x = value,
            "rearFinZ" => model.rear_fin_z = value,
            "rearFinX" => model.rear_fin_x = value,
                        "toeAngle" => model.toe_angle = value,
            "cantAngle" => model.cant_angle = value,
            "mriSlicePosition" => model.mri_slice_position = Some(value),
            _ => {}
        },
                BoardAction::UpdateString { param, value } => match param.as_str() {
            "finSetup" => model.fin_setup = value,
            "coreMaterial" => model.core_material = value,
            "glassingSchedule" => model.glassing_schedule = value,
            "tailType" => {
                model.tail_type = value;
                apply_tail_type(model);
                push_history(model);
            }
            _ => {}
        },
        BoardAction::UpdateBoolean { param, value } => match param.as_str() {
            "showGizmos" => model.show_gizmos = Some(value),
            "showHeatmap" => {
                model.show_heatmap = Some(value);
                if value { model.show_zebra = Some(false); }
            }
            "showZebra" => {
                model.show_zebra = Some(value);
                if value { model.show_heatmap = Some(false); }
            }
            "showApexLine" => model.show_apex_line = Some(value),
            "showOutline" => model.show_outline = Some(value),
            "showRockerTop" => model.show_rocker_top = Some(value),
            "showRockerBottom" => model.show_rocker_bottom = Some(value),
            "showApexOutline" => model.show_apex_outline = Some(value),
            "showRailOutline" => model.show_rail_outline = Some(value),
            "showApexRocker" => model.show_apex_rocker = Some(value),
                        "showCrossSections" => model.show_cross_sections = Some(value),
            "showCurvature" => model.show_curvature = Some(value),
            "showMriView" => {
                model.show_mri_view = Some(value);
                if value { model.show_zebra = Some(false); }
            }
            _ => {}
        },
        BoardAction::UpdateVolume { volume } => {
            model.volume = volume;
        }
        BoardAction::LoadDesign { state } => {
            *model = state;
            effects.push(Effect::LogInfo { message: "Rust Engine: LOAD_DESIGN applied.".to_string() });
        }
        BoardAction::SetCurves { outline, rail_outline, apex_outline, rocker_top, rocker_bottom, apex_rocker, cross_sections } => {
            if let Some(c) = outline { model.outline = Some(c); }
            if let Some(c) = rail_outline { model.rail_outline = Some(c); }
            if let Some(c) = apex_outline { model.apex_outline = Some(c); }
            if let Some(c) = rocker_top { model.rocker_top = Some(c); }
            if let Some(c) = rocker_bottom { model.rocker_bottom = Some(c); }
            if let Some(c) = apex_rocker { model.apex_rocker = Some(c); }
            if let Some(cs) = cross_sections { model.cross_sections = cs; }
            push_history(model);
        }
                        BoardAction::UpdateNodePosition { curve, index, node_type, position } => {
            let is_cross_section = curve.starts_with("crossSection_");
            let is_outline_type = curve == "outline" || curve == "apexOutline" || curve == "railOutline" || curve.starts_with("outlineLayer_") || (curve.starts_with("channel_") && curve.ends_with("_outline"));

            if let Some(target) = get_curve_mut(model, &curve) {
                let mut pos = Vec3::from_array(position);

                                if node_type == "anchor" {
                    let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
                    let is_layer = curve.starts_with("outlineLayer_");
                    if is_end_node && (is_cross_section || (is_outline_type && !is_layer)) {
                        pos.x = 0.0;
                    }
                    if is_cross_section || is_outline_type {
                        pos.x = pos.x.max(0.0);
                    }
                }

                let old_anchor = target.control_points.get(index).cloned();
                let old_t1 = target.tangents1.get(index).cloned();
                let old_t2 = target.tangents2.get(index).cloned();

                if node_type == "anchor" {
                    if let Some(old_a) = old_anchor {
                        let delta = pos - old_a;
                        target.control_points[index] = pos;
                        if old_t1.is_some() {
                            target.tangents1[index] += delta;
                        }
                        if old_t2.is_some() {
                            target.tangents2[index] += delta;
                        }
                    }
                } else if node_type == "tangent1" {
                    if let (Some(old_a), Some(_)) = (old_anchor, old_t1) {
                        target.tangents1[index] = pos;
                        if let Some(old_t2_val) = old_t2 {
                            let dir1 = pos - old_a;
                            let len1 = dir1.length();
                            if len1 > 0.001 {
                                let norm1 = dir1 / len1;
                                let orig_dist2 = (old_t2_val - old_a).length();
                                target.tangents2[index] = old_a - (norm1 * orig_dist2);
                            }
                        }
                    }
                } else if node_type == "tangent2" {
                    if let (Some(old_a), Some(_)) = (old_anchor, old_t2) {
                        target.tangents2[index] = pos;
                        if let Some(old_t1_val) = old_t1 {
                            let dir2 = pos - old_a;
                            let len2 = dir2.length();
                            if len2 > 0.001 {
                                let norm2 = dir2 / len2;
                                let orig_dist1 = (old_t1_val - old_a).length();
                                target.tangents1[index] = old_a - (norm2 * orig_dist1);
                            }
                        }
                    }
                }
            }
        }
        BoardAction::SelectNode { node } => {
            model.selected_node = node;
        }
                BoardAction::ApplyContinuity { curve, index, level, master } => {
            if let Some(target) = get_curve_mut(model, &curve) {
                if index > 0 && index < target.control_points.len().saturating_sub(1) {
                    let anchor = target.control_points[index];
                    let is_t1_master = master.as_deref().unwrap_or("tangent1") == "tangent1";
                    
                    let (t_src, mut t_tgt, f_src, f_tgt) = if is_t1_master {
                        (
                            target.tangents1[index],
                            target.tangents2[index],
                            target.tangents2[index - 1],
                            target.tangents1[index + 1],
                        )
                    } else {
                        (
                            target.tangents2[index],
                            target.tangents1[index],
                            target.tangents1[index + 1],
                            target.tangents2[index - 1],
                        )
                    };
                    
                    let dir = anchor - t_src;
                    let dist_tgt = (t_tgt - anchor).length();
                    
                    if level == "G1" || level == "G2" {
                        if dir.length_squared() > 1e-6 {
                            t_tgt = anchor + dir.normalize() * dist_tgt;
                        }
                    }
                    
                    if level == "G2" {
                        t_tgt = crate::bezier::solve_g2_tangent(anchor, t_src, f_src, f_tgt);
                    }
                    
                    if is_t1_master {
                        target.tangents2[index] = t_tgt;
                    } else {
                        target.tangents1[index] = t_tgt;
                    }
                }
            }
        }
                                BoardAction::UpdateNodeExact { curve, index, anchor, tangent1, tangent2, weight } => {
            let is_cross_section = curve.starts_with("crossSection_");
            let is_outline_type = curve == "outline" || curve == "apexOutline" || curve == "railOutline" || curve.starts_with("outlineLayer_") || (curve.starts_with("channel_") && curve.ends_with("_outline"));

            if let Some(target) = get_curve_mut(model, &curve) {
                                if let Some(a) = anchor {
                    let mut pos = Vec3::from_array(a);
                    let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
                    let is_layer = curve.starts_with("outlineLayer_");
                    if is_end_node && (is_cross_section || (is_outline_type && !is_layer)) {
                        pos.x = 0.0;
                    }
                    if is_cross_section || is_outline_type {
                        pos.x = pos.x.max(0.0);
                    }
                    target.control_points[index] = pos;
                }
                if let Some(t1) = tangent1 {
                    target.tangents1[index] = Vec3::from_array(t1);
                }
                if let Some(t2) = tangent2 {
                    target.tangents2[index] = Vec3::from_array(t2);
                }
                if let Some(w) = weight {
                    if target.weights.is_none() {
                        target.weights = Some(vec![1.0; target.control_points.len()]);
                    }
                    if let Some(weights) = &mut target.weights {
                        if index < weights.len() {
                            weights[index] = w;
                        } else {
                            weights.resize(target.control_points.len(), 1.0);
                            weights[index] = w;
                        }
                    }
                }
            }
            push_history(model);
        }
        BoardAction::SaveHistorySnapshot => {
            push_history(model);
        }
                BoardAction::Undo => {
            if let (Some(history), Some(mut idx)) = (&model.history, model.history_index) {
                if idx > 0 {
                    idx -= 1;
                    let snap = &history[idx];
                    model.history_index = Some(idx);
                    model.outline = snap.outline.clone();
                    model.outline_layers = snap.outline_layers.clone();
                    model.bottom_channels = snap.bottom_channels.clone();
                    model.rail_outline = snap.rail_outline.clone();
                    model.apex_outline = snap.apex_outline.clone();
                    model.rocker_top = snap.rocker_top.clone();
                    model.rocker_bottom = snap.rocker_bottom.clone();
                    model.apex_rocker = snap.apex_rocker.clone();
                    model.cross_sections = snap.cross_sections.clone();
                }
            }
        }
                BoardAction::Redo => {
            if let (Some(history), Some(mut idx)) = (&model.history, model.history_index) {
                if idx + 1 < history.len() {
                    idx += 1;
                    let snap = &history[idx];
                    model.history_index = Some(idx);
                    model.outline = snap.outline.clone();
                    model.outline_layers = snap.outline_layers.clone();
                    model.bottom_channels = snap.bottom_channels.clone();
                    model.rail_outline = snap.rail_outline.clone();
                    model.apex_outline = snap.apex_outline.clone();
                    model.rocker_top = snap.rocker_top.clone();
                    model.rocker_bottom = snap.rocker_bottom.clone();
                    model.apex_rocker = snap.apex_rocker.clone();
                    model.cross_sections = snap.cross_sections.clone();
                }
            }
        }
        BoardAction::ScaleWidth { factor } => {
            model.width *= factor;
            scale_curve_width(&mut model.outline, factor);
            scale_curve_width(&mut model.rail_outline, factor);
            scale_curve_width(&mut model.apex_outline, factor);
            for cs in &mut model.cross_sections {
                let mut temp = Some(cs.clone());
                scale_curve_width(&mut temp, factor);
                *cs = temp.unwrap();
            }
            push_history(model);
        }
        BoardAction::ScaleThickness { factor } => {
            model.thickness *= factor;
            scale_curve_thickness(&mut model.rocker_top, factor);
            scale_curve_thickness(&mut model.rocker_bottom, factor);
            scale_curve_thickness(&mut model.apex_rocker, factor);
            for cs in &mut model.cross_sections {
                let mut temp = Some(cs.clone());
                scale_curve_thickness(&mut temp, factor);
                *cs = temp.unwrap();
            }
            push_history(model);
        }
                BoardAction::ImportS3dx { length, width, thickness, outline, rail_outline, apex_outline, rocker_top, rocker_bottom, apex_rocker, cross_sections, outline_layers, bottom_channels } => {
            model.length = length;
            model.width = width;
            model.thickness = thickness;
            model.outline = Some(outline);
            model.rail_outline = Some(rail_outline);
            model.apex_outline = Some(apex_outline);
            model.rocker_top = Some(rocker_top);
            model.rocker_bottom = Some(rocker_bottom);
            model.apex_rocker = Some(apex_rocker);
                        model.cross_sections = cross_sections;
            model.outline_layers = outline_layers;
            model.bottom_channels = bottom_channels;
            push_history(model);
        }
        BoardAction::AddOutlineLayer => {
            let mut layers = model.outline_layers.take().unwrap_or_default();

            if let Some(outline) = &model.outline {
                let bounds = get_board_bounds(model);
                let tip_z = bounds.tip_z;

                // Sensible default: A 10" long wing starting 15" from the absolute tail tip,
                // stepping in 1" on the deck and 0.5" on the bottom.
                let wing_start_z = tip_z - 15.0;
                let wing_end_z = tip_z - 5.0;

                let hint_t_start = crate::geometry::find_v_at_z(outline, wing_start_z, 0.0, 1.0);
                let base_x_start = evaluate_bezier_at_z(outline, wing_start_z, hint_t_start).x;

                let hint_t_end = crate::geometry::find_v_at_z(outline, wing_end_z, 0.0, 1.0);
                let base_x_end = evaluate_bezier_at_z(outline, wing_end_z, hint_t_end).x;

                let ext_start_pos = Vec3::new(base_x_start - 1.0, 0.0, wing_start_z);
                let ext_end_pos = Vec3::new(base_x_end - 1.0, 0.0, wing_end_z);
                
                let int_start_pos = Vec3::new(base_x_start - 1.5, 0.0, wing_start_z);
                let int_end_pos = Vec3::new(base_x_end - 1.5, 0.0, wing_end_z);

                let otl_ext = BezierCurveData {
                    control_points: vec![ext_start_pos, ext_end_pos],
                    tangents1: vec![ext_start_pos, ext_end_pos.lerp(ext_start_pos, 0.33)],
                    tangents2: vec![ext_start_pos.lerp(ext_end_pos, 0.33), ext_end_pos],
                    ..Default::default()
                };

                let otl_int = BezierCurveData {
                    control_points: vec![int_start_pos, int_end_pos],
                    tangents1: vec![int_start_pos, int_end_pos.lerp(int_start_pos, 0.33)],
                    tangents2: vec![int_start_pos.lerp(int_end_pos, 0.33), int_end_pos],
                    ..Default::default()
                };

                layers.push(OutlineLayer {
                    name: format!("Wing {}", layers.len() + 1),
                    otl_ext,
                    otl_int,
                });
            }

                        model.outline_layers = Some(layers);
            push_history(model);
        }
        BoardAction::RemoveOutlineLayer { index } => {
            if let Some(mut layers) = model.outline_layers.take() {
                if index < layers.len() {
                    layers.remove(index);
                }
                model.outline_layers = Some(layers);
            }
            push_history(model);
        }
        BoardAction::AddBottomChannel => {
            let mut channels = model.bottom_channels.take().unwrap_or_default();

            let bounds = get_board_bounds(model);
            let tip_z = bounds.tip_z;

            let channel_start_z = tip_z - 25.0;
            let channel_end_z = tip_z - 5.0;
            
            let out_start = Vec3::new(2.0, 0.0, channel_start_z);
            let out_end = Vec3::new(2.0, 0.0, channel_end_z);
            
            let depth_start = Vec3::new(0.0, 0.5, channel_start_z);
            let depth_end = Vec3::new(0.0, 0.5, channel_end_z);

            let outline = BezierCurveData {
                control_points: vec![out_start, out_end],
                tangents1: vec![out_start, out_end.lerp(out_start, 0.33)],
                tangents2: vec![out_start.lerp(out_end, 0.33), out_end],
                ..Default::default()
            };

            let depth = BezierCurveData {
                control_points: vec![depth_start, depth_end],
                tangents1: vec![depth_start, depth_end.lerp(depth_start, 0.33)],
                tangents2: vec![depth_start.lerp(depth_end, 0.33), depth_end],
                ..Default::default()
            };

            channels.push(ChannelLayer {
                name: format!("Channel {}", channels.len() + 1),
                outline,
                depth,
            });

            model.bottom_channels = Some(channels);
            push_history(model);
        }
        BoardAction::RemoveBottomChannel { index } => {
            if let Some(mut channels) = model.bottom_channels.take() {
                if index < channels.len() {
                    channels.remove(index);
                }
                model.bottom_channels = Some(channels);
            }
            push_history(model);
        }
    }

        effects
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;

    fn create_mock_model() -> BoardModel {
                BoardModel {
            outline: Some(BezierCurveData {
                control_points: vec![Vec3::ZERO, Vec3::new(5.0, 0.0, 0.0), Vec3::ZERO],
                tangents1: vec![Vec3::ZERO, Vec3::new(5.0, 0.0, -2.0), Vec3::ZERO],
                tangents2: vec![Vec3::ZERO, Vec3::new(5.0, 0.0, 2.0), Vec3::ZERO],
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn test_undo_redo_history() {
        let mut model = create_mock_model();
        // Initial state
        push_history(&mut model);
        assert_eq!(model.history_index, Some(0));
        assert_eq!(model.history.as_ref().unwrap().len(), 1);

        // Make a change
        if let Some(outline) = model.outline.as_mut() {
            outline.control_points[1].x = 10.0;
        }
        push_history(&mut model);
        assert_eq!(model.history_index, Some(1));
        assert_eq!(model.history.as_ref().unwrap().len(), 2);
        assert_eq!(model.outline.as_ref().unwrap().control_points[1].x, 10.0);

        // Undo
        update(&mut model, BoardAction::Undo);
        assert_eq!(model.history_index, Some(0));
        assert_eq!(model.outline.as_ref().unwrap().control_points[1].x, 5.0);

        // Redo
        update(&mut model, BoardAction::Redo);
        assert_eq!(model.history_index, Some(1));
        assert_eq!(model.outline.as_ref().unwrap().control_points[1].x, 10.0);
    }

    #[test]
    fn test_update_node_position_translates_handles() {
        let mut model = create_mock_model();
        let action = BoardAction::UpdateNodePosition {
            curve: "outline".to_string(),
            index: 1,
            node_type: "anchor".to_string(),
            position: [6.0, 0.0, 1.0],
        };
        update(&mut model, action);
        let outline = model.outline.as_ref().unwrap();

        // Anchor moved
        assert_eq!(outline.control_points[1], Vec3::new(6.0, 0.0, 1.0));
        // Handles translated equally (+1 X, +1 Z)
        assert_eq!(outline.tangents1[1], Vec3::new(6.0, 0.0, -1.0)); // Was [5, 0, -2]
        assert_eq!(outline.tangents2[1], Vec3::new(6.0, 0.0, 3.0)); // Was [5, 0, 2]
    }

    #[test]
    fn test_scale_width_action() {
        let mut model = create_mock_model();
        model.width = 20.0;

        let action = BoardAction::ScaleWidth { factor: 1.1 };
        update(&mut model, action);

        assert_eq!(model.width, 22.0);
                let outline = model.outline.as_ref().unwrap();
        // 5.0 * 1.1 = 5.5
        assert_eq!(outline.control_points[1].x, 5.5);
        assert_eq!(outline.tangents1[1].x, 5.5);
        assert_eq!(outline.tangents2[1].x, 5.5);
    }

        #[test]
    fn test_update_node_exact_weight() {
        let mut model = create_mock_model();
        let action = BoardAction::UpdateNodeExact {
            curve: "outline".to_string(),
            index: 1,
            anchor: None,
            tangent1: None,
            tangent2: None,
            weight: Some(2.5),
        };
        update(&mut model, action);
        
        let outline = model.outline.as_ref().unwrap();
        // Weights should be initialized and set
        let weights = outline.weights.as_ref().unwrap();
        assert_eq!(weights.len(), 3);
        assert_eq!(weights[0], 1.0); // Default initialized
        assert_eq!(weights[1], 2.5); // Updated value
        assert_eq!(weights[2], 1.0); // Default initialized
    }

        #[test]
    fn test_bottom_channels() {
        let mut model = create_mock_model();
        assert!(model.bottom_channels.is_none());

        update(&mut model, BoardAction::AddBottomChannel);
        assert_eq!(model.bottom_channels.as_ref().unwrap().len(), 1);
        assert_eq!(model.bottom_channels.as_ref().unwrap()[0].name, "Channel 1");

        assert_eq!(model.history.as_ref().unwrap().last().unwrap().bottom_channels.as_ref().unwrap().len(), 1);

        let action = BoardAction::UpdateNodePosition {
            curve: "channel_0_depth".to_string(),
            index: 0,
            node_type: "anchor".to_string(),
            position:[0.0, 1.0, 0.0],
        };
        update(&mut model, action);
        assert_eq!(model.bottom_channels.as_ref().unwrap()[0].depth.control_points[0].y, 1.0);

        update(&mut model, BoardAction::RemoveBottomChannel { index: 0 });
        assert_eq!(model.bottom_channels.as_ref().unwrap().len(), 0);
    }

    #[test]
    fn test_mri_disables_zebra() {
        let mut model = create_mock_model();
        model.show_zebra = Some(true);
        
        let action = BoardAction::UpdateBoolean {
            param: "showMriView".to_string(),
            value: true,
        };
        update(&mut model, action);
        
        assert_eq!(model.show_mri_view, Some(true));
        assert_eq!(model.show_zebra, Some(false));
    }
}
