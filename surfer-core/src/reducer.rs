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
        act @ (BoardAction::AddStringer
        | BoardAction::UpdateStringer { .. }
        | BoardAction::RemoveStringer { .. }
        | BoardAction::AddDecal
        | BoardAction::UpdateDecal { .. }
        | BoardAction::RemoveDecal { .. }) => handle_aesthetic_mutations(model, dirty, act),
    }
}

fn handle_aesthetic_mutations(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    dirty.global_rebuild = true;
    match action {
        BoardAction::AddStringer => {
            let mut stringers = model.stringers.take().unwrap_or_default();
            stringers.push(StringerConfig {
                name: format!("Stringer {}", stringers.len()),
                width: 0.25,
                shift: 0.0,
                tilt: 0.0,
                color_d3d: 10320,
                mapping_d3d: 0,
                image_mapped_d3d: "Cedar".to_string(),
                display_d3d: true,
                superposition_order: 1,
            });
            model.stringers = Some(stringers);
            push_history(model);
        }
        BoardAction::UpdateStringer {
            index,
            width,
            shift,
            tilt,
        } => {
            if let Some(stringers) = &mut model.stringers {
                if let Some(s) = stringers.get_mut(index) {
                    s.width = width;
                    s.shift = shift;
                    s.tilt = tilt;
                }
            }
            push_history(model);
        }
        BoardAction::RemoveStringer { index } => {
            if let Some(stringers) = &mut model.stringers {
                if index < stringers.len() {
                    stringers.remove(index);
                }
            }
            push_history(model);
        }
        BoardAction::AddDecal => {
            let mut decals = model.decals.take().unwrap_or_default();
            decals.push(DecalConfig {
                file: "logo.png".to_string(),
                file_rel: "logo.png".to_string(),
                name: format!("Decal {}", decals.len()),
                length: 4.0,
                width: 4.0,
                reverse_left_right: false,
                keep_prop: true,
                tilt: 0.0,
                centre_x: 0.0,
                centre_y: 0.0,
                centre_color: 0,
                display_d3d: true,
                deck: true,
                bottom: false,
                projected_mapping: true,
                limit_rail: false,
                limit_apex: false,
                limit_opposite_rail: true,
                superposition_order: 1,
                reflexion_coef: -1.0,
                opacity: 1.0,
                resize_with_board: false,
                replace_with_board: true,
            });
            model.decals = Some(decals);
            push_history(model);
        }
        BoardAction::UpdateDecal {
            index,
            centre_x,
            centre_y,
            length,
            width,
            deck,
        } => {
            if let Some(decals) = &mut model.decals {
                if let Some(d) = decals.get_mut(index) {
                    let old_half_l = d.length / 2.0;
                    dirty
                        .dirty_z_ranges
                        .push((d.centre_x - old_half_l - 1.0, d.centre_x + old_half_l + 1.0));

                    d.centre_x = centre_x;
                    d.centre_y = centre_y;
                    d.length = length;
                    d.width = width;
                    d.deck = deck;

                    let new_half_l = length / 2.0;
                    dirty
                        .dirty_z_ranges
                        .push((centre_x - new_half_l - 1.0, centre_x + new_half_l + 1.0));
                }
            }
            push_history(model);
        }
        BoardAction::RemoveDecal { index } => {
            if let Some(decals) = &mut model.decals {
                if index < decals.len() {
                    let d = &decals[index];
                    let half_l = d.length / 2.0;
                    dirty
                        .dirty_z_ranges
                        .push((d.centre_x - half_l - 1.0, d.centre_x + half_l + 1.0));
                    decals.remove(index);
                }
            }
            push_history(model);
        }
        _ => {}
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BoardAction, BoardModel, StringerConfig};

    #[test]
    fn test_handle_aesthetic_mutations() {
        let mut model = BoardModel::default();
        model.stringers = Some(vec![StringerConfig {
            name: "Original".to_string(),
            width: 0.25,
            shift: 0.0,
            tilt: 0.0,
            color_d3d: 10320,
            mapping_d3d: 0,
            image_mapped_d3d: "Cedar".to_string(),
            display_d3d: true,
            superposition_order: 1,
        }]);

        let mut dirty = DirtyState::default();
        dirty.global_rebuild = false;
        dirty.dirty_z_ranges.clear();

        let action = BoardAction::UpdateStringer {
            index: 0,
            width: 0.5,
            shift: 2.0,
            tilt: 1.0,
        };

        let _effects = update(&mut model, &mut dirty, action);

        let stringers = model.stringers.as_ref().unwrap();
        assert_eq!(stringers[0].width, 0.5);
        assert_eq!(stringers[0].shift, 2.0);
        assert_eq!(stringers[0].tilt, 1.0);

        assert!(model.history.is_some());
        assert_eq!(model.history_index, Some(0));
        assert!(dirty.global_rebuild);
    }
}

