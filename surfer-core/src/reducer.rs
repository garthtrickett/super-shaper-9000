use glam::Vec3;
use crate::model::*;

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
        _ => None
    }
}

pub fn push_history(model: &mut BoardModel) {
    let snapshot = ManualSnapshot {
        outline: model.outline.clone(),
        outline_layers: model.outline_layers.clone(),
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

pub fn update(model: &mut BoardModel, action: BoardAction) -> Vec<Effect> {
    let mut effects = Vec::new();

    match action {
        BoardAction::UpdateNumber { param, value } => match param.as_str() {
            "length" => model.length = value,
            "width" => model.width = value,
            "thickness" => model.thickness = value,
            "frontFinZ" => model.front_fin_z = value,
            "frontFinX" => model.front_fin_x = value,
            "rearFinZ" => model.rear_fin_z = value,
            "rearFinX" => model.rear_fin_x = value,
            "toeAngle" => model.toe_angle = value,
            "cantAngle" => model.cant_angle = value,
            _ => {}
        },
        BoardAction::UpdateString { param, value } => match param.as_str() {
            "finSetup" => model.fin_setup = value,
            "coreMaterial" => model.core_material = value,
            "glassingSchedule" => model.glassing_schedule = value,
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
            let is_outline_type = curve == "outline" || curve == "apexOutline" || curve == "railOutline";

            if let Some(target) = get_curve_mut(model, &curve) {
                let mut pos = Vec3::from_array(position);

                if node_type == "anchor" {
                    let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
                    if is_end_node && (is_cross_section || is_outline_type) {
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
        BoardAction::UpdateNodeExact { curve, index, anchor, tangent1, tangent2 } => {
            let is_cross_section = curve.starts_with("crossSection_");
            let is_outline_type = curve == "outline" || curve == "apexOutline" || curve == "railOutline";

            if let Some(target) = get_curve_mut(model, &curve) {
                if let Some(a) = anchor {
                    let mut pos = Vec3::from_array(a);
                    let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
                    if is_end_node && (is_cross_section || is_outline_type) {
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
        BoardAction::ImportS3dx { length, width, thickness, outline, rail_outline, apex_outline, rocker_top, rocker_bottom, apex_rocker, cross_sections, outline_layers } => {
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
}
