use crate::geometry::{evaluate_bezier_at_z, get_board_bounds};
use crate::model::*;
use glam::Vec3;

fn get_curve_mut<'a>(
    model: &'a mut BoardModel,
    curve_name: &str,
) -> Option<&'a mut BezierCurveData> {
    match curve_name {
        "outline" => model.outline.as_mut(),
        "rockerTop" => model.rocker_top.as_mut(),
        "rockerBottom" => model.rocker_bottom.as_mut(),
        "apexOutline" => model.apex_outline.as_mut(),
        "railOutline" => model.rail_outline.as_mut(),
        "apexRocker" => model.apex_rocker.as_mut(),
        "deckShoulder" => model.deck_shoulder.as_mut(),
        name if name.starts_with("crossSection_") => {
            let idx_str = name.strip_prefix("crossSection_")?;
            let idx: usize = idx_str.parse().ok()?;
            model.cross_sections.get_mut(idx)
        }
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
        }
        name if name.starts_with("channel_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 4 {
                let idx: usize = parts[1].parse().ok()?;
                let side = parts[2];
                let curve_type = parts[3];
                if let Some(channels) = &mut model.bottom_channels {
                    if let Some(channel) = channels.get_mut(idx) {
                        return match (side, curve_type) {
                            ("left", "outline") => Some(&mut channel.left_outline),
                            ("right", "outline") => Some(&mut channel.right_outline),
                            ("left", "depth") => Some(&mut channel.left_depth),
                            ("right", "depth") => Some(&mut channel.right_depth),
                            _ => None,
                        };
                    }
                }
            }
            None
        }
        _ => None,
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
        deck_shoulder: model.deck_shoulder.clone(),
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

fn scale_curve_data_width(c: &mut BezierCurveData, factor: f32) {
    for p in &mut c.control_points {
        p.x *= factor;
    }
    for p in &mut c.tangents1 {
        p.x *= factor;
    }
    for p in &mut c.tangents2 {
        p.x *= factor;
    }
}

fn scale_curve_width(curve: &mut Option<BezierCurveData>, factor: f32) {
    if factor <= 0.0 || factor.is_nan() {
        return;
    }
    if let Some(c) = curve.as_mut() {
        scale_curve_data_width(c, factor);
    }
}

fn scale_curve_data_thickness(c: &mut BezierCurveData, factor: f32) {
    for p in &mut c.control_points {
        p.y *= factor;
    }
    for p in &mut c.tangents1 {
        p.y *= factor;
    }
    for p in &mut c.tangents2 {
        p.y *= factor;
    }
}

fn scale_curve_thickness(curve: &mut Option<BezierCurveData>, factor: f32) {
    if factor <= 0.0 || factor.is_nan() {
        return;
    }
    if let Some(c) = curve.as_mut() {
        scale_curve_data_thickness(c, factor);
    }
}

fn scale_curve_data_length(c: &mut BezierCurveData, factor: f32) {
    for p in &mut c.control_points {
        p.z *= factor;
    }
    for p in &mut c.tangents1 {
        p.z *= factor;
    }
    for p in &mut c.tangents2 {
        p.z *= factor;
    }
}