pub fn push_history(model: &mut BoardModel) {
    let snap = ManualSnapshot {
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
        imported_fin_boxes: model.imported_fin_boxes.clone(),
        stringers: model.stringers.clone(),
        decals: model.decals.clone(),
    };

    if model.history.is_none() {
        model.history = Some(Vec::new());
    }

    if let Some(history) = &mut model.history {
        let idx = model
            .history_index
            .unwrap_or_else(|| history.len().saturating_sub(1));
        history.truncate(idx + 1);
        history.push(snap);
        if history.len() > 50 {
            history.remove(0);
        }
        model.history_index = Some(history.len() - 1);
    }
}

/* REMOVED_DUPLICATE_BLOCK
            let mut layers = model.outline_layers.take().unwrap_or_default();
            layers.push(OutlineLayer {
                name: format!("Layer {}", layers.len()),
                active: true,
                otl_ext: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(8.0, 0.0, 20.0),
                        glam::Vec3::new(8.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(8.0, 0.0, 10.0),
                        glam::Vec3::new(8.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(8.0, 0.0, 30.0),
                        glam::Vec3::new(8.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                otl_int: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(7.0, 0.0, 20.0),
                        glam::Vec3::new(7.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(7.0, 0.0, 10.0),
                        glam::Vec3::new(7.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(7.0, 0.0, 30.0),
                        glam::Vec3::new(7.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
            });
            model.outline_layers = Some(layers);
            push_history(model);
        }
        BoardAction::RemoveOutlineLayer { index } => {
            if let Some(layers) = &mut model.outline_layers {
                if index < layers.len() {
                    layers.remove(index);
                }
            }
            push_history(model);
        }
        BoardAction::ToggleOutlineLayer { index } => {
            if let Some(layers) = &mut model.outline_layers {
                if let Some(layer) = layers.get_mut(index) {
                    layer.active = !layer.active;
                }
            }
        }
        BoardAction::AddBottomChannel => {
            let mut channels = model.bottom_channels.take().unwrap_or_default();
            channels.push(ChannelLayer {
                name: format!("Channel {}", channels.len()),
                is_symmetric: true,
                left_outline: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(-4.0, 0.0, 20.0),
                        glam::Vec3::new(-4.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(-4.0, 0.0, 10.0),
                        glam::Vec3::new(-4.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(-4.0, 0.0, 30.0),
                        glam::Vec3::new(-4.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                right_outline: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(4.0, 0.0, 20.0),
                        glam::Vec3::new(4.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(4.0, 0.0, 10.0),
                        glam::Vec3::new(4.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(4.0, 0.0, 30.0),
                        glam::Vec3::new(4.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                left_depth: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(0.0, 0.5, 20.0),
                        glam::Vec3::new(0.0, 0.5, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(0.0, 0.5, 10.0),
                        glam::Vec3::new(0.0, 0.5, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(0.0, 0.5, 30.0),
                        glam::Vec3::new(0.0, 0.5, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                right_depth: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(0.0, 0.5, 20.0),
                        glam::Vec3::new(0.0, 0.5, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(0.0, 0.5, 10.0),
                        glam::Vec3::new(0.0, 0.5, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(0.0, 0.5, 30.0),
                        glam::Vec3::new(0.0, 0.5, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
            });
            model.bottom_channels = Some(channels);
            push_history(model);
        }
        BoardAction::RemoveBottomChannel { index } => {
            if let Some(channels) = &mut model.bottom_channels {
                if index < channels.len() {
                    channels.remove(index);
                }
            }
            push_history(model);
        }
        BoardAction::ToggleChannelSymmetry { index } => {
            if let Some(channels) = &mut model.bottom_channels {
                if let Some(channel) = channels.get_mut(index) {
                    channel.is_symmetric = !channel.is_symmetric;
                    if channel.is_symmetric {
                        channel.left_outline = channel.right_outline.clone();
                        for p in &mut channel.left_outline.control_points {
                            p.x = -p.x;
                        }
                        for p in &mut channel.left_outline.tangents1 {
                            p.x = -p.x;
                        }
                        for p in &mut channel.left_outline.tangents2 {
                            p.x = -p.x;
                        }
                        channel.left_depth = channel.right_depth.clone();
                    }
                }
            }
        }
        BoardAction::AddCrossSection { z } => {
            let mut new_cs = model.cross_sections.first().cloned().unwrap_or_default();
            for p in &mut new_cs.control_points {
                p.z = z;
            }
            for p in &mut new_cs.tangents1 {
                p.z = z;
            }
            for p in &mut new_cs.tangents2 {
                p.z = z;
            }

            // To be accurate, we'd copy the blend from the actual geometry at z.
            // For now, this just adds a copy of the first slice at position z.
            model.cross_sections.push(new_cs);
            model.cross_sections.sort_by(|a, b| {
                let za = a.control_points.first().map(|p| p.z).unwrap_or(0.0);
                let zb = b.control_points.first().map(|p| p.z).unwrap_or(0.0);
                za.partial_cmp(&zb).unwrap()
            });

            let new_idx = model.cross_sections.iter().position(|cs| {
                let za = cs.control_points.first().map(|p| p.z).unwrap_or(0.0);
                (za - z).abs() < 1e-4
            });

            if let Some(idx) = new_idx {
                model.selected_node = Some(SelectedNode {
                    curve: format!("crossSection_{}", idx),
                    index: 0,
                    node_type: "anchor".to_string(),
                });
            }

                        push_history(model);
        }
        _ => {}
    }
    Vec::new()
}
*/

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
                    model.imported_fin_boxes = snap.imported_fin_boxes.clone();
                    model.stringers = snap.stringers.clone();
                    model.decals = snap.decals.clone();
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
                    model.imported_fin_boxes = snap.imported_fin_boxes.clone();
                    model.stringers = snap.stringers.clone();
                    model.decals = snap.decals.clone();
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

