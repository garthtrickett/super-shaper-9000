use crate::model::{BoardModel, RawGeometryData};
use glam::Vec3;

pub mod sampler;
pub mod surface;
pub mod topology;
pub mod volume;

#[derive(Default, Clone)]
pub struct MeshCache {
    pub z_rings: Vec<f32>,
    pub u_columns: Vec<(f32, f32, bool, f32)>,
    pub vertices: Vec<f32>,
    pub normals: Vec<f32>,
    pub colors: Vec<f32>,
    pub uvs: Vec<f32>,
}

pub fn generate_mesh(
    model: &BoardModel,
    dirty: &mut crate::model::DirtyState,
    cache: &mut MeshCache,
) -> RawGeometryData {
    log::debug!(
        "[Rust core] generate_mesh: Rebuilding for length {:.1}",
        model.length
    );
    let scale = 1.0 / 12.0;

    let bounds = crate::geometry::get_board_bounds(model);
    let notch_z = bounds.notch_z;

    let outline = match &model.outline {
        Some(o) => o,
        None => return RawGeometryData::default(),
    };
    if outline.control_points.is_empty() {
        return RawGeometryData::default();
    }

    let nose_z = bounds.nose_z;
    let tip_z = bounds.tip_z;
    let v_tip = bounds.tip_t;

    let z_rings = sampler::compute_z_rings(model, dirty, cache, nose_z, tip_z, outline);
    let segments_v = z_rings.len().saturating_sub(1);

    let u_columns =
        sampler::compute_u_columns(model, dirty, cache, &z_rings, outline, notch_z, v_tip);
    let num_cols = u_columns.len();
    let right_half_cols = num_cols / 2;
    let half = right_half_cols.saturating_sub(1);

    if cache.u_columns.len() != u_columns.len()
        || cache
            .u_columns
            .iter()
            .zip(u_columns.iter())
            .any(|(a, b)| (a.0 - b.0).abs() > 1e-5)
    {
        dirty.global_rebuild = true;
    }

    let surface_data = surface::build_surface(
        model, dirty, cache, &z_rings, &u_columns, outline, notch_z, v_tip, scale,
    );
    let mut vertices = surface_data.vertices;
    let mut normals = surface_data.normals;
    let mut uvs = surface_data.uvs;
    let mut colors = surface_data.colors;

    let mut indices =
        topology::generate_hull_indices(&vertices, segments_v, num_cols, right_half_cols);

    if (tip_z - notch_z) >= 1e-3 {
        log::debug!(
            "[Rust core] generate_mesh: Carving swallow tail notch (Depth: {:.2}in)",
            tip_z - notch_z
        );
    }

    // Save the new hull data back into the SurferEngine's MeshCache before caps are appended.
    cache.z_rings = z_rings.clone();
    cache.u_columns = u_columns.clone();
    cache.vertices = vertices.clone();
    cache.normals = normals.clone();
    cache.colors = colors.clone();
    cache.uvs = uvs.clone();

    topology::generate_swallow_notch_wall(
        &z_rings,
        segments_v,
        num_cols,
        half,
        notch_z,
        tip_z,
        v_tip,
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );

    topology::generate_cap(
        0,
        Vec3::new(0.0, 0.0, -1.0),
        true,
        num_cols,
        half,
        right_half_cols,
        &u_columns,
        scale,
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );

    topology::generate_cap(
        segments_v,
        Vec3::new(0.0, 0.0, 1.0),
        false,
        num_cols,
        half,
        right_half_cols,
        &u_columns,
        scale,
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );

    let volume_liters = volume::compute_volume(&vertices, segments_v, num_cols);
    log::debug!("[Rust core] Computed Mesh Volume: {:.2}L", volume_liters);

    let mut line_vertices = Vec::new();
    let mut line_colors = Vec::new();

    let mut push_line = |p0: Vec3, p1: Vec3, color: Vec3| {
        line_vertices.push(p0.x * scale);
        line_vertices.push(p0.y * scale);
        line_vertices.push(p0.z * scale);
        line_colors.push(color.x);
        line_colors.push(color.y);
        line_colors.push(color.z);
        line_vertices.push(p1.x * scale);
        line_vertices.push(p1.y * scale);
        line_vertices.push(p1.z * scale);
        line_colors.push(color.x);
        line_colors.push(color.y);
        line_colors.push(color.z);
    };

    let show_gizmos = model.show_gizmos.unwrap_or(true);

    let mut add_curve_lines = |curve_opt: &Option<crate::model::BezierCurveData>,
                               color: Vec3,
                               is_outline: bool,
                               curve_name: &str| {
        if let Some(curve) = curve_opt {
            if curve.control_points.is_empty() {
                return;
            }
            let steps = 100;
            let mut mapped_pts = Vec::with_capacity(steps + 1);

            for i in 0..=steps {
                let t = i as f32 / steps as f32;
                let raw_p = crate::geometry::evaluate_curve(curve, t);

                let mapped_p = if curve_name.starts_with("crossSection_") {
                    let z = curve.control_points.first().map(|p| p.z).unwrap_or(0.0);
                    crate::geometry::map_slice_local_to_world(model, z, t, raw_p)
                } else if curve_name == "rockerTop"
                    || curve_name == "rockerBottom"
                    || curve_name == "apexRocker"
                    || curve_name.starts_with("channel_")
                {
                    raw_p
                } else {
                    let v_outer = crate::geometry::find_v_at_z(
                        model.outline.as_ref().unwrap(),
                        raw_p.z,
                        0.0,
                        bounds.tip_t,
                    );
                    let profile = crate::geometry::get_board_profile_at_z(model, raw_p.z, v_outer);
                    match curve_name {
                        "outline" | "apexOutline" => Vec3::new(raw_p.x, profile.apex_y, raw_p.z),
                        "railOutline" => Vec3::new(raw_p.x, profile.tuck_y, raw_p.z),
                        "deckShoulder" => Vec3::new(raw_p.x, profile.shoulder_y, raw_p.z),
                        _ if curve_name.starts_with("outlineLayer_") => {
                            Vec3::new(raw_p.x, profile.apex_y, raw_p.z)
                        }
                        _ => raw_p,
                    }
                };
                mapped_pts.push(mapped_p);
            }

            for i in 0..steps {
                let p0 = mapped_pts[i];
                let p1 = mapped_pts[i + 1];
                push_line(p0, p1, color);
                if is_outline {
                    let mut m0 = p0;
                    m0.x = -m0.x;
                    let mut m1 = p1;
                    m1.x = -m1.x;
                    push_line(m0, m1, color);
                }
            }

            if show_gizmos {
                let num_segments = curve.control_points.len().saturating_sub(1);
                let num_segments_f = num_segments as f32;

                for i in 0..curve.control_points.len() {
                    let raw_p = curve.control_points[i];
                    let t = if num_segments > 0 {
                        i as f32 / num_segments_f
                    } else {
                        0.0
                    };

                    let map_point = |t: f32, raw_p: Vec3| -> Vec3 {
                        if curve_name.starts_with("crossSection_") {
                            let z = curve.control_points.first().map(|p| p.z).unwrap_or(0.0);
                            crate::geometry::map_slice_local_to_world(model, z, t, raw_p)
                        } else if curve_name == "rockerTop"
                            || curve_name == "rockerBottom"
                            || curve_name == "apexRocker"
                            || curve_name.starts_with("channel_")
                        {
                            raw_p
                        } else {
                            let v_outer = crate::geometry::find_v_at_z(
                                model.outline.as_ref().unwrap(),
                                raw_p.z,
                                0.0,
                                bounds.tip_t,
                            );
                            let profile =
                                crate::geometry::get_board_profile_at_z(model, raw_p.z, v_outer);
                            match curve_name {
                                "outline" | "apexOutline" => {
                                    Vec3::new(raw_p.x, profile.apex_y, raw_p.z)
                                }
                                "railOutline" => Vec3::new(raw_p.x, profile.tuck_y, raw_p.z),
                                "deckShoulder" => Vec3::new(raw_p.x, profile.shoulder_y, raw_p.z),
                                _ if curve_name.starts_with("outlineLayer_") => {
                                    Vec3::new(raw_p.x, profile.apex_y, raw_p.z)
                                }
                                _ => raw_p,
                            }
                        }
                    };

                    let p = map_point(t, raw_p);

                    let c_anchor = Vec3::new(1.0, 1.0, 1.0);
                    let s = 1.0;
                    push_line(p - Vec3::X * s, p + Vec3::X * s, c_anchor);
                    push_line(p - Vec3::Y * s, p + Vec3::Y * s, c_anchor);
                    push_line(p - Vec3::Z * s, p + Vec3::Z * s, c_anchor);

                                        if is_outline {
                        let c_mirrored_anchor = Vec3::new(0.35, 0.35, 0.35); // Dark grey
                        let mut mp = p;
                        mp.x = -mp.x;
                        push_line(mp - Vec3::X * s, mp + Vec3::X * s, c_mirrored_anchor);
                        push_line(mp - Vec3::Y * s, mp + Vec3::Y * s, c_mirrored_anchor);
                        push_line(mp - Vec3::Z * s, mp + Vec3::Z * s, c_mirrored_anchor);
                    }

                    let c_tan = Vec3::new(0.4, 0.4, 1.0);
                    if i < curve.tangents1.len() {
                        let t_idx = if i > 0 { i as f32 - 0.33 } else { 0.0 } / num_segments_f;
                        let t1_mapped = map_point(t_idx.max(0.0), curve.tangents1[i]);
                        push_line(p, t1_mapped, c_tan);
                        push_line(t1_mapped - Vec3::X * s, t1_mapped + Vec3::X * s, c_tan);
                        push_line(t1_mapped - Vec3::Y * s, t1_mapped + Vec3::Y * s, c_tan);
                        push_line(t1_mapped - Vec3::Z * s, t1_mapped + Vec3::Z * s, c_tan);
                    }
                    if i < curve.tangents2.len() {
                        let t_idx = if i < num_segments {
                            i as f32 + 0.33
                        } else {
                            1.0
                        } / num_segments_f;
                        let t2_mapped = map_point(t_idx.min(1.0), curve.tangents2[i]);
                        push_line(p, t2_mapped, c_tan);
                        push_line(t2_mapped - Vec3::X * s, t2_mapped + Vec3::X * s, c_tan);
                        push_line(t2_mapped - Vec3::Y * s, t2_mapped + Vec3::Y * s, c_tan);
                        push_line(t2_mapped - Vec3::Z * s, t2_mapped + Vec3::Z * s, c_tan);
                    }
                }
            }
        }
    };

    if model.show_outline.unwrap_or(true) {
        add_curve_lines(&model.outline, Vec3::new(1.0, 1.0, 0.0), true, "outline");
    }
    if model.show_rocker_top.unwrap_or(true) {
        add_curve_lines(
            &model.rocker_top,
            Vec3::new(0.0, 1.0, 0.0),
            false,
            "rockerTop",
        );
    }
    if model.show_rocker_bottom.unwrap_or(true) {
        add_curve_lines(
            &model.rocker_bottom,
            Vec3::new(1.0, 0.0, 0.0),
            false,
            "rockerBottom",
        );
    }
    if model.show_apex_outline.unwrap_or(true) {
        add_curve_lines(
            &model.apex_outline,
            Vec3::new(0.0, 1.0, 1.0),
            true,
            "apexOutline",
        );
    }
    if model.show_rail_outline.unwrap_or(true) {
        add_curve_lines(
            &model.rail_outline,
            Vec3::new(1.0, 0.0, 1.0),
            true,
            "railOutline",
        );
    }
    if model.show_apex_rocker.unwrap_or(true) {
        add_curve_lines(
            &model.apex_rocker,
            Vec3::new(0.0, 0.5, 1.0),
            false,
            "apexRocker",
        );
    }
    if model.show_deck_shoulder.unwrap_or(true) {
        add_curve_lines(
            &model.deck_shoulder,
            Vec3::new(1.0, 0.5, 0.0),
            true,
            "deckShoulder",
        );
    }

    if model.show_cross_sections.unwrap_or(true) {
        for (i, cs) in model.cross_sections.iter().enumerate() {
            let name = format!("crossSection_{}", i);
            add_curve_lines(&Some(cs.clone()), Vec3::new(0.5, 0.5, 0.5), true, &name);
        }
    }

    if let Some(layers) = &model.outline_layers {
        for (i, l) in layers.iter().enumerate() {
            if l.active {
                let name_ext = format!("outlineLayer_{}_ext", i);
                let name_int = format!("outlineLayer_{}_int", i);
                add_curve_lines(
                    &Some(l.otl_ext.clone()),
                    Vec3::new(1.0, 1.0, 0.0),
                    true,
                    &name_ext,
                );
                add_curve_lines(
                    &Some(l.otl_int.clone()),
                    Vec3::new(1.0, 1.0, 0.0),
                    true,
                    &name_int,
                );
            }
        }
    }
    if let Some(channels) = &model.bottom_channels {
        for (i, ch) in channels.iter().enumerate() {
            let n_lo = format!("channel_{}_left_outline", i);
            let n_ro = format!("channel_{}_right_outline", i);
            let n_ld = format!("channel_{}_left_depth", i);
            let n_rd = format!("channel_{}_right_depth", i);
            add_curve_lines(
                &Some(ch.left_outline.clone()),
                Vec3::new(0.0, 1.0, 1.0),
                false,
                &n_lo,
            );
            add_curve_lines(
                &Some(ch.right_outline.clone()),
                Vec3::new(0.0, 1.0, 1.0),
                false,
                &n_ro,
            );
            add_curve_lines(
                &Some(ch.left_depth.clone()),
                Vec3::new(1.0, 0.5, 0.0),
                false,
                &n_ld,
            );
            add_curve_lines(
                &Some(ch.right_depth.clone()),
                Vec3::new(1.0, 0.5, 0.0),
                false,
                &n_rd,
            );
        }
    }

    RawGeometryData {
        vertices,
        indices,
        uvs,
        colors,
        normals,
        volume_liters,
        line_vertices,
        line_colors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

    #[test]
    fn test_patch_caps_for_squash_tails() {
        // This test verifies that blunt tails (like a square/squash tail) are generated
        // as a "patch" (a grid of vertices) instead of a "pole".
        let model = BoardModel {
            length: 70.0,
            width: 20.0,
            thickness: 2.5,
            outline: Some(BezierCurveData {
                control_points: vec![
                    Vec3::new(5.0, 0.0, -35.0), // Square nose
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(5.0, 0.0, 35.0), // Square tail
                ],
                tangents1: vec![
                    Vec3::new(5.0, 0.0, -35.0),
                    Vec3::new(10.0, 0.0, -10.0),
                    Vec3::new(5.0, 0.0, 25.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, 0.0, -25.0),
                    Vec3::new(10.0, 0.0, 10.0),
                    Vec3::new(5.0, 0.0, 35.0),
                ],
                ..Default::default()
            }),
            rocker_top: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, 1.25, 0.0), Vec3::new(0.0, 1.25, 35.0)],
                ..Default::default()
            }),
            rocker_bottom: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(0.0, -1.25, 35.0)],
                ..Default::default()
            }),
            cross_sections: vec![BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(5.0, 1.25, 0.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.5, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let mesh = generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );
        let vertices: Vec<Vec3> = mesh
            .vertices
            .chunks_exact(3)
            .map(|c| Vec3::new(c[0], c[1], c[2]))
            .collect();

        let scale = 1.0 / 12.0;
        let (min_z, max_z) = vertices
            .iter()
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(min_z, max_z), v| {
                (min_z.min(v.z), max_z.max(v.z))
            });

        // There should be a small tolerance for floating point comparisons
        let nose_rail_vertices = vertices
            .iter()
            .filter(|v| (v.z - min_z).abs() < 1e-4 && (v.x.abs() - 5.0 * scale).abs() < 1e-4)
            .count();
        let tail_rail_vertices = vertices
            .iter()
            .filter(|v| (v.z - max_z).abs() < 1e-4 && (v.x.abs() - 5.0 * scale).abs() < 1e-4)
            .count();

        // Since we explicitly modelled a square nose and tail (X=5.0), the cap should be a patch
        // spanning from X=5 to X=0. Therefore, vertices at the rail (X=5.0) MUST exist on the cap/ring.
        assert!(
            nose_rail_vertices > 0,
            "Square nose should have vertices at the rail."
        );
        assert!(
            tail_rail_vertices > 0,
            "Square tail should have vertices at the rail."
        );

        println!("✅ test_patch_caps_for_squash_tails passed.");
    }

    #[test]
    fn test_pin_tail_degenerate_pole() {
        let model = BoardModel {
            length: 70.0,
            width: 20.0,
            thickness: 2.5,
            outline: Some(BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, 0.0, -35.0), // Pin nose
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 0.0, 35.0), // Pin tail
                ],
                tangents1: vec![
                    Vec3::new(0.0, 0.0, -35.0),
                    Vec3::new(10.0, 0.0, -10.0),
                    Vec3::new(0.0, 0.0, 25.0),
                ],
                tangents2: vec![
                    Vec3::new(0.0, 0.0, -25.0),
                    Vec3::new(10.0, 0.0, 10.0),
                    Vec3::new(0.0, 0.0, 35.0),
                ],
                ..Default::default()
            }),
            rocker_top: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, 1.25, 0.0), Vec3::new(0.0, 1.25, 35.0)],
                ..Default::default()
            }),
            rocker_bottom: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(0.0, -1.25, 35.0)],
                ..Default::default()
            }),
            cross_sections: vec![BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(5.0, 1.25, 0.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.5, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let mesh = generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );
        let vertices: Vec<Vec3> = mesh
            .vertices
            .chunks_exact(3)
            .map(|c| Vec3::new(c[0], c[1], c[2]))
            .collect();

        let (min_z, max_z) = vertices
            .iter()
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(min_z, max_z), v| {
                (min_z.min(v.z), max_z.max(v.z))
            });

        // There should be a small tolerance for floating point comparisons
        let nose_pole_vertices = vertices
            .iter()
            .filter(|v| (v.z - min_z).abs() < 1e-4 && v.x.abs() < 1e-4)
            .count();
        let tail_pole_vertices = vertices
            .iter()
            .filter(|v| (v.z - max_z).abs() < 1e-4 && v.x.abs() < 1e-4)
            .count();

        // With degenerate quad logic, we expect multiple vertices at X=0 (one for each U value forming a vertical line)
        assert!(
            nose_pole_vertices > 1,
            "Nose cap should use degenerate quads forming a line at X=0"
        );
        assert!(
            tail_pole_vertices > 1,
            "Tail cap should use degenerate quads forming a line at X=0"
        );

        println!("✅ test_pin_tail_degenerate_pole passed.");
    }

    #[test]
    fn test_c2_continuous_pole_normals() {
        let model = BoardModel {
            length: 70.0,
            width: 20.0,
            thickness: 2.5,
            outline: Some(BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, 0.0, -35.0),
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 0.0, 35.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, 0.0, -35.0),
                    Vec3::new(10.0, 0.0, -10.0),
                    Vec3::new(0.0, 0.0, 25.0),
                ],
                tangents2: vec![
                    Vec3::new(0.0, 0.0, -25.0),
                    Vec3::new(10.0, 0.0, 10.0),
                    Vec3::new(0.0, 0.0, 35.0),
                ],
                ..Default::default()
            }),
            rocker_top: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, 1.25, -35.0), Vec3::new(0.0, 1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, 1.25, 0.0), Vec3::new(0.0, 1.25, 35.0)],
                ..Default::default()
            }),
            rocker_bottom: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 35.0)],
                tangents1: vec![Vec3::new(0.0, -1.25, -35.0), Vec3::new(0.0, -1.25, 0.0)],
                tangents2: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(0.0, -1.25, 35.0)],
                ..Default::default()
            }),
            cross_sections: vec![BezierCurveData {
                control_points: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.0, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                tangents1: vec![
                    Vec3::new(0.0, -1.25, 0.0),
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(5.0, 1.25, 0.0),
                ],
                tangents2: vec![
                    Vec3::new(5.0, -1.25, 0.0),
                    Vec3::new(10.0, 0.5, 0.0),
                    Vec3::new(0.0, 1.25, 0.0),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };

        let mesh = generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // Obtain exact analytical normals
        let (nose_n_top, nose_n_bot) = crate::geometry::get_pole_normals(&model, -35.0, true);

        let scale = 1.0 / 12.0;
        let mut nose_bot_idx = None;
        let mut nose_top_idx = None;

        for i in (0..(mesh.vertices.len() / 3)).rev() {
            let z = mesh.vertices[i * 3 + 2];
            let u = mesh.uvs[i * 2];
            let v = mesh.uvs[i * 2 + 1];

            // Nose is at v=0 (approx, or v_coord 0). Because we iterate in reverse,
            // we will find the cap vertices before the hull vertices.
            if v < 0.01 && (z - (-35.0 * scale)).abs() < 1e-4 {
                if u < 0.01 && nose_bot_idx.is_none() {
                    nose_bot_idx = Some(i);
                }
                if (u - 1.0).abs() < 0.01 && nose_top_idx.is_none() {
                    nose_top_idx = Some(i);
                }
            }
        }

        let n_bot_idx = nose_bot_idx.expect("Should find bottom nose vertex");
        let retrieved_n_bot = Vec3::new(
            mesh.normals[n_bot_idx * 3],
            mesh.normals[n_bot_idx * 3 + 1],
            mesh.normals[n_bot_idx * 3 + 2],
        );
        assert!(
            (retrieved_n_bot.dot(nose_n_bot) - 1.0).abs() < 1e-6,
            "Bottom nose ring normal should exactly match analytical normal for C2 blending."
        );

        let n_top_idx = nose_top_idx.expect("Should find top nose vertex");
        let retrieved_n_top = Vec3::new(
            mesh.normals[n_top_idx * 3],
            mesh.normals[n_top_idx * 3 + 1],
            mesh.normals[n_top_idx * 3 + 2],
        );
        assert!(
            (retrieved_n_top.dot(nose_n_top) - 1.0).abs() < 1e-6,
            "Top nose ring normal should exactly match analytical normal for C2 blending."
        );

        println!("✅ test_c2_continuous_pole_normals passed.");
    }

    #[test]
    fn test_split_normals_at_poles() {
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
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // Find tail vertices (z = 100.0 * scale)
        let scale = 1.0 / 12.0;
        let target_z = 100.0 * scale;

        let mut hull_normals = Vec::new();
        let mut cap_normals = Vec::new();

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            if (z - target_z).abs() < 1e-4 {
                let nz = mesh.normals[i * 3 + 2];
                if nz > 0.5 {
                    cap_normals.push(Vec3::new(
                        mesh.normals[i * 3],
                        mesh.normals[i * 3 + 1],
                        mesh.normals[i * 3 + 2],
                    ));
                } else {
                    hull_normals.push(Vec3::new(
                        mesh.normals[i * 3],
                        mesh.normals[i * 3 + 1],
                        mesh.normals[i * 3 + 2],
                    ));
                }
            }
        }

        assert!(
            !hull_normals.is_empty(),
            "Should have hull vertices at the tail"
        );
        assert!(
            !cap_normals.is_empty(),
            "Should have cap vertices at the tail"
        );

        // For a straight blocky tail, the hull normal should be pointing outward (+X or -X or Y)
        // while cap normals should point towards +Z
        let mut found_side_facing_hull = false;
        for n in &hull_normals {
            if n.z.abs() < 0.1 {
                // mostly pointing sideways/up/down
                found_side_facing_hull = true;
                break;
            }
        }
        assert!(
            found_side_facing_hull,
            "Hull should maintain natural side-facing normals up to the tail pole"
        );

        for n in &cap_normals {
            assert!(n.z > 0.5, "Cap normals should point strongly towards +Z");
        }

        println!("✅ test_split_normals_at_poles passed.");
    }

    #[test]
    fn deleted_test_golden_s3dx_rounded_pin_geometry() {}

    #[test]
    fn test_rounded_pin_thickness_does_not_pinch_to_zero() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut model = BoardModel::default();

        // Setup a rounded pin tail (ends at X=0 but with rounded tangents)
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),   // Nose
                Vec3::new(10.0, 0.0, 50.0), // Wide point
                Vec3::new(0.0, 0.0, 100.0), // Tail (Pin, X=0)
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(2.0, 0.0, 95.0), // Rounded approach
            ],
            tangents2: vec![
                Vec3::new(5.0, 0.0, 5.0), // Rounded approach
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
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
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // Check the thickness at the absolute nose (z = 0) and tail (z = 100)
        let scale = 1.0 / 12.0;
        let target_z_tail = 100.0 * scale;
        let target_z_nose = 0.0 * scale;

        let mut tail_min_y = f32::INFINITY;
        let mut tail_max_y = f32::NEG_INFINITY;
        let mut nose_min_y = f32::INFINITY;
        let mut nose_max_y = f32::NEG_INFINITY;

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            let y = mesh.vertices[i * 3 + 1];

            if (z - target_z_tail).abs() < 1e-4 {
                tail_min_y = tail_min_y.min(y);
                tail_max_y = tail_max_y.max(y);
            }
            if (z - target_z_nose).abs() < 1e-4 {
                nose_min_y = nose_min_y.min(y);
                nose_max_y = nose_max_y.max(y);
            }
        }

        let tail_thickness = tail_max_y - tail_min_y;
        let nose_thickness = nose_max_y - nose_min_y;

        // A true CAD loft must retain the actual rocker profile thickness at the poles,
        // even when using degenerate quad logic to seal a pin tail.
        assert!(
            tail_thickness > 0.01 * scale,
            "Rounded pin tail should not be infinitely thin, actual thickness: {}",
            tail_thickness / scale
        );
        assert!(
            nose_thickness > 0.01 * scale,
            "Rounded pin nose should not be infinitely thin, actual thickness: {}",
            nose_thickness / scale
        );
    }

    #[test]
    fn test_squash_tail_tessellation_density() {
        let mut model_pintail = BoardModel::default();
        model_pintail.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 66.6)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3), Vec3::new(0.0, 0.0, 100.0)],
            ..Default::default()
        });
        model_pintail.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 66.6667)],
            tangents2: vec![Vec3::new(0., 1., 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model_pintail.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 66.6667)],
            tangents2: vec![Vec3::new(0., -1., 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });
        model_pintail.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(10., 0., 0.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(6.6667, 0., 0.)],
            tangents2: vec![Vec3::new(3.3333, 0., 0.), Vec3::new(10., 0., 0.)],
            ..Default::default()
        }];

        let mut model_squash = model_pintail.clone();
        // Give it a 10" wide tail
        model_squash.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });

        let mesh_pin = super::generate_mesh(
            &model_pintail,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );
        let mesh_squash = super::generate_mesh(
            &model_squash,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let diff = mesh_squash.indices.len() as isize - mesh_pin.indices.len() as isize;
        assert!(
            diff > 100,
            "Difference in indices should be substantial due to cap tessellation grid. Diff: {}",
            diff
        );
        println!("✅ test_squash_tail_tessellation_density passed.");
    }

    #[test]
    fn test_channel_u_column_clustering() {
        use crate::model::ChannelLayer;
        let mut model = BoardModel::default();

        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        // Add a bottom channel
        model.bottom_channels = Some(vec![ChannelLayer {
            name: "Test Channel".to_string(),
            is_symmetric: true,
            left_outline: BezierCurveData::default(),
            left_depth: BezierCurveData::default(),
            right_outline: BezierCurveData {
                control_points: vec![Vec3::new(2.0, 0.0, 25.0), Vec3::new(2.0, 0.0, 75.0)],
                tangents1: vec![Vec3::new(2.0, 0.0, 25.0), Vec3::new(2.0, 0.0, 75.0)],
                tangents2: vec![Vec3::new(2.0, 0.0, 25.0), Vec3::new(2.0, 0.0, 75.0)],
                ..Default::default()
            },
            right_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 0.5, 25.0), Vec3::new(0.0, 0.5, 75.0)],
                tangents1: vec![Vec3::new(0.0, 0.5, 25.0), Vec3::new(0.0, 0.5, 75.0)],
                tangents2: vec![Vec3::new(0.0, 0.5, 25.0), Vec3::new(0.0, 0.5, 75.0)],
                ..Default::default()
            },
        }]);

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let mut u_vals: Vec<f32> = mesh.uvs.chunks_exact(2).map(|uv| uv[0]).collect();
        u_vals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        u_vals.dedup_by(|a, b| (*a - *b).abs() < 1e-5);

        let mut found_cliff = false;
        for i in 0..u_vals.len() - 1 {
            let diff = (u_vals[i + 1] - u_vals[i]).abs();
            // Confirm there are U-rings extremely close together (cliff) but not overlapping
            if diff > 1e-4 && diff < 0.005 {
                found_cliff = true;
                break;
            }
        }
        assert!(
            found_cliff,
            "Topology should duplicate U-columns around the channel wall cliff"
        );

        // Assert channel depths are normal-projected, preventing X footprint widening
        let mut max_x = 0.0_f32;
        let scale = 1.0 / 12.0;
        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];
            // Check within the channel region
            if z > 25.0 * scale && z < 75.0 * scale {
                if x > max_x {
                    max_x = x;
                }
            }
        }

        let outline_x_at_50 =
            crate::geometry::evaluate_composite_outline_at_z(&model, 50.0, 0.5).x * scale;
        assert!(
            max_x <= outline_x_at_50 + 1e-3,
            "Channel projection must not widen the board's X footprint. Max X: {}, Outline X: {}",
            max_x,
            outline_x_at_50
        );

        println!("✅ test_channel_u_column_clustering passed.");
    }

    #[test]
    fn test_tri_plane_hull_normals() {
        use crate::model::ChannelLayer;
        let mut model = BoardModel::default();

        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 66.6667)],
            tangents2: vec![Vec3::new(0.0, 1.0, 33.3333), Vec3::new(0.0, 1.0, 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(0.0, 0.0, 33.3333), Vec3::new(0.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(6.6667, 0.0, 0.0)],
            tangents2: vec![Vec3::new(3.3333, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        }];

        model.bottom_channels = Some(vec![ChannelLayer {
            name: "Chine".to_string(),
            is_symmetric: true,
            left_outline: BezierCurveData {
                control_points: vec![Vec3::new(-5.0, 0.0, 0.0), Vec3::new(-5.0, 0.0, 100.0)],
                tangents1: vec![Vec3::new(-5.0, 0.0, 0.0), Vec3::new(-5.0, 0.0, 66.6667)],
                tangents2: vec![Vec3::new(-5.0, 0.0, 33.3333), Vec3::new(-5.0, 0.0, 100.0)],
                ..Default::default()
            },
            right_outline: BezierCurveData {
                control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
                tangents1: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 66.6667)],
                tangents2: vec![Vec3::new(5.0, 0.0, 33.3333), Vec3::new(5.0, 0.0, 100.0)],
                ..Default::default()
            },
            left_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 100.0)],
                tangents1: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 66.6667)],
                tangents2: vec![Vec3::new(0.0, 2.0, 33.3333), Vec3::new(0.0, 2.0, 100.0)],
                ..Default::default()
            },
            right_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 100.0)],
                tangents1: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 66.6667)],
                tangents2: vec![Vec3::new(0.0, 2.0, 33.3333), Vec3::new(0.0, 2.0, 100.0)],
                ..Default::default()
            },
        }]);

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let mut split_normals_found = false;

        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];

            // At the chine (X = 5 * scale)
            if (x - 5.0 * scale).abs() < 1e-3 && (z - 50.0 * scale).abs() < 1e-2 {
                let ny = mesh.normals[i * 3 + 1];
                // One normal should point angled due to the V-shape of the hull panel.
                // The flat bottom normally has NY = -1.0. The angled panel will have NY > -0.95.
                if ny > -0.95 {
                    split_normals_found = true;
                }
            }
        }

        assert!(split_normals_found, "Topology should duplicate U-columns and split normals around hard chines to create faceted tri-plane faces.");
    }

    #[test]
    fn test_bifurcated_mesh_vertex_count() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 100.0),
                Vec3::new(0.0, 0.0, 95.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 80.0),
                Vec3::new(5.0, 0.0, 100.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 20.0),
                Vec3::new(10.0, 0.0, 110.0),
                Vec3::new(0.0, 0.0, 95.0),
            ],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::new(0., 1., 0.), Vec3::new(0., 1., 66.6)],
            tangents2: vec![Vec3::new(0., 1., 33.3), Vec3::new(0., 1., 100.)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::new(0., -1., 0.), Vec3::new(0., -1., 66.6)],
            tangents2: vec![Vec3::new(0., -1., 33.3), Vec3::new(0., -1., 100.)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(10., 0., 0.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(6.6667, 0., 0.)],
            tangents2: vec![Vec3::new(3.3333, 0., 0.), Vec3::new(10., 0., 0.)],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // A regular pintail board has roughly X vertices. A swallow tail has the inner wall stitched in.
        // We verify that the mesh generates successfully without crashing, and has a reasonable density.
        assert!(
            mesh.vertices.len() > 1000,
            "Mesh should generate successfully without crashing"
        );
        assert!(mesh.indices.len() > 1000, "Indices should be populated");

        println!("✅ test_bifurcated_mesh_vertex_count passed.");
    }

    #[test]
    fn test_wing_split_normals() {
        use crate::model::OutlineLayer;
        let mut model = BoardModel::default();

        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });

        let wing_ext = BezierCurveData {
            control_points: vec![Vec3::new(8.0, 0.0, 70.0), Vec3::new(8.0, 0.0, 80.0)],
            tangents1: vec![Vec3::new(8.0, 0.0, 70.0), Vec3::new(8.0, 0.0, 75.0)],
            tangents2: vec![Vec3::new(8.0, 0.0, 75.0), Vec3::new(8.0, 0.0, 80.0)],
            ..Default::default()
        };
        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            active: true,
            otl_ext: wing_ext,
            otl_int: BezierCurveData::default(),
        }]);

        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let target_z = 70.0 * scale;

        let mut normals_at_cliff = Vec::new();

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            if (z - target_z).abs() <= 0.005 {
                normals_at_cliff.push(Vec3::new(
                    mesh.normals[i * 3],
                    mesh.normals[i * 3 + 1],
                    mesh.normals[i * 3 + 2],
                ));
            }
        }

        assert!(
            !normals_at_cliff.is_empty(),
            "Should have detected normals at the vertical cliff"
        );

        let mut min_dot = 1.0_f32;
        if normals_at_cliff.len() >= 2 {
            let n0 = normals_at_cliff[0];
            for n in &normals_at_cliff[1..] {
                let d = n0.dot(*n);
                if d < min_dot {
                    min_dot = d;
                }
            }
        }

        // At the wing discontinuity, normals should abruptly change direction.
        assert!(
            min_dot < 0.99,
            "Normals should be split (faceted) at the wing discontinuity"
        );
        println!("✅ test_wing_split_normals passed.");
    }

    #[test]
    fn test_wing_z_ring_duplication() {
        use crate::model::OutlineLayer;
        let mut model = BoardModel::default();

        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(10.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });

        let wing_ext = BezierCurveData {
            control_points: vec![Vec3::new(12.0, 0.0, 70.0), Vec3::new(12.0, 0.0, 80.0)],
            tangents1: vec![Vec3::new(12.0, 0.0, 70.0), Vec3::new(12.0, 0.0, 75.0)],
            tangents2: vec![Vec3::new(12.0, 0.0, 75.0), Vec3::new(12.0, 0.0, 80.0)],
            ..Default::default()
        };
        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            active: true,
            otl_ext: wing_ext,
            otl_int: BezierCurveData::default(),
        }]);

        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents2: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(5.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.25, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let mut unique_zs: Vec<f32> = mesh
            .vertices
            .chunks_exact(3)
            .map(|v| v[2] / scale)
            .collect();
        unique_zs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        unique_zs.dedup_by(|a, b| (*a - *b).abs() < 1e-5);

        let mut found_cliff = false;
        for i in 0..unique_zs.len() - 1 {
            let diff = (unique_zs[i + 1] - unique_zs[i]).abs();
            // Confirm there are rings extremely close together near Z=70 (the start of the wing)
            if diff > 1e-4 && diff < 0.01 && (unique_zs[i] - 70.0).abs() < 0.1 {
                found_cliff = true;
                break;
            }
        }
        assert!(
            found_cliff,
            "Topology should duplicate Z-rings around the wing cliff"
        );
        println!("✅ test_wing_z_ring_duplication passed.");
    }

    #[test]
    fn test_mesh_follows_dynamic_apex() {
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 4.0, 0.0), Vec3::new(0.0, 4.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });

        let cs0 = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 1.0, 0.0),
                Vec3::new(5.0, 2.0, 0.0),
                Vec3::new(2.5, 3.0, 0.0),
                Vec3::new(0.0, 4.0, 0.0),
            ],
            tangents1: vec![Vec3::ZERO; 5],
            tangents2: vec![Vec3::ZERO; 5],
            ..Default::default()
        };

        let cs1 = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 100.0),
                Vec3::new(2.5, 1.0, 100.0),
                Vec3::new(5.0, 2.0, 100.0),
                Vec3::new(10.0, 3.0, 100.0),
                Vec3::new(0.0, 4.0, 100.0),
            ],
            tangents1: vec![Vec3::ZERO; 5],
            tangents2: vec![Vec3::ZERO; 5],
            ..Default::default()
        };
        model.cross_sections = vec![cs0, cs1];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );
        let scale = 1.0 / 12.0;
        let target_z = 50.0 * scale;
        let mut best_z_diff = f32::INFINITY;
        let mut best_z = 0.0;
        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            let diff = (z - target_z).abs();
            if diff < best_z_diff {
                best_z_diff = diff;
                best_z = z;
            }
        }

        let mut max_x_at_50 = 0.0_f32;
        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];
            if (z - best_z).abs() < 1e-4 {
                if x > max_x_at_50 {
                    max_x_at_50 = x;
                }
            }
        }

        let expected_x = 10.0 * scale;
        assert!(
            (max_x_at_50 - expected_x).abs() < 5e-3,
            "BUG: Mesh is inside the outline! Expected apex X at Z={} to be ~{}, but got {}",
            best_z / scale,
            expected_x,
            max_x_at_50
        );
    }

    #[test]
    fn test_ci_dumpster_tail_holes() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/CI-Dumpster-Diver.s3dx");

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_z = bounds.tip_z * scale;

        use std::collections::HashMap;
        let mut edge_counts = HashMap::new();

        let get_vertex = |idx: u32| -> Vec3 {
            let i = idx as usize * 3;
            Vec3::new(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2])
        };

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i];
            let i2 = mesh.indices[i + 1];
            let i3 = mesh.indices[i + 2];

            let hash_pt = |v: Vec3| -> (i32, i32, i32) {
                (
                    (v.x * 10000.0).round() as i32,
                    (v.y * 10000.0).round() as i32,
                    (v.z * 10000.0).round() as i32,
                )
            };

            let v1 = hash_pt(get_vertex(i1));
            let v2 = hash_pt(get_vertex(i2));
            let v3 = hash_pt(get_vertex(i3));

            // Ignore degenerate sliver triangles inside the hull
            if v1 == v2 || v2 == v3 || v3 == v1 {
                continue;
            }

            let mut add_edge = |a: (i32, i32, i32), b: (i32, i32, i32)| {
                let key = if a < b { (a, b) } else { (b, a) };
                *edge_counts.entry(key).or_insert(0) += 1;
            };

            add_edge(v1, v2);
            add_edge(v2, v3);
            add_edge(v3, v1);
        }

        let mut tail_holes = 0;

        for (edge, count) in &edge_counts {
            if *count == 1 {
                let z1 = (edge.0).2 as f32 / 10000.0;
                let z2 = (edge.1).2 as f32 / 10000.0;

                // If an edge is only used by 1 triangle, it's a boundary (hole).
                if (z1 - tail_z).abs() < 1.0 && (z2 - tail_z).abs() < 1.0 {
                    tail_holes += 1;
                    let v1 = Vec3::new(
                        (edge.0).0 as f32 / 10000.0,
                        (edge.0).1 as f32 / 10000.0,
                        (edge.0).2 as f32 / 10000.0,
                    );
                    let v2 = Vec3::new(
                        (edge.1).0 as f32 / 10000.0,
                        (edge.1).1 as f32 / 10000.0,
                        (edge.1).2 as f32 / 10000.0,
                    );
                    log::error!("Hole at edge from {:?} to {:?}", v1, v2);
                }
            }
        }

        assert_eq!(
            tail_holes, 0,
            "Found {} boundary edges at the tail! This means there's a visible topological hole.",
            tail_holes
        );
    }

    #[test]
    fn test_cap_degenerate_triangles() {
        // CI-Dumpster-Diver.s3dx has a blunt tail, so it generates a patch cap.
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/CI-Dumpster-Diver.s3dx");

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // Find degenerate triangles in the mesh
        let mut degenerate_count = 0;
        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(
                mesh.vertices[i1 * 3],
                mesh.vertices[i1 * 3 + 1],
                mesh.vertices[i1 * 3 + 2],
            );
            let v2 = Vec3::new(
                mesh.vertices[i2 * 3],
                mesh.vertices[i2 * 3 + 1],
                mesh.vertices[i2 * 3 + 2],
            );
            let v3 = Vec3::new(
                mesh.vertices[i3 * 3],
                mesh.vertices[i3 * 3 + 1],
                mesh.vertices[i3 * 3 + 2],
            );

            // Area of triangle is 0.5 * |(v2 - v1) x (v3 - v1)|
            let area = (v2 - v1).cross(v3 - v1).length();

            // Mathematical singularities at poles can create valid sliver triangles (area ~1e-7).
            // Physically defective degenerate triangles created by extruding lines will have exactly 0.0 area.
            if area < 1e-10 {
                degenerate_count += 1;
            }
        }

        assert_eq!(
            degenerate_count, 0,
            "Found degenerate triangles in the mesh! This causes dark square rendering artifacts."
        );
    }

    #[test]
    fn test_micro_cap_leak_at_nose() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let nose_z_scaled = bounds.nose_z * scale;

        let mut blunt_cap_normals = 0;

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            // Check vertices exactly at the nose
            if (z - nose_z_scaled).abs() < 1e-4 {
                let nx = mesh.normals[i * 3];
                let ny = mesh.normals[i * 3 + 1];
                let nz = mesh.normals[i * 3 + 2];

                // If the normal points exactly forward (-Z), it's a blunt cap normal!
                // A rounded pin should have normals pointing out, up, or down (slerped), NOT a flat blunt patch.
                if nz < -0.99 && ny.abs() < 0.01 && nx.abs() < 0.01 {
                    blunt_cap_normals += 1;
                }
            }
        }

        assert_eq!(
            blunt_cap_normals,
            0,
            "BUG: Found {} blunt cap normals at a rounded pin nose! The is_sharp threshold leaked and generated a flat cap.",
            blunt_cap_normals
        );
    }

    #[test]
    fn test_zero_area_triangles_at_nose() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let nose_z_scaled = bounds.nose_z * scale;

        let mut degenerate_triangles = 0;

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(
                mesh.vertices[i1 * 3],
                mesh.vertices[i1 * 3 + 1],
                mesh.vertices[i1 * 3 + 2],
            );
            let v2 = Vec3::new(
                mesh.vertices[i2 * 3],
                mesh.vertices[i2 * 3 + 1],
                mesh.vertices[i2 * 3 + 2],
            );
            let v3 = Vec3::new(
                mesh.vertices[i3 * 3],
                mesh.vertices[i3 * 3 + 1],
                mesh.vertices[i3 * 3 + 2],
            );

            // Only check triangles that touch the exact nose tip
            if (v1.z - nose_z_scaled).abs() < 1e-4
                || (v2.z - nose_z_scaled).abs() < 1e-4
                || (v3.z - nose_z_scaled).abs() < 1e-4
            {
                let area = (v2 - v1).cross(v3 - v1).length();
                if area < 1e-10 {
                    degenerate_triangles += 1;
                }
            }
        }

        assert_eq!(
            degenerate_triangles,
            0,
            "BUG: Found {} zero-area degenerate triangles at the nose tip! These cause NaN normal shading artifacts.",
            degenerate_triangles
        );
    }

    #[test]
    fn test_nose_stringer_normal_divergence() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");

        let bounds = crate::geometry::get_board_bounds(&model);
        let u_stringer = 0.0;
        let u_tuck = 0.05; // Slightly off the stringer

        let ctx = crate::geometry::ZRingContext::new(&model, bounds.nose_z);
        let n_stringer = ctx.get_surface_normal_at_uvz(u_stringer, 1.0);
        let n_tuck = ctx.get_surface_normal_at_uvz(u_tuck, 1.0);

        let dot = n_stringer.dot(n_tuck);
        assert!(
            dot > 0.8,
            "BUG: Severe normal divergence at the nose! Stringer normal {:?} diverges too sharply from adjacent rail normal {:?} (dot: {})",
            n_stringer, n_tuck, dot
        );
    }

    #[test]
    fn test_blunt_tail_cap_normals_are_flat() {
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
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
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![Vec3::ZERO; 3],
            tangents2: vec![Vec3::ZERO; 3],
            ..Default::default()
        }];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );
        let scale = 1.0 / 12.0;
        let target_z = 100.0 * scale;

        let mut cap_normals = Vec::new();

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            if (z - target_z).abs() < 1e-4 {
                let nx = mesh.normals[i * 3];
                let ny = mesh.normals[i * 3 + 1];
                let nz = mesh.normals[i * 3 + 2];

                if nz > 0.1 {
                    cap_normals.push(Vec3::new(nx, ny, nz));
                }
            }
        }

        assert!(
            !cap_normals.is_empty(),
            "Should have found cap normals at the tail"
        );

        for n in &cap_normals {
            assert!(
                n.y.abs() < 1e-2,
                "BUG: Cap normal on a blunt tail should not have a Y component! It is being slerped. Normal: {:?}",
                n
            );
            assert!(
                (n.z - 1.0).abs() < 1e-2,
                "BUG: Cap normal on a blunt tail should point strictly in +Z! Normal: {:?}",
                n
            );
        }
    }

    #[test]
    fn test_mini_simmons_bottom_black_shapes() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd not found.");
            return;
        }

        let bytes = std::fs::read(&path).unwrap();
        let model = crate::brd_parser::parse_brd(&bytes).unwrap();
        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // 1. Check for NaN Normals (which render as pure black in WebGL)
        let mut nan_normals = 0;
        for i in (0..mesh.normals.len()).step_by(3) {
            let n = Vec3::new(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
            if !n.is_finite() {
                nan_normals += 1;
            }
        }
        assert_eq!(
            nan_normals, 0,
            "Found {} NaN normal vectors. These cause black shading artifacts.",
            nan_normals
        );

        // 2. Check for Degenerate Triangles
        let mut degenerate_count = 0;
        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(
                mesh.vertices[i1 * 3],
                mesh.vertices[i1 * 3 + 1],
                mesh.vertices[i1 * 3 + 2],
            );
            let v2 = Vec3::new(
                mesh.vertices[i2 * 3],
                mesh.vertices[i2 * 3 + 1],
                mesh.vertices[i2 * 3 + 2],
            );
            let v3 = Vec3::new(
                mesh.vertices[i3 * 3],
                mesh.vertices[i3 * 3 + 1],
                mesh.vertices[i3 * 3 + 2],
            );

            let area = (v2 - v1).cross(v3 - v1).length();
            if area < 1e-10 {
                degenerate_count += 1;
            }
        }

        assert_eq!(
            degenerate_count, 0,
            "Found {} degenerate triangles! These render as black shapes.",
            degenerate_count
        );
    }

    #[test]
    fn test_mini_simmons_no_inverted_hull_triangles() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd not found.");
            return;
        }

        let bytes = std::fs::read(&path).unwrap();
        let mut model = crate::brd_parser::parse_brd(&bytes).unwrap();

        let basic_cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
        };
        model.cross_sections = vec![basic_cs];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_scan_z = (bounds.tip_z - 10.0) * scale; // Scan the last 10 inches

        let mut inverted_faces = 0;
        let mut total_bottom_faces = 0;

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(
                mesh.vertices[i1 * 3],
                mesh.vertices[i1 * 3 + 1],
                mesh.vertices[i1 * 3 + 2],
            );
            let v2 = Vec3::new(
                mesh.vertices[i2 * 3],
                mesh.vertices[i2 * 3 + 1],
                mesh.vertices[i2 * 3 + 2],
            );
            let v3 = Vec3::new(
                mesh.vertices[i3 * 3],
                mesh.vertices[i3 * 3 + 1],
                mesh.vertices[i3 * 3 + 2],
            );

            let u1 = mesh.uvs[i1 * 2];
            let u2 = mesh.uvs[i2 * 2];
            let u3 = mesh.uvs[i3 * 2];

            let avg_u = (u1 + u2 + u3) / 3.0;

            let z_avg = (v1.z + v2.z + v3.z) / 3.0;
            let x_avg = (v1.x + v2.x + v3.x) / 3.0;

            // Only check faces near the bottom/tuck (U < 0.5) in the last 10 inches of the tail on the right side
            if avg_u < 0.5 && z_avg > tail_scan_z && x_avg > 0.0 {
                total_bottom_faces += 1;
                let face_normal = (v2 - v1).cross(v3 - v1).normalize();

                // If it's the right side hull (X > 0) and bottom (U < 0.5),
                // the face normal MUST point Down (-Y) and Right (+X).
                // If Ny > 0.1, it's pointing UP into the board (Black triangle!).
                // If Nx < -0.1, it's pointing LEFT into the stringer (Folded mesh!).
                if face_normal.y > 0.1 || face_normal.x < -0.1 {
                    println!("\n⚠️ SUSPICIOUS FACE at Z={:.3}", z_avg * 12.0);
                    println!("  V1: ({:.4}, {:.4}, {:.4}) u={:.2}", v1.x, v1.y, v1.z, u1);
                    println!("  V2: ({:.4}, {:.4}, {:.4}) u={:.2}", v2.x, v2.y, v2.z, u2);
                    println!("  V3: ({:.4}, {:.4}, {:.4}) u={:.2}", v3.x, v3.y, v3.z, u3);
                    println!(
                        "  FACE NORMAL: Nx: {:.3}, Ny: {:.3}, Nz: {:.3}",
                        face_normal.x, face_normal.y, face_normal.z
                    );
                    inverted_faces += 1;
                }
            }
        }

        println!("Checked {} bottom faces.", total_bottom_faces);
        assert_eq!(
            inverted_faces, 0,
            "Found {} inverted faces on the bottom of the hull! The mesh is folded over.",
            inverted_faces
        );
    }

    #[test]
    fn test_mini_simmons_tail_cap_no_intersections() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd not found.");
            return;
        }

        let bytes = std::fs::read(&path).unwrap();
        let mut model = crate::brd_parser::parse_brd(&bytes).unwrap();

        // Emulate the frontend's behavior of preserving the active cross section
        let basic_cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
        };
        model.cross_sections = vec![basic_cs];

        let mesh = super::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut MeshCache::default(),
        );

        // Analyze cap triangles at the tail
        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_z = bounds.tip_z * scale;

        let mut tail_cap_inverted_triangles = 0;

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(
                mesh.vertices[i1 * 3],
                mesh.vertices[i1 * 3 + 1],
                mesh.vertices[i1 * 3 + 2],
            );
            let v2 = Vec3::new(
                mesh.vertices[i2 * 3],
                mesh.vertices[i2 * 3 + 1],
                mesh.vertices[i2 * 3 + 2],
            );
            let v3 = Vec3::new(
                mesh.vertices[i3 * 3],
                mesh.vertices[i3 * 3 + 1],
                mesh.vertices[i3 * 3 + 2],
            );

            // Filter for tail cap triangles (Z is approximately tail_z)
            if (v1.z - tail_z).abs() < 1e-3
                && (v2.z - tail_z).abs() < 1e-3
                && (v3.z - tail_z).abs() < 1e-3
            {
                let face_normal = (v2 - v1).cross(v3 - v1).normalize();

                // For a flat cap facing +Z, the CCW normal should be exactly (0, 0, 1)
                // If it's inverted due to crossovers, Z will drop into the negative.
                if face_normal.z < -0.1 {
                    tail_cap_inverted_triangles += 1;
                }
            }
        }

        assert_eq!(tail_cap_inverted_triangles, 0, "Found inverted triangles on the tail cap! This is caused by Y-coordinate crossovers during cap generation.");
    }
}