fn scale_curve_length(curve: &mut Option<BezierCurveData>, factor: f32) {
    if factor <= 0.0 || factor.is_nan() {
        return;
    }
    if let Some(c) = curve.as_mut() {
        scale_curve_data_length(c, factor);
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
    if len < 2 {
        return;
    }

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

fn apply_node_position(
    model: &mut BoardModel,
    curve_name: &str,
    index: usize,
    node_type: &str,
    mut pos: Vec3,
) {
    if curve_name == "rockerTop" || curve_name == "rockerBottom" || curve_name == "apexRocker" {
        pos.x = 0.0;
    }

    let is_cross_section = curve_name.starts_with("crossSection_");
    let is_outline_type = curve_name == "outline"
        || curve_name == "apexOutline"
        || curve_name == "railOutline"
        || curve_name == "deckShoulder"
        || curve_name.starts_with("outlineLayer_")
        || (curve_name.starts_with("channel_") && curve_name.ends_with("_outline"));

    if let Some(target) = get_curve_mut(model, curve_name) {
        if node_type == "anchor" {
            let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
            let is_layer = curve_name.starts_with("outlineLayer_");
            let is_channel = curve_name.starts_with("channel_");
            if is_end_node && (is_cross_section || (is_outline_type && !is_layer && !is_channel)) {
                pos.x = 0.0;
            }
            if is_cross_section || is_outline_type {
                if is_channel && curve_name.contains("_left_") {
                    pos.x = pos.x.min(0.0);
                } else if !is_channel || curve_name.contains("_right_") {
                    pos.x = pos.x.max(0.0);
                }
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

fn apply_node_exact(
    model: &mut BoardModel,
    curve_name: &str,
    index: usize,
    anchor: Option<Vec3>,
    tangent1: Option<Vec3>,
    tangent2: Option<Vec3>,
    weight: Option<f32>,
) {
    let is_cross_section = curve_name.starts_with("crossSection_");
    let is_outline_type = curve_name == "outline"
        || curve_name == "apexOutline"
        || curve_name == "railOutline"
        || curve_name == "deckShoulder"
        || curve_name.starts_with("outlineLayer_")
        || (curve_name.starts_with("channel_") && curve_name.ends_with("_outline"));

    if let Some(target) = get_curve_mut(model, curve_name) {
        if let Some(a) = anchor {
            let mut pos = a;
            if curve_name == "rockerTop"
                || curve_name == "rockerBottom"
                || curve_name == "apexRocker"
            {
                pos.x = 0.0;
            }
            let is_end_node = index == 0 || index == target.control_points.len().saturating_sub(1);
            let is_layer = curve_name.starts_with("outlineLayer_");
            let is_channel = curve_name.starts_with("channel_");
            if is_end_node && (is_cross_section || (is_outline_type && !is_layer && !is_channel)) {
                pos.x = 0.0;
            }
            if is_cross_section || is_outline_type {
                if is_channel && curve_name.contains("_left_") {
                    pos.x = pos.x.min(0.0);
                } else if !is_channel || curve_name.contains("_right_") {
                    pos.x = pos.x.max(0.0);
                }
            }
            target.control_points[index] = pos;
        }
        if let Some(mut t1) = tangent1 {
            if curve_name == "rockerTop"
                || curve_name == "rockerBottom"
                || curve_name == "apexRocker"
            {
                t1.x = 0.0;
            }
            target.tangents1[index] = t1;
        }
        if let Some(mut t2) = tangent2 {
            if curve_name == "rockerTop"
                || curve_name == "rockerBottom"
                || curve_name == "apexRocker"
            {
                t2.x = 0.0;
            }
            target.tangents2[index] = t2;
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
}

fn apply_continuity(
    model: &mut BoardModel,
    curve_name: &str,
    index: usize,
    level: &str,
    master: &str,
) {
    if let Some(target) = get_curve_mut(model, curve_name) {
        if index > 0 && index < target.control_points.len().saturating_sub(1) {
            let anchor = target.control_points[index];
            let is_t1_master = master == "tangent1";

            let (t_src, mut t_tgt, f_src, f_tgt) = if is_t1_master {
                (
                    target.tangents1[index],
                    target.tangents2[index],
                    target.control_points[index - 1],
                    target.control_points[index + 1],
                )
            } else {
                (
                    target.tangents2[index],
                    target.tangents1[index],
                    target.control_points[index + 1],
                    target.control_points[index - 1],
                )
            };

            let dir = anchor - t_src;
            let dist_tgt = (t_tgt - anchor).length();

            if (level == "G1" || level == "G2") && dir.length_squared() > 1e-6 {
                t_tgt = anchor + dir.normalize() * dist_tgt;
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

fn remove_curve_node(target: &mut BezierCurveData, index: usize) {
    if index > 0
        && index < target.control_points.len().saturating_sub(1)
        && target.control_points.len() > 2
    {
        target.control_points.remove(index);
        if index < target.tangents1.len() {
            target.tangents1.remove(index);
        }
        if index < target.tangents2.len() {
            target.tangents2.remove(index);
        }
        if let Some(weights) = &mut target.weights {
            if index < weights.len() {
                weights.remove(index);
            }
        }
    }
}

pub fn update(model: &mut BoardModel, action: BoardAction) -> Vec<Effect> {
    let mut effects = Vec::new();

    match action {
        BoardAction::UpdateNumber { param, value } => match param.as_str() {
            "length" => {
                let factor = if model.length > 0.0 {
                    value / model.length
                } else {
                    1.0
                };
                model.length = value;
                scale_curve_length(&mut model.outline, factor);
                scale_curve_length(&mut model.rail_outline, factor);
                scale_curve_length(&mut model.apex_outline, factor);
                scale_curve_length(&mut model.rocker_top, factor);
                scale_curve_length(&mut model.rocker_bottom, factor);
                scale_curve_length(&mut model.apex_rocker, factor);
                scale_curve_length(&mut model.deck_shoulder, factor);
                if let Some(layers) = &mut model.outline_layers {
                    for l in layers {
                        scale_curve_data_length(&mut l.otl_ext, factor);
                        scale_curve_data_length(&mut l.otl_int, factor);
                    }
                }
                if let Some(channels) = &mut model.bottom_channels {
                    for ch in channels {
                        scale_curve_data_length(&mut ch.left_outline, factor);
                        scale_curve_data_length(&mut ch.right_outline, factor);
                        scale_curve_data_length(&mut ch.left_depth, factor);
                        scale_curve_data_length(&mut ch.right_depth, factor);
                    }
                }
                for cs in &mut model.cross_sections {
                    scale_curve_data_length(cs, factor);
                }
            }
            "width" => {
                let factor = if model.width > 0.0 {
                    value / model.width
                } else {
                    1.0
                };
                model.width = value;
                scale_curve_width(&mut model.outline, factor);
                scale_curve_width(&mut model.rail_outline, factor);
                scale_curve_width(&mut model.apex_outline, factor);
                scale_curve_width(&mut model.deck_shoulder, factor);
                scale_curve_width(&mut model.deck_shoulder, factor);
                if let Some(layers) = &mut model.outline_layers {
                    for l in layers {
                        scale_curve_data_width(&mut l.otl_ext, factor);
                        scale_curve_data_width(&mut l.otl_int, factor);
                    }
                }
                if let Some(channels) = &mut model.bottom_channels {
                    for ch in channels {
                        scale_curve_data_width(&mut ch.left_outline, factor);
                        scale_curve_data_width(&mut ch.right_outline, factor);
                    }
                }
                for cs in &mut model.cross_sections {
                    scale_curve_data_width(cs, factor);
                }
            }
            "swallowDepth" => {
                model.swallow_depth = value;
                apply_tail_type(model);
            }
            "thickness" => {
                let factor = if model.thickness > 0.0 {
                    value / model.thickness
                } else {
                    1.0
                };
                model.thickness = value;
                scale_curve_thickness(&mut model.rocker_top, factor);
                scale_curve_thickness(&mut model.rocker_bottom, factor);
                scale_curve_thickness(&mut model.apex_rocker, factor);
                scale_curve_thickness(&mut model.deck_shoulder, factor);
                scale_curve_thickness(&mut model.deck_shoulder, factor);
                if let Some(channels) = &mut model.bottom_channels {
                    for ch in channels {
                        scale_curve_data_thickness(&mut ch.left_depth, factor);
                        scale_curve_data_thickness(&mut ch.right_depth, factor);
                    }
                }
                for cs in &mut model.cross_sections {
                    scale_curve_data_thickness(cs, factor);
                }
            }
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
            "showSolidMesh" => model.show_solid_mesh = Some(value),
            "showHeatmap" => {
                model.show_heatmap = Some(value);
                if value {
                    model.show_zebra = Some(false);
                }
            }
            "showZebra" => {
                model.show_zebra = Some(value);
                if value {
                    model.show_heatmap = Some(false);
                }
            }
            "showApexLine" => model.show_apex_line = Some(value),
            "showOutline" => model.show_outline = Some(value),
            "showRockerTop" => model.show_rocker_top = Some(value),
            "showRockerBottom" => model.show_rocker_bottom = Some(value),
            "showApexOutline" => model.show_apex_outline = Some(value),
            "showRailOutline" => model.show_rail_outline = Some(value),
            "showApexRocker" => model.show_apex_rocker = Some(value),
            "showDeckShoulder" => model.show_deck_shoulder = Some(value),
            "showCrossSections" => model.show_cross_sections = Some(value),
            "showCurvature" => model.show_curvature = Some(value),
            "showMriView" => {
                model.show_mri_view = Some(value);
                if value {
                    model.show_zebra = Some(false);
                }
            }
            _ => {}
        },
        BoardAction::LoadDesign { state } => {
            *model = *state;
            // Suppress log info for LoadDesign to avoid console spam during syncing
        }
        BoardAction::SetCurves {
            outline,
            rail_outline,
            apex_outline,
            deck_shoulder,
            rocker_top,
            rocker_bottom,
            apex_rocker,
            cross_sections,
        } => {
            if let Some(c) = outline {
                model.outline = Some(c);
            }
            if let Some(c) = deck_shoulder {
                model.deck_shoulder = Some(c);
            }
            if let Some(c) = rail_outline {
                model.rail_outline = Some(c);
            }
            if let Some(c) = apex_outline {
                model.apex_outline = Some(c);
            }
            if let Some(c) = rocker_top {
                model.rocker_top = Some(c);
            }
            if let Some(c) = rocker_bottom {
                model.rocker_bottom = Some(c);
            }
            if let Some(c) = apex_rocker {
                model.apex_rocker = Some(c);
            }
            if let Some(cs) = cross_sections {
                model.cross_sections = cs;
            }
            push_history(model);
        }
        BoardAction::UpdateNodePosition {
            curve,
            index,
            node_type,
            position,
        } => {
            let pos = Vec3::from_array(position);
            apply_node_position(model, &curve, index, &node_type, pos);

            if curve.starts_with("channel_") {
                let parts: Vec<&str> = curve.split('_').collect();
                if parts.len() == 4 {
                    let idx: usize = parts[1].parse().unwrap_or(0);
                    let side = parts[2];
                    let c_type = parts[3];
                    let is_sym = model
                        .bottom_channels
                        .as_ref()
                        .and_then(|c| c.get(idx))
                        .is_some_and(|ch| ch.is_symmetric);

                    if is_sym {
                        let mirrored_side = if side == "left" { "right" } else { "left" };
                        let mirrored_curve =
                            format!("channel_{}_{}_{}", idx, mirrored_side, c_type);
                        let mut mirrored_pos = pos;
                        mirrored_pos.x = -mirrored_pos.x;
                        apply_node_position(
                            model,
                            &mirrored_curve,
                            index,
                            &node_type,
                            mirrored_pos,
                        );
                    }
                }
            }
        }
        BoardAction::SelectNode { node } => {
            model.selected_node = node;
        }
        BoardAction::RemoveNode { curve, index } => {
            if let Some(target) = get_curve_mut(model, &curve) {
                remove_curve_node(target, index);
            }

            if curve.starts_with("channel_") {
                let parts: Vec<&str> = curve.split('_').collect();
                if parts.len() == 4 {
                    let idx: usize = parts[1].parse().unwrap_or(0);
                    let side = parts[2];
                    let c_type = parts[3];
                    let is_sym = model
                        .bottom_channels
                        .as_ref()
                        .and_then(|c| c.get(idx))
                        .is_some_and(|ch| ch.is_symmetric);

                    if is_sym {
                        let mirrored_side = if side == "left" { "right" } else { "left" };
                        let mirrored_curve =
                            format!("channel_{}_{}_{}", idx, mirrored_side, c_type);
                        if let Some(m_target) = get_curve_mut(model, &mirrored_curve) {
                            remove_curve_node(m_target, index);
                        }
                    }
                }
            }
            model.selected_node = None;
            push_history(model);
        }
                BoardAction::InsertNode { curve, t } => {
            let mut inserted_idx = None;
            if let Some(target) = get_curve_mut(model, &curve) {
                inserted_idx = crate::bezier::insert_node(target, t);
            }

            if curve.starts_with("channel_") {
                let parts: Vec<&str> = curve.split('_').collect();
                if parts.len() == 4 {
                    let idx: usize = parts[1].parse().unwrap_or(0);
                    let side = parts[2];
                    let c_type = parts[3];
                    let is_sym = model
                        .bottom_channels
                        .as_ref()
                        .and_then(|c| c.get(idx))
                        .is_some_and(|ch| ch.is_symmetric);

                    if is_sym {
                        let mirrored_side = if side == "left" { "right" } else { "left" };
                        let mirrored_curve =
                            format!("channel_{}_{}_{}", idx, mirrored_side, c_type);
                                                if let Some(m_target) = get_curve_mut(model, &mirrored_curve) {
                            crate::bezier::insert_node(m_target, t);
                        }
                    }
                }
            }

            if let Some(idx) = inserted_idx {
                model.selected_node = Some(SelectedNode {
                    curve: curve.clone(),
                    index: idx,
                    node_type: "anchor".to_string(),
                });
            }

            push_history(model);
        }
        BoardAction::ApplyContinuity {
            curve,
            index,
            level,
            master,
        } => {
            let master_str = master.as_deref().unwrap_or("tangent1");
            apply_continuity(model, &curve, index, &level, master_str);

            if curve.starts_with("channel_") {
                let parts: Vec<&str> = curve.split('_').collect();
                if parts.len() == 4 {
                    let idx: usize = parts[1].parse().unwrap_or(0);
                    let side = parts[2];
                    let c_type = parts[3];
                    let is_sym = model
                        .bottom_channels
                        .as_ref()
                        .and_then(|c| c.get(idx))
                        .is_some_and(|ch| ch.is_symmetric);

                    if is_sym {
                        let mirrored_side = if side == "left" { "right" } else { "left" };
                        let mirrored_curve =
                            format!("channel_{}_{}_{}", idx, mirrored_side, c_type);
                        apply_continuity(model, &mirrored_curve, index, &level, master_str);
                    }
                }
            }
        }
        BoardAction::UpdateNodeExact {
            curve,
            index,
            anchor,
            tangent1,
            tangent2,
            weight,
        } => {
            apply_node_exact(
                model,
                &curve,
                index,
                anchor.map(Vec3::from_array),
                tangent1.map(Vec3::from_array),
                tangent2.map(Vec3::from_array),
                weight,
            );

            if curve.starts_with("channel_") {
                let parts: Vec<&str> = curve.split('_').collect();
                if parts.len() == 4 {
                    let idx: usize = parts[1].parse().unwrap_or(0);
                    let side = parts[2];
                    let c_type = parts[3];
                    let is_sym = model
                        .bottom_channels
                        .as_ref()
                        .and_then(|c| c.get(idx))
                        .is_some_and(|ch| ch.is_symmetric);

                    if is_sym {
                        let mirrored_side = if side == "left" { "right" } else { "left" };
                        let mirrored_curve =
                            format!("channel_{}_{}_{}", idx, mirrored_side, c_type);
                        let m_anchor = anchor.map(|a| Vec3::new(-a[0], a[1], a[2]));
                        let m_t1 = tangent1.map(|a| Vec3::new(-a[0], a[1], a[2]));
                        let m_t2 = tangent2.map(|a| Vec3::new(-a[0], a[1], a[2]));
                        apply_node_exact(
                            model,
                            &mirrored_curve,
                            index,
                            m_anchor,
                            m_t1,
                            m_t2,
                            weight,
                        );
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
                    model.deck_shoulder = snap.deck_shoulder.clone();
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
                    model.deck_shoulder = snap.deck_shoulder.clone();
                    model.cross_sections = snap.cross_sections.clone();
                }
            }
        }
        BoardAction::ScaleWidth { factor } => {
            model.width *= factor;
            scale_curve_width(&mut model.outline, factor);
            scale_curve_width(&mut model.rail_outline, factor);
            scale_curve_width(&mut model.apex_outline, factor);
            if let Some(layers) = &mut model.outline_layers {
                for l in layers {
                    scale_curve_data_width(&mut l.otl_ext, factor);
                    scale_curve_data_width(&mut l.otl_int, factor);
                }
            }
            if let Some(channels) = &mut model.bottom_channels {
                for ch in channels {
                    scale_curve_data_width(&mut ch.left_outline, factor);
                    scale_curve_data_width(&mut ch.right_outline, factor);
                }
            }
            for cs in &mut model.cross_sections {
                scale_curve_data_width(cs, factor);
            }
            push_history(model);
        }
        BoardAction::ScaleThickness { factor } => {
            model.thickness *= factor;
            scale_curve_thickness(&mut model.rocker_top, factor);
            scale_curve_thickness(&mut model.rocker_bottom, factor);
            scale_curve_thickness(&mut model.apex_rocker, factor);
            if let Some(channels) = &mut model.bottom_channels {
                for ch in channels {
                    scale_curve_data_thickness(&mut ch.left_depth, factor);
                    scale_curve_data_thickness(&mut ch.right_depth, factor);
                }
            }
            for cs in &mut model.cross_sections {
                scale_curve_data_thickness(cs, factor);
            }
            push_history(model);
        }
        BoardAction::ImportBrd { bytes } => {
            match crate::brd_parser::parse_brd(&bytes) {
                Ok(mut parsed_model) => {
                    // Preserve UI/Viewport view states so importing doesn't randomly toggle off heatmaps etc.
                    parsed_model.show_gizmos = model.show_gizmos;
                    parsed_model.show_solid_mesh = model.show_solid_mesh;
                    parsed_model.show_heatmap = model.show_heatmap;
                    parsed_model.show_zebra = model.show_zebra;
                    parsed_model.show_apex_line = model.show_apex_line;
                    parsed_model.show_outline = model.show_outline;
                    parsed_model.show_rocker_top = model.show_rocker_top;
                    parsed_model.show_rocker_bottom = model.show_rocker_bottom;
                    parsed_model.show_apex_outline = model.show_apex_outline;
                    parsed_model.show_rail_outline = model.show_rail_outline;
                    parsed_model.show_apex_rocker = model.show_apex_rocker;
                    parsed_model.show_deck_shoulder = model.show_deck_shoulder;
                    parsed_model.show_cross_sections = model.show_cross_sections;
                    parsed_model.show_curvature = model.show_curvature;
                    parsed_model.show_mri_view = model.show_mri_view;
                    parsed_model.mri_slice_position = model.mri_slice_position;

                    // BRD files do not contain 3D cross-sections.
                    // We preserve the current cross-sections to allow 3D mesh generation.
                    if parsed_model.cross_sections.is_empty() {
                        parsed_model.cross_sections = model.cross_sections.clone();
                    }

                    *model = parsed_model;
                    push_history(model);
                    effects.push(Effect::LogInfo {
                        message: "Rust Engine: BRD file imported successfully.".to_string(),
                    });
                }
                Err(e) => {
                    effects.push(Effect::LogInfo {
                        message: format!("Rust Engine Error: Failed to parse BRD: {}", e),
                    });
                }
            }
        }
        BoardAction::ImportS3dx { xml } => {
            match crate::s3dx_parser::parse_s3dx(&xml) {
                Ok(mut parsed_model) => {
                    // Preserve UI/Viewport view states so importing doesn't randomly toggle off heatmaps etc.
                    parsed_model.show_gizmos = model.show_gizmos;
                    parsed_model.show_solid_mesh = model.show_solid_mesh;
                    parsed_model.show_heatmap = model.show_heatmap;
                    parsed_model.show_zebra = model.show_zebra;
                    parsed_model.show_apex_line = model.show_apex_line;
                    parsed_model.show_outline = model.show_outline;
                    parsed_model.show_rocker_top = model.show_rocker_top;
                    parsed_model.show_rocker_bottom = model.show_rocker_bottom;
                    parsed_model.show_apex_outline = model.show_apex_outline;
                    parsed_model.show_rail_outline = model.show_rail_outline;
                    parsed_model.show_apex_rocker = model.show_apex_rocker;
                    parsed_model.show_deck_shoulder = model.show_deck_shoulder;
                    parsed_model.show_cross_sections = model.show_cross_sections;
                    parsed_model.show_curvature = model.show_curvature;
                    parsed_model.show_mri_view = model.show_mri_view;
                    parsed_model.mri_slice_position = model.mri_slice_position;

                    *model = parsed_model;
                    push_history(model);
                    effects.push(Effect::LogInfo {
                        message: "Rust Engine: S3DX file imported successfully.".to_string(),
                    });
                }
                Err(e) => {
                    effects.push(Effect::LogInfo {
                        message: format!("Rust Engine Error: Failed to parse S3DX: {}", e),
                    });
                }
            }
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
                    active: true,
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
        BoardAction::ToggleOutlineLayer { index } => {
            if let Some(layers) = &mut model.outline_layers {
                if let Some(layer) = layers.get_mut(index) {
                    layer.active = !layer.active;
                }
            }
            push_history(model);
        }
        BoardAction::AddBottomChannel => {
            let mut channels = model.bottom_channels.take().unwrap_or_default();

            let bounds = get_board_bounds(model);
            // If outline isn't set yet, fallback to using the numerical length parameter
            let tip_z = if bounds.tip_z.abs() < 1e-3 {
                model.length / 2.0
            } else {
                bounds.tip_z
            };

            let channel_start_z = tip_z - 25.0;
            let channel_end_z = tip_z - 5.0;

            let right_out_start = Vec3::new(2.0, 0.0, channel_start_z);
            let right_out_end = Vec3::new(2.0, 0.0, channel_end_z);
            let right_depth_start = Vec3::new(0.0, 0.5, channel_start_z);
            let right_depth_end = Vec3::new(0.0, 0.5, channel_end_z);

            let left_out_start = Vec3::new(-2.0, 0.0, channel_start_z);
            let left_out_end = Vec3::new(-2.0, 0.0, channel_end_z);
            let left_depth_start = Vec3::new(0.0, 0.5, channel_start_z);
            let left_depth_end = Vec3::new(0.0, 0.5, channel_end_z);

            let right_outline = BezierCurveData {
                control_points: vec![right_out_start, right_out_end],
                tangents1: vec![right_out_start, right_out_end.lerp(right_out_start, 0.33)],
                tangents2: vec![right_out_start.lerp(right_out_end, 0.33), right_out_end],
                ..Default::default()
            };

            let right_depth = BezierCurveData {
                control_points: vec![right_depth_start, right_depth_end],
                tangents1: vec![
                    right_depth_start,
                    right_depth_end.lerp(right_depth_start, 0.33),
                ],
                tangents2: vec![
                    right_depth_start.lerp(right_depth_end, 0.33),
                    right_depth_end,
                ],
                ..Default::default()
            };

            let left_outline = BezierCurveData {
                control_points: vec![left_out_start, left_out_end],
                tangents1: vec![left_out_start, left_out_end.lerp(left_out_start, 0.33)],
                tangents2: vec![left_out_start.lerp(left_out_end, 0.33), left_out_end],
                ..Default::default()
            };

            let left_depth = BezierCurveData {
                control_points: vec![left_depth_start, left_depth_end],
                tangents1: vec![
                    left_depth_start,
                    left_depth_end.lerp(left_depth_start, 0.33),
                ],
                tangents2: vec![left_depth_start.lerp(left_depth_end, 0.33), left_depth_end],
                ..Default::default()
            };

            channels.push(ChannelLayer {
                name: format!("Channel {}", channels.len() + 1),
                is_symmetric: true,
                left_outline,
                right_outline,
                left_depth,
                right_depth,
            });

            model.bottom_channels = Some(channels);
            push_history(model);
        }
        BoardAction::ToggleChannelSymmetry { index } => {
            if let Some(channels) = &mut model.bottom_channels {
                if let Some(channel) = channels.get_mut(index) {
                    channel.is_symmetric = !channel.is_symmetric;
                }
            }
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

        assert!((model.width - 22.0).abs() < 1e-5);
        let outline = model.outline.as_ref().unwrap();
        // 5.0 * 1.1 = 5.5
        assert!((outline.control_points[1].x - 5.5).abs() < 1e-5);
        assert!((outline.tangents1[1].x - 5.5).abs() < 1e-5);
        assert!((outline.tangents2[1].x - 5.5).abs() < 1e-5);
    }

    #[test]
    fn test_parametric_proxy_updates_curves() {
        let mut model = create_mock_model();
        model.length = 100.0;
        model.width = 20.0;
        model.thickness = 2.5;

        // Setup a node to verify scaling across all axes
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 1.25, 50.0)],
            tangents1: vec![Vec3::new(10.0, 1.25, 50.0)],
            tangents2: vec![Vec3::new(10.0, 1.25, 50.0)],
            ..Default::default()
        });

        // 1. Parametric Width Scale (20.0 -> 22.0 is a 1.1x factor)
        update(
            &mut model,
            BoardAction::UpdateNumber {
                param: "width".to_string(),
                value: 22.0,
            },
        );
        assert!((model.width - 22.0).abs() < 1e-5);
        assert!((model.outline.as_ref().unwrap().control_points[0].x - 11.0).abs() < 1e-5);

        // 2. Parametric Length Scale (100.0 -> 110.0 is a 1.1x factor)
        update(
            &mut model,
            BoardAction::UpdateNumber {
                param: "length".to_string(),
                value: 110.0,
            },
        );
        assert!((model.length - 110.0).abs() < 1e-5);
        assert!((model.outline.as_ref().unwrap().control_points[0].z - 55.0).abs() < 1e-5);

        // 3. Parametric Thickness Scale (2.5 -> 3.0 is a 1.2x factor)
        update(
            &mut model,
            BoardAction::UpdateNumber {
                param: "thickness".to_string(),
                value: 3.0,
            },
        );
        assert!((model.thickness - 3.0).abs() < 1e-5);
        // The outline isn't scaled in Y (thickness), but we can verify the top rocker is
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.25, 0.0)],
            tangents1: vec![Vec3::ZERO],
            tangents2: vec![Vec3::ZERO],
            ..Default::default()
        });
        update(
            &mut model,
            BoardAction::UpdateNumber {
                param: "thickness".to_string(),
                value: 3.6,
            },
        ); // 3.0 -> 3.6 is 1.2x
        assert!((model.rocker_top.as_ref().unwrap().control_points[0].y - 1.5).abs() < 1e-5);
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
        // Tested under U-space mapping
        let mut model = create_mock_model();
        assert!(model.bottom_channels.is_none());

        update(&mut model, BoardAction::AddBottomChannel);
        assert_eq!(model.bottom_channels.as_ref().unwrap().len(), 1);
        assert_eq!(model.bottom_channels.as_ref().unwrap()[0].name, "Channel 1");
        assert!(model.bottom_channels.as_ref().unwrap()[0].is_symmetric);

        let action = BoardAction::UpdateNodePosition {
            curve: "channel_0_right_depth".to_string(),
            index: 0,
            node_type: "anchor".to_string(),
            position: [1.0, 1.0, 0.0],
        };
        update(&mut model, action);
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .right_depth
                .control_points[0]
                .y,
            1.0
        );
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .right_depth
                .control_points[0]
                .x,
            1.0
        );

        // Left should update and mirror X
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .left_depth
                .control_points[0]
                .y,
            1.0
        );
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .left_depth
                .control_points[0]
                .x,
            -1.0
        );

        update(&mut model, BoardAction::RemoveBottomChannel { index: 0 });
        assert_eq!(model.bottom_channels.as_ref().unwrap().len(), 0);
    }

    #[test]
    fn test_insert_node_action() {
        let mut model = create_mock_model();
        assert_eq!(model.outline.as_ref().unwrap().control_points.len(), 3);

        let action = BoardAction::InsertNode {
            curve: "outline".to_string(),
            t: 0.25,
        };
        update(&mut model, action);

        let outline = model.outline.as_ref().unwrap();
        assert_eq!(outline.control_points.len(), 4);
        assert_eq!(outline.tangents1.len(), 4);
        assert_eq!(outline.tangents2.len(), 4);
    }

    #[test]
    fn test_asymmetric_channel_update() {
        let mut model = create_mock_model();
        update(&mut model, BoardAction::AddBottomChannel);

        // Unlink the channel symmetry
        model.bottom_channels.as_mut().unwrap()[0].is_symmetric = false;

        // Move the right side only
        let action = BoardAction::UpdateNodePosition {
            curve: "channel_0_right_outline".to_string(),
            index: 0,
            node_type: "anchor".to_string(),
            position: [5.0, 0.0, 0.0],
        };
        update(&mut model, action);

        // Right should update
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .right_outline
                .control_points[0]
                .x,
            5.0
        );

        // Left should REMAIN at the default initialized position (-2.0)
        assert_eq!(
            model.bottom_channels.as_ref().unwrap()[0]
                .left_outline
                .control_points[0]
                .x,
            -2.0
        );
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