fn scale_curves_in_model(model: &mut BoardModel, sx: f32, sy: f32, sz: f32) {
    let scale_opt = |curve: &mut Option<BezierCurveData>| {
        if let Some(c) = curve.as_mut() {
            for p in &mut c.control_points {
                p.x *= sx;
                p.y *= sy;
                p.z *= sz;
            }
            for p in &mut c.tangents1 {
                p.x *= sx;
                p.y *= sy;
                p.z *= sz;
            }
            for p in &mut c.tangents2 {
                p.x *= sx;
                p.y *= sy;
                p.z *= sz;
            }
        }
    };
    let scale_req = |curve: &mut BezierCurveData| {
        for p in &mut curve.control_points {
            p.x *= sx;
            p.y *= sy;
            p.z *= sz;
        }
        for p in &mut curve.tangents1 {
            p.x *= sx;
            p.y *= sy;
            p.z *= sz;
        }
        for p in &mut curve.tangents2 {
            p.x *= sx;
            p.y *= sy;
            p.z *= sz;
        }
    };

    scale_opt(&mut model.outline);
    scale_opt(&mut model.rail_outline);
    scale_opt(&mut model.apex_outline);
    scale_opt(&mut model.deck_shoulder);
    scale_opt(&mut model.rocker_top);
    scale_opt(&mut model.rocker_bottom);
    scale_opt(&mut model.apex_rocker);

    if let Some(layers) = &mut model.outline_layers {
        for l in layers {
            scale_req(&mut l.otl_ext);
            scale_req(&mut l.otl_int);
        }
    }

    if let Some(channels) = &mut model.bottom_channels {
        for c in channels {
            scale_req(&mut c.left_outline);
            scale_req(&mut c.right_outline);
            scale_req(&mut c.left_depth);
            scale_req(&mut c.right_depth);
        }
    }

    for cs in &mut model.cross_sections {
        scale_req(cs);
    }
}

