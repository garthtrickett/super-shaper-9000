use glam::Vec3;
use crate::model::{BoardModel, RawGeometryData};
use crate::geometry::*;

pub fn generate_mesh(model: &BoardModel) -> RawGeometryData {
    let scale = 1.0 / 12.0;

    let (bound_nose_z, bound_tail_z) = crate::geometry::get_board_bounds(model);

    let outline = match &model.outline {
        Some(o) => o,
        None => return RawGeometryData::default(),
    };
    if outline.control_points.is_empty() {
        return RawGeometryData::default();
    }

    let nose_pt = evaluate_curve(outline, 0.0);
    let nose_z = nose_pt.z;

    let mut tip_z = f32::NEG_INFINITY;
    let mut v_tip = 1.0;
    let steps = 50;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(outline, t);
        if p.z > tip_z {
            tip_z = p.z;
            v_tip = t;
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
        
        let mesh = generate_mesh(&model);
        
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
                    cap_normals.push(Vec3::new(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]));
                } else {
                    hull_normals.push(Vec3::new(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]));
                }
            }
        }
        
        assert!(!hull_normals.is_empty(), "Should have hull vertices at the tail");
        assert!(!cap_normals.is_empty(), "Should have cap vertices at the tail");
        
        // For a straight blocky tail, the hull normal should be pointing outward (+X or -X or Y)
        // while cap normals should point towards +Z
        let mut found_side_facing_hull = false;
        for n in &hull_normals {
            if n.z.abs() < 0.1 { // mostly pointing sideways/up/down
                found_side_facing_hull = true;
                break;
            }
        }
        assert!(found_side_facing_hull, "Hull should maintain natural side-facing normals up to the tail pole");
        
        for n in &cap_normals {
            assert!(n.z > 0.9, "Cap normals should point strongly towards +Z");
        }
        
                println!("✅ test_split_normals_at_poles passed.");
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
            control_points: vec![Vec3::ZERO, Vec3::new(10.,0.,0.)], 
            tangents1: vec![Vec3::ZERO, Vec3::new(6.6667,0.,0.)], 
            tangents2: vec![Vec3::new(3.3333,0.,0.), Vec3::new(10.,0.,0.)],
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

        let mesh_pin = generate_mesh(&model_pintail);
        let mesh_squash = generate_mesh(&model_squash);

        let diff = mesh_squash.indices.len() as isize - mesh_pin.indices.len() as isize;
        assert!(diff > 100, "Difference in indices should be substantial due to cap tessellation grid. Diff: {}", diff);
        println!("✅ test_squash_tail_tessellation_density passed.");
    }
}

    // Adaptive Lengthwise (V) Slicing
    let mut all_z = Vec::new();
    let tolerance_degrees = 3.0;
    let min_dist = 0.5;

    if let Some(r_top) = &model.rocker_top {
        for t in crate::bezier::adaptive_sample_t(r_top, tolerance_degrees, min_dist) {
            all_z.push(evaluate_curve(r_top, t).z);
        }
    }
    if let Some(r_bot) = &model.rocker_bottom {
        for t in crate::bezier::adaptive_sample_t(r_bot, tolerance_degrees, min_dist) {
            all_z.push(evaluate_curve(r_bot, t).z);
        }
    }
    for t in crate::bezier::adaptive_sample_t(outline, tolerance_degrees, min_dist) {
        all_z.push(evaluate_curve(outline, t).z);
    }
    
    all_z.push(nose_z);
    all_z.push(tip_z);
    all_z.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut z_rings = Vec::new();
    for z in all_z {
        let clamped = z.clamp(nose_z, tip_z);
        if z_rings.is_empty() || clamped - z_rings.last().unwrap() > 0.1 {
            z_rings.push(clamped);
        }
    }
    
    if let Some(last) = z_rings.last_mut() {
        if (tip_z - *last).abs() > 1e-4 {
            if tip_z - *last <= 0.1 {
                *last = tip_z;
            } else {
                z_rings.push(tip_z);
            }
        }
    }

    let segments_v = z_rings.len() - 1;

    // Adaptive Crosswise (U) Columns
    let mut base_u = Vec::new();
    let tolerance_degrees_u = 3.0;
    let min_dist_u = 0.05;
    for cs in &model.cross_sections {
        for t in crate::bezier::adaptive_sample_t(cs, tolerance_degrees_u, min_dist_u) {
            base_u.push(t);
        }
    }
    base_u.push(0.0);
    base_u.push(1.0);
    base_u.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut u_params_half = Vec::new();
    for u in base_u {
        if u_params_half.is_empty() || u - u_params_half.last().unwrap() > 0.01 {
            u_params_half.push(u);
        }
    }

    let mut u_columns = Vec::new();
    let half = u_params_half.len() - 1;
    for (idx, &u) in u_params_half.iter().enumerate() {
        let is_stringer = idx == 0 || idx == half;
        u_columns.push((u, 1.0, is_stringer)); // Right side
    }
    // Add left side, skipping the center stringer to avoid duplication
    for (idx, &u) in u_params_half.iter().rev().skip(1).enumerate() {
        let is_stringer = idx == (half - 1);
        u_columns.push((u, -1.0, is_stringer)); // Left side
    }
    let num_cols = u_columns.len();
    let right_half_cols = u_params_half.len();

    let mut slice_arc_lengths = vec![0.0; segments_v + 1];
    let mut total_arc_length = 0.0;
    let mut last_center_pos = Vec3::ZERO;

    for i in 0..=segments_v {
        let z_inches = z_rings[i];
        let v_outer = crate::geometry::find_v_at_z(outline, z_inches, 0.0, v_tip);
        let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, v_outer);
        let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, v_outer);
        let cy = (top_pt.y + bot_pt.y) / 2.0;
        
        let current_center_pos = Vec3::new(0.0, cy * scale, z_inches * scale);
        if i > 0 {
            total_arc_length += current_center_pos.distance(last_center_pos);
        }
        slice_arc_lengths[i] = total_arc_length;
        last_center_pos = current_center_pos;
    }

    let mut vertices = Vec::new();
    let mut colors = Vec::new();
    let mut uvs = Vec::new();
    let mut grid = Vec::new();

    let nose_width = evaluate_composite_outline_at_z(model, nose_z, 0.0).x;

    for i in 0..=segments_v {
        let mut ring = Vec::new();
        let z_inches = z_rings[i];
        let v_coord = slice_arc_lengths[i] / total_arc_length;
        let v_outer = crate::geometry::find_v_at_z(outline, z_inches, 0.0, v_tip);
        let fade_factor = crate::geometry::calculate_tip_fade(z_inches, bound_nose_z, bound_tail_z);
        
        let inner_x = 0.0; // Simplify for now

        let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, v_outer);
        let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, v_outer);
        let local_thickness = 0.0_f32.max(top_pt.y - bot_pt.y);
        let heat_color = color_heatmap(0.0_f32.max(1.0_f32.min(local_thickness / model.thickness)));

        for j in 0..num_cols {
            let (u_val, side, is_stringer) = u_columns[j];
            let mut point = get_point_at_uv(model, u_val, v_outer, z_inches, inner_x, fade_factor);
            if is_stringer { point.x = inner_x; }
            point.x *= side;

            if i == 0 && nose_width < 1e-3 { point.x = 0.0; }

            ring.push((Vec3::new(point.x * scale, point.y * scale, point.z * scale), heat_color, u_val, v_coord));
        }
        grid.push(ring);
    }

        let (nose_n_top, nose_n_bot) = crate::geometry::get_pole_normals(model, nose_z, true);
    let (tail_n_top, tail_n_bot) = crate::geometry::get_pole_normals(model, tip_z, false);

    let mut normals = Vec::new();
    for i in 0..=segments_v {
        for j in 0..num_cols {
            let (pos, color, u, v) = grid[i][j];
            vertices.push(pos.x); vertices.push(pos.y); vertices.push(pos.z);
            colors.push(color.x); colors.push(color.y); colors.push(color.z);
            uvs.push(u); uvs.push(v);

                        let tangent_v = if i == 0 {
                grid[i + 1][j].0 - grid[i][j].0
            } else if i == segments_v {
                grid[i][j].0 - grid[i - 1][j].0
            } else {
                grid[i + 1][j].0 - grid[i - 1][j].0
            };

            let tangent_u = if j == 0 {
                grid[i][1].0 - grid[i][0].0
            } else if j == right_half_cols - 1 {
                grid[i][j].0 - grid[i][j - 1].0
            } else if j == right_half_cols {
                grid[i][j + 1].0 - grid[i][j].0
            } else if j == num_cols - 1 {
                grid[i][j].0 - grid[i][j - 1].0
            } else {
                grid[i][j + 1].0 - grid[i][j - 1].0
            };

            let mut n = tangent_u.cross(tangent_v).normalize();
            if n.is_nan() || n.length_squared() < 0.0001 {
                n = Vec3::new(0.0, if u_columns[j].0 > 0.5 { 1.0 } else { -1.0 }, 0.0);
            }

            normals.push(n.x); normals.push(n.y); normals.push(n.z);
        }
    }

    let mut indices = Vec::new();
    for i in 0..segments_v {
        for j in 0..num_cols - 1 {
            let a = (i * num_cols + j) as u32;
            let b = a + 1;
            let c = ((i + 1) * num_cols + j) as u32;
            let d = c + 1;
            
            indices.push(a); indices.push(b); indices.push(d);
            indices.push(a); indices.push(d); indices.push(c);
        }
    }

                                                                                                // Prepare Centerline Arrays and Stitch Caps for B-Rep Surface Patches
    let mut generate_cap = |ring_index: usize, z_inches: f32, n_top: Vec3, n_bot: Vec3, fallback_mid: Vec3, is_nose: bool, vertices: &mut Vec<f32>, uvs: &mut Vec<f32>, colors: &mut Vec<f32>, normals: &mut Vec<f32>, indices: &mut Vec<u32>| {
        let width = crate::geometry::evaluate_composite_outline_at_z(model, z_inches, if is_nose { 0.0 } else { 1.0 }).x;
        let num_x_steps = (width / 0.5).ceil().max(1.0) as u32;
        let start_vertex_index = (vertices.len() / 3) as u32;

        let ring = &grid[ring_index];

        for step in 0..=num_x_steps {
            let fraction = 1.0 - (step as f32 / num_x_steps as f32);
            for j in 0..num_cols {
                let (pos, color, u, v) = ring[j];
                vertices.push(pos.x * fraction);
                vertices.push(pos.y);
                vertices.push(pos.z);
                
                uvs.push(u);
                uvs.push(v);
                
                colors.push(color.x);
                colors.push(color.y);
                colors.push(color.z);
                
                let blended_normal = crate::geometry::slerp_normals(n_bot, n_top, u, fallback_mid);
                normals.push(blended_normal.x);
                normals.push(blended_normal.y);
                normals.push(blended_normal.z);
            }
        }

        for step in 0..num_x_steps {
            let ring_a_start = start_vertex_index + step * (num_cols as u32);
            let ring_b_start = start_vertex_index + (step + 1) * (num_cols as u32);
            
            for j in 0..num_cols - 1 {
                let a = ring_a_start + j as u32;
                let b = a + 1;
                let c = ring_b_start + j as u32;
                let d = c + 1;
                
                if is_nose {
                    indices.push(a); indices.push(d); indices.push(b);
                    indices.push(a); indices.push(c); indices.push(d);
                } else {
                    indices.push(a); indices.push(b); indices.push(d);
                    indices.push(a); indices.push(d); indices.push(c);
                }
            }
        }
    };

    // --- Cap Generation ---
    generate_cap(0, nose_z, nose_n_top, nose_n_bot, Vec3::new(0.0, 0.0, -1.0), true, &mut vertices, &mut uvs, &mut colors, &mut normals, &mut indices);
    generate_cap(segments_v, tip_z, tail_n_top, tail_n_bot, Vec3::new(0.0, 0.0, 1.0), false, &mut vertices, &mut uvs, &mut colors, &mut normals, &mut indices);

    RawGeometryData {
        vertices,
        indices,
        uvs,
        colors,
        normals,
                volume_liters: 30.5,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;
    use crate::model::BezierCurveData;

    #[test]
    fn test_patch_caps_avoid_poles() {
        // This test verifies that the nose and tail caps are generated
        // as a "patch" (a vertical line of vertices) instead of a "pole"
        // (a single vertex), which prevents shading artifacts.
        let model = BoardModel {
            length: 70.0,
            width: 20.0,
            thickness: 2.5,
            outline: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, 0.0, -35.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 35.0)],
                tangents1: vec![Vec3::new(0.0, 0.0, -35.0), Vec3::new(10.0, 0.0, -10.0), Vec3::new(0.0, 0.0, 25.0)],
                tangents2: vec![Vec3::new(0.0, 0.0, -25.0), Vec3::new(10.0, 0.0, 10.0), Vec3::new(0.0, 0.0, 35.0)],
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
                control_points: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 1.25, 0.0)],
                tangents1: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(5.0, -1.25, 0.0), Vec3::new(5.0, 1.25, 0.0)],
                tangents2: vec![Vec3::new(5.0, -1.25, 0.0), Vec3::new(10.0, 0.5, 0.0), Vec3::new(0.0, 1.25, 0.0)],
                ..Default::default()
            }],
            ..Default::default()
        };
        
        let mesh = generate_mesh(&model);
        let vertices: Vec<Vec3> = mesh.vertices.chunks_exact(3).map(|c| Vec3::new(c[0], c[1], c[2])).collect();

        let (min_z, max_z) = vertices.iter().fold((f32::INFINITY, f32::NEG_INFINITY), |(min_z, max_z), v| {
            (min_z.min(v.z), max_z.max(v.z))
        });
        
        // There should be a small tolerance for floating point comparisons
        let nose_pole_vertices = vertices.iter().filter(|v| (v.z - min_z).abs() < 1e-4 && v.x.abs() < 1e-4).count();
        let tail_pole_vertices = vertices.iter().filter(|v| (v.z - max_z).abs() < 1e-4 && v.x.abs() < 1e-4).count();

        // With a patch, there should be a vertical line of vertices at the centerline (x=0) for the nose and tail.
        // A single vertex would indicate a triangle fan "pole". We expect at least 2 for a line.
                assert!(nose_pole_vertices > 1, "Nose cap should be a patch (multiple vertices at x=0), not a single pole vertex.");
        assert!(tail_pole_vertices > 1, "Tail cap should be a patch (multiple vertices at x=0), not a single pole vertex.");
        
        println!("✅ test_patch_caps_avoid_poles passed.");
    }

    #[test]
    fn test_c2_continuous_pole_normals() {
        let model = BoardModel {
            length: 70.0,
            width: 20.0,
            thickness: 2.5,
            outline: Some(BezierCurveData {
                control_points: vec![Vec3::new(0.0, 0.0, -35.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 35.0)],
                tangents1: vec![Vec3::new(0.0, 0.0, -35.0), Vec3::new(10.0, 0.0, -10.0), Vec3::new(0.0, 0.0, 25.0)],
                tangents2: vec![Vec3::new(0.0, 0.0, -25.0), Vec3::new(10.0, 0.0, 10.0), Vec3::new(0.0, 0.0, 35.0)],
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
                control_points: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 1.25, 0.0)],
                tangents1: vec![Vec3::new(0.0, -1.25, 0.0), Vec3::new(5.0, -1.25, 0.0), Vec3::new(5.0, 1.25, 0.0)],
                tangents2: vec![Vec3::new(5.0, -1.25, 0.0), Vec3::new(10.0, 0.5, 0.0), Vec3::new(0.0, 1.25, 0.0)],
                ..Default::default()
            }],
            ..Default::default()
        };

        let mesh = generate_mesh(&model);

        // Obtain exact analytical normals
        let (nose_n_top, nose_n_bot) = crate::geometry::get_pole_normals(&model, -35.0, true);
        
        let scale = 1.0 / 12.0;
                let mut nose_bot_idx = None;
        let mut nose_top_idx = None;
        
        for i in (0..(mesh.vertices.len() / 3)).rev() {
            let z = mesh.vertices[i * 3 + 2];
            let u = mesh.uvs[i * 2];
            let v = mesh.uvs[i * 2 + 1];
            let nz = mesh.normals[i * 3 + 2];
            
            // Nose is at v=0 (approx, or v_coord 0) and normal z is negative for the cap
            if v < 0.01 && (z - (-35.0 * scale)).abs() < 1e-4 && nz < -0.5 {
                if u < 0.01 { nose_bot_idx = Some(i); }
                if (u - 1.0).abs() < 0.01 { nose_top_idx = Some(i); }
            }
        }
        
        let n_bot_idx = nose_bot_idx.expect("Should find bottom nose vertex");
        let retrieved_n_bot = Vec3::new(mesh.normals[n_bot_idx * 3], mesh.normals[n_bot_idx * 3 + 1], mesh.normals[n_bot_idx * 3 + 2]);
        assert!((retrieved_n_bot.dot(nose_n_bot) - 1.0).abs() < 1e-4, "Bottom nose ring normal should exactly match analytical normal for C2 blending.");

        let n_top_idx = nose_top_idx.expect("Should find top nose vertex");
        let retrieved_n_top = Vec3::new(mesh.normals[n_top_idx * 3], mesh.normals[n_top_idx * 3 + 1], mesh.normals[n_top_idx * 3 + 2]);
        assert!((retrieved_n_top.dot(nose_n_top) - 1.0).abs() < 1e-4, "Top nose ring normal should exactly match analytical normal for C2 blending.");
        
        println!("✅ test_c2_continuous_pole_normals passed.");
    }
}
