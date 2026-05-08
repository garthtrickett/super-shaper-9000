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

    let mut normals = Vec::new();
    for i in 0..=segments_v {
        for j in 0..num_cols {
            let (pos, color, u, v) = grid[i][j];
            vertices.push(pos.x); vertices.push(pos.y); vertices.push(pos.z);
            colors.push(color.x); colors.push(color.y); colors.push(color.z);
            uvs.push(u); uvs.push(v);

            let tangent_v = if i == 0 {
                grid[1][j].0 - grid[0][j].0
            } else if i == segments_v {
                grid[segments_v][j].0 - grid[segments_v - 1][j].0
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
                if i == 0 { n = Vec3::new(0.0, 0.0, -1.0); }
                else if i == segments_v { n = Vec3::new(0.0, 0.0, 1.0); }
                else { n = Vec3::new(0.0, if u_columns[j].0 > 0.5 { 1.0 } else { -1.0 }, 0.0); }
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
    let mut add_patch_centerline = |ring_index: usize, n_top: Vec3, n_bot: Vec3, fallback_mid: Vec3| -> u32 {
        let start_idx = (vertices.len() / 3) as u32;
        let ring = &grid[ring_index];
        
        for j in 0..right_half_cols {
            let (pos, color, _u, _v) = ring[j];
            let v_interp = j as f32 / (right_half_cols - 1) as f32;
            
            vertices.push(0.0);
            vertices.push(pos.y);
            vertices.push(pos.z);
            
            uvs.push(0.5);
            uvs.push(v_interp);
            
            colors.push(color.x);
            colors.push(color.y);
            colors.push(color.z);
            
            let blended_normal = crate::geometry::slerp_normals(n_bot, n_top, v_interp, fallback_mid);
            
            normals.push(blended_normal.x);
            normals.push(blended_normal.y);
            normals.push(blended_normal.z);
        }
        start_idx
    };

    let (nose_n_top, nose_n_bot) = crate::geometry::get_pole_normals(model, nose_z, true);
    // --- Cap Generation (Nose) ---
    let nose_centerline_start = add_patch_centerline(0, nose_n_top, nose_n_bot, Vec3::new(0.0, 0.0, -1.0));
    let nose_ring_start = 0 as u32;

    // Right side of nose
    for j in 0..right_half_cols - 1 {
        let a = nose_ring_start + j as u32;
        let b = a + 1;
        let c = nose_centerline_start + j as u32;
        let d = c + 1;
        // Reversed winding for nose (faces -Z)
        indices.push(a); indices.push(d); indices.push(b);
        indices.push(a); indices.push(c); indices.push(d);
    }

    // Left side of nose
    for k in 0..right_half_cols - 1 {
        let a = nose_ring_start + (num_cols - 1 - k) as u32;
        let b = nose_ring_start + (num_cols - 1 - (k + 1)) as u32;
        let c = nose_centerline_start + k as u32;
        let d = c + 1;
        // Reversed winding for nose
        indices.push(a); indices.push(d); indices.push(b);
        indices.push(a); indices.push(c); indices.push(d);
    }

        let (tail_n_top, tail_n_bot) = crate::geometry::get_pole_normals(model, tip_z, false);
    // --- Cap Generation (Tail) ---
    let tail_centerline_start = add_patch_centerline(segments_v, tail_n_top, tail_n_bot, Vec3::new(0.0, 0.0, 1.0));
    let tail_ring_start = (segments_v * num_cols) as u32;

    // Right side of tail
    for j in 0..right_half_cols - 1 {
        let a = tail_ring_start + j as u32;
        let b = a + 1;
        let c = tail_centerline_start + j as u32;
        let d = c + 1;
        indices.push(a); indices.push(b); indices.push(d);
        indices.push(a); indices.push(d); indices.push(c);
    }

    // Left side of tail
    for k in 0..right_half_cols - 1 {
        let a = tail_ring_start + (num_cols - 1 - k) as u32;
        let b = tail_ring_start + (num_cols - 1 - (k + 1)) as u32;
        let c = tail_centerline_start + k as u32;
        let d = c + 1;
        indices.push(a); indices.push(b); indices.push(d);
        indices.push(a); indices.push(d); indices.push(c);
    }

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
}