fn handle_parametric_scaling(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    match action {
        BoardAction::UpdateNumber { param, value } => match param.as_str() {
            "length" => {
                if model.length > 0.0 && value > 0.0 {
                    let factor = value / model.length;
                    scale_curves_in_model(model, 1.0, 1.0, factor);
                }
                model.length = value;
                dirty.global_rebuild = true;
            }
            "width" => {
                if model.width > 0.0 && value > 0.0 {
                    let factor = value / model.width;
                    scale_curves_in_model(model, factor, 1.0, 1.0);
                }
                model.width = value;
                dirty.global_rebuild = true;
            }
            "thickness" => {
                if model.thickness > 0.0 && value > 0.0 {
                    let factor = value / model.thickness;
                    scale_curves_in_model(model, 1.0, factor, 1.0);
                }
                model.thickness = value;
                dirty.global_rebuild = true;
            }
            "frontFinZ" => {
                model.front_fin_z = value;
                dirty.global_rebuild = true;
            }
            "frontFinX" => {
                model.front_fin_x = value;
                dirty.global_rebuild = true;
            }
            "rearFinZ" => {
                model.rear_fin_z = value;
                dirty.global_rebuild = true;
            }
            "rearFinX" => {
                model.rear_fin_x = value;
                dirty.global_rebuild = true;
            }
            "toeAngle" => {
                model.toe_angle = value;
                dirty.global_rebuild = true;
            }
            "cantAngle" => {
                model.cant_angle = value;
                dirty.global_rebuild = true;
            }
            "swallowDepth" => {
                model.swallow_depth = value;
                dirty.global_rebuild = true;
            }
            "vConcaveTail" => {
                model.v_concave_tail = value;
                dirty.global_rebuild = true;
            }
            "vConcaveNose" => {
                model.v_concave_nose = value;
                dirty.global_rebuild = true;
            }
            "railCoefficientTail" => {
                model.rail_coefficient_tail = value;
                dirty.global_rebuild = true;
            }
            "railCoefficientNose" => {
                model.rail_coefficient_nose = value;
                dirty.global_rebuild = true;
            }
            "thicknessZStretch" => {
                model.thickness_z_stretch = value;
                dirty.global_rebuild = true;
            }
            "mriSlicePosition" => model.mri_slice_position = Some(value),
            _ => {}
        },
        BoardAction::UpdateString { param, value } => {
            dirty.global_rebuild = true;
            match param.as_str() {
                "finSetup" => model.fin_setup = value,
                "coreMaterial" => model.core_material = value,
                "glassingSchedule" => model.glassing_schedule = value,
                "tailType" => model.tail_type = value,
                _ => {}
            }
        }
        BoardAction::UpdateBoolean { param, value } => match param.as_str() {
            "showHeatmap" => {
                model.show_heatmap = Some(value);
                if value {
                    model.show_zebra = Some(false);
                    model.show_topography = Some(false);
                }
            }
            "showTopography" => {
                model.show_topography = Some(value);
                if value {
                    model.show_zebra = Some(false);
                    model.show_heatmap = Some(false);
                    model.show_mri_view = Some(false);
                }
            }
            "showZebra" => {
                model.show_zebra = Some(value);
                if value {
                    model.show_heatmap = Some(false);
                    model.show_topography = Some(false);
                    model.show_mri_view = Some(false);
                }
            }
            "showOutline" => model.show_outline = Some(value),
            "showRockerTop" => model.show_rocker_top = Some(value),
            "showRockerBottom" => model.show_rocker_bottom = Some(value),
            "showApexOutline" => model.show_apex_outline = Some(value),
            "showRailOutline" => model.show_rail_outline = Some(value),
            "showApexRocker" => model.show_apex_rocker = Some(value),
            "showDeckShoulder" => model.show_deck_shoulder = Some(value),
            "showCrossSections" => model.show_cross_sections = Some(value),
            "showMriView" => {
                model.show_mri_view = Some(value);
                if value {
                    model.show_zebra = Some(false);
                    model.show_topography = Some(false);
                }
            }
            _ => {}
        },
        BoardAction::ScaleWidth { factor } => {
            dirty.global_rebuild = true;
            model.width *= factor;
            scale_curves_in_model(model, factor, 1.0, 1.0);
            push_history(model);
        }
        BoardAction::ScaleThickness { factor } => {
            dirty.global_rebuild = true;
            model.thickness *= factor;
            scale_curves_in_model(model, 1.0, factor, 1.0);
            push_history(model);
        }
        _ => {}
    }
    Vec::new()
}

