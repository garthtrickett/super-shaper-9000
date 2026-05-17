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

pub fn update(model: &mut BoardModel, dirty: &mut DirtyState, action: BoardAction) -> Vec<Effect> {
    match action {
        act @ (BoardAction::UpdateNumber { .. }
        | BoardAction::UpdateString { .. }
        | BoardAction::UpdateBoolean { .. }
        | BoardAction::ScaleWidth { .. }
        | BoardAction::ScaleThickness { .. }) => handle_parametric_scaling(model, dirty, act),
        act @ (BoardAction::LoadDesign { .. }
        | BoardAction::SetCurves { .. }
        | BoardAction::ImportBrd { .. }
        | BoardAction::ImportS3dx { .. }) => handle_import(model, dirty, act),
        act @ (BoardAction::UpdateNodePosition { .. }
        | BoardAction::SelectNode { .. }
        | BoardAction::RemoveNode { .. }
        | BoardAction::InsertNode { .. }
        | BoardAction::ApplyContinuity { .. }
        | BoardAction::UpdateNodeExact { .. }) => handle_node_mutations(model, dirty, act),
        act @ (BoardAction::SaveHistorySnapshot | BoardAction::Undo | BoardAction::Redo) => {
            handle_history(model, dirty, act)
        }
        act @ (BoardAction::AddOutlineLayer
        | BoardAction::RemoveOutlineLayer { .. }
        | BoardAction::ToggleOutlineLayer { .. }
        | BoardAction::AddBottomChannel
        | BoardAction::RemoveBottomChannel { .. }
        | BoardAction::ToggleChannelSymmetry { .. }
        | BoardAction::AddCrossSection { .. }) => handle_layer_toggles(model, dirty, act),
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

fn handle_history(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    dirty.global_rebuild = true;
    match action {
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
        _ => {}
    }
    Vec::new()
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

fn mark_node_dirty(model: &BoardModel, dirty: &mut DirtyState, curve_name: &str, index: usize) {
    if curve_name.starts_with("crossSection_") {
        let idx_str = curve_name.strip_prefix("crossSection_").unwrap_or("");
        if let Ok(idx) = idx_str.parse::<usize>() {
            let mut min_z = f32::NEG_INFINITY;
            let mut max_z = f32::INFINITY;
            if idx > 0 {
                if let Some(cs) = model.cross_sections.get(idx - 1) {
                    min_z = cs.control_points.first().map(|p| p.z).unwrap_or(min_z);
                }
            }
            if let Some(cs) = model.cross_sections.get(idx + 1) {
                max_z = cs.control_points.first().map(|p| p.z).unwrap_or(max_z);
            }
            if min_z == f32::NEG_INFINITY {
                min_z = -1000.0;
            }
            if max_z == f32::INFINITY {
                max_z = 1000.0;
            }
            dirty.dirty_z_ranges.push((min_z - 2.0, max_z + 2.0));
        }
        return;
    }

    let curve = match crate::geometry::get_curve(model, curve_name) {
        Some(c) => c,
        None => return,
    };

    if curve.control_points.is_empty() {
        return;
    }

    let i_prev = index.saturating_sub(1);
    let i_next = (index + 1).min(curve.control_points.len().saturating_sub(1));

    let mut min_z = f32::INFINITY;
    let mut max_z = f32::NEG_INFINITY;

    let mut check_z = |z: f32| {
        if z < min_z {
            min_z = z;
        }
        if z > max_z {
            max_z = z;
        }
    };

    for i in i_prev..=i_next {
        check_z(curve.control_points[i].z);
        if let Some(t1) = curve.tangents1.get(i) {
            check_z(t1.z);
        }
        if let Some(t2) = curve.tangents2.get(i) {
            check_z(t2.z);
        }
    }

    if min_z != f32::INFINITY && max_z != f32::NEG_INFINITY {
        dirty.dirty_z_ranges.push((min_z - 2.0, max_z + 2.0));
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

fn handle_node_mutations(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    match action {
        BoardAction::UpdateNodePosition {
            curve,
            index,
            node_type,
            position,
        } => {
            mark_node_dirty(model, dirty, &curve, index);
            let pos = Vec3::from_array(position);
            apply_node_position(model, &curve, index, &node_type, pos);
            mark_node_dirty(model, dirty, &curve, index);

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
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
                        let mut mirrored_pos = pos;
                        mirrored_pos.x = -mirrored_pos.x;
                        apply_node_position(
                            model,
                            &mirrored_curve,
                            index,
                            &node_type,
                            mirrored_pos,
                        );
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
                    }
                }
            }
        }
        BoardAction::SelectNode { node } => {
            model.selected_node = node;
        }
        BoardAction::RemoveNode { curve, index } => {
            mark_node_dirty(model, dirty, &curve, index);
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
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
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

            if let Some(idx) = inserted_idx {
                mark_node_dirty(model, dirty, &curve, idx);
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
                        let mut m_idx = None;
                        if let Some(m_target) = get_curve_mut(model, &mirrored_curve) {
                            m_idx = crate::bezier::insert_node(m_target, t);
                        }
                        if let Some(idx) = m_idx {
                            mark_node_dirty(model, dirty, &mirrored_curve, idx);
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
            mark_node_dirty(model, dirty, &curve, index);
            apply_continuity(model, &curve, index, &level, master_str);
            mark_node_dirty(model, dirty, &curve, index);

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
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
                        apply_continuity(model, &mirrored_curve, index, &level, master_str);
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
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
            mark_node_dirty(model, dirty, &curve, index);
            apply_node_exact(
                model,
                &curve,
                index,
                anchor.map(Vec3::from_array),
                tangent1.map(Vec3::from_array),
                tangent2.map(Vec3::from_array),
                weight,
            );
            mark_node_dirty(model, dirty, &curve, index);

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
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
                        apply_node_exact(
                            model,
                            &mirrored_curve,
                            index,
                            m_anchor,
                            m_t1,
                            m_t2,
                            weight,
                        );
                        mark_node_dirty(model, dirty, &mirrored_curve, index);
                    }
                }
            }
            push_history(model);
        }
        _ => {}
    }
    Vec::new()
}

// Deleted in favor of geometry::map_slice_local_to_world