fn handle_import(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    let mut effects = Vec::new();
    dirty.global_rebuild = true;

    match action {
        BoardAction::LoadDesign { state } => {
            *model = *state;
            push_history(model);
        }
        BoardAction::SetCurves {
            outline,
            rail_outline,
            apex_outline,
            rocker_top,
            rocker_bottom,
            apex_rocker,
            deck_shoulder,
            cross_sections,
        } => {
            if let Some(o) = outline {
                model.outline = Some(o);
            }
            if let Some(ro) = rail_outline {
                model.rail_outline = Some(ro);
            }
            if let Some(ao) = apex_outline {
                model.apex_outline = Some(ao);
            }
            if let Some(rt) = rocker_top {
                model.rocker_top = Some(rt);
            }
            if let Some(rb) = rocker_bottom {
                model.rocker_bottom = Some(rb);
            }
            if let Some(ar) = apex_rocker {
                model.apex_rocker = Some(ar);
            }
            if let Some(ds) = deck_shoulder {
                model.deck_shoulder = Some(ds);
            }
            if let Some(cs) = cross_sections {
                model.cross_sections = cs;
            }
            push_history(model);
        }
        BoardAction::ImportBrd { bytes } => match crate::brd_parser::parse_brd(&bytes) {
            Ok(new_model) => {
                *model = new_model;
                push_history(model);
                effects.push(Effect::LogInfo {
                    message: "Successfully imported BRD".into(),
                });
            }
            Err(e) => {
                effects.push(Effect::LogInfo {
                    message: format!("Failed to import BRD: {}", e),
                });
            }
        },
        BoardAction::ImportS3dx { xml } => match crate::s3dx_parser::parse_s3dx(&xml) {
            Ok(new_model) => {
                *model = new_model;
                push_history(model);
                effects.push(Effect::LogInfo {
                    message: "Successfully imported S3DX".into(),
                });
            }
            Err(e) => {
                effects.push(Effect::LogInfo {
                    message: format!("Failed to import S3DX: {}", e),
                });
            }
        },
        _ => {}
    }
    effects
}

fn handle_layer_toggles(
    model: &mut BoardModel,
    dirty: &mut DirtyState,
    action: BoardAction,
) -> Vec<Effect> {
    dirty.global_rebuild = true;
    match action {
        BoardAction::AddOutlineLayer => {
            let mut layers = model.outline_layers.take().unwrap_or_default();
            layers.push(OutlineLayer {
                name: format!("Layer {}", layers.len()),
                active: true,
                otl_ext: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(8.0, 0.0, 20.0),
                        glam::Vec3::new(8.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(8.0, 0.0, 10.0),
                        glam::Vec3::new(8.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(8.0, 0.0, 30.0),
                        glam::Vec3::new(8.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                otl_int: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(7.0, 0.0, 20.0),
                        glam::Vec3::new(7.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(7.0, 0.0, 10.0),
                        glam::Vec3::new(7.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(7.0, 0.0, 30.0),
                        glam::Vec3::new(7.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
            });
            model.outline_layers = Some(layers);
            push_history(model);
        }
        BoardAction::RemoveOutlineLayer { index } => {
            if let Some(layers) = &mut model.outline_layers {
                if index < layers.len() {
                    layers.remove(index);
                }
            }
            push_history(model);
        }
        BoardAction::ToggleOutlineLayer { index } => {
            if let Some(layers) = &mut model.outline_layers {
                if let Some(layer) = layers.get_mut(index) {
                    layer.active = !layer.active;
                }
            }
        }
        BoardAction::AddBottomChannel => {
            let mut channels = model.bottom_channels.take().unwrap_or_default();
            channels.push(ChannelLayer {
                name: format!("Channel {}", channels.len()),
                is_symmetric: true,
                left_outline: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(-4.0, 0.0, 20.0),
                        glam::Vec3::new(-4.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(-4.0, 0.0, 10.0),
                        glam::Vec3::new(-4.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(-4.0, 0.0, 30.0),
                        glam::Vec3::new(-4.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                right_outline: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(4.0, 0.0, 20.0),
                        glam::Vec3::new(4.0, 0.0, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(4.0, 0.0, 10.0),
                        glam::Vec3::new(4.0, 0.0, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(4.0, 0.0, 30.0),
                        glam::Vec3::new(4.0, 0.0, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                left_depth: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(0.0, 0.5, 20.0),
                        glam::Vec3::new(0.0, 0.5, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(0.0, 0.5, 10.0),
                        glam::Vec3::new(0.0, 0.5, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(0.0, 0.5, 30.0),
                        glam::Vec3::new(0.0, 0.5, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
                right_depth: BezierCurveData {
                    control_points: vec![
                        glam::Vec3::new(0.0, 0.5, 20.0),
                        glam::Vec3::new(0.0, 0.5, 40.0),
                    ],
                    tangents1: vec![
                        glam::Vec3::new(0.0, 0.5, 10.0),
                        glam::Vec3::new(0.0, 0.5, 30.0),
                    ],
                    tangents2: vec![
                        glam::Vec3::new(0.0, 0.5, 30.0),
                        glam::Vec3::new(0.0, 0.5, 50.0),
                    ],
                    weights: None,
                    apex_ratio: None,
                    tuck_ratio: None,
                },
            });
            model.bottom_channels = Some(channels);
            push_history(model);
        }
        BoardAction::RemoveBottomChannel { index } => {
            if let Some(channels) = &mut model.bottom_channels {
                if index < channels.len() {
                    channels.remove(index);
                }
            }
            push_history(model);
        }
        BoardAction::ToggleChannelSymmetry { index } => {
            if let Some(channels) = &mut model.bottom_channels {
                if let Some(channel) = channels.get_mut(index) {
                    channel.is_symmetric = !channel.is_symmetric;
                    if channel.is_symmetric {
                        channel.left_outline = channel.right_outline.clone();
                        for p in &mut channel.left_outline.control_points {
                            p.x = -p.x;
                        }
                        for p in &mut channel.left_outline.tangents1 {
                            p.x = -p.x;
                        }
                        for p in &mut channel.left_outline.tangents2 {
                            p.x = -p.x;
                        }
                        channel.left_depth = channel.right_depth.clone();
                    }
                }
            }
        }
        BoardAction::AddCrossSection { z } => {
            let mut new_cs = model.cross_sections.first().cloned().unwrap_or_default();
            for p in &mut new_cs.control_points {
                p.z = z;
            }
            for p in &mut new_cs.tangents1 {
                p.z = z;
            }
            for p in &mut new_cs.tangents2 {
                p.z = z;
            }

            // To be accurate, we'd copy the blend from the actual geometry at z.
            // For now, this just adds a copy of the first slice at position z.
            model.cross_sections.push(new_cs);
            model.cross_sections.sort_by(|a, b| {
                let za = a.control_points.first().map(|p| p.z).unwrap_or(0.0);
                let zb = b.control_points.first().map(|p| p.z).unwrap_or(0.0);
                za.partial_cmp(&zb).unwrap()
            });

            let new_idx = model.cross_sections.iter().position(|cs| {
                let za = cs.control_points.first().map(|p| p.z).unwrap_or(0.0);
                (za - z).abs() < 1e-4
            });

            if let Some(idx) = new_idx {
                model.selected_node = Some(SelectedNode {
                    curve: format!("crossSection_{}", idx),
                    index: 0,
                    node_type: "anchor".to_string(),
                });
            }

            push_history(model);
        }
        _ => {}
    }
    Vec::new()
}
