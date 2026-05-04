use glam::Vec3;
use crate::model::{BoardModel, RawGeometryData};
use crate::geometry::*;

pub fn generate_mesh(model: &BoardModel) -> RawGeometryData {
    let mut segments_v = 120; // Slightly lower res to ensure fast testing, can bump to 240 later
    let segments_u = 96;
    let scale = 1.0 / 12.0;

    let outline = match &model.outline {
        Some(o) => o,
        None => return RawGeometryData::default(),
    };
    if outline.control_points.is_empty() {
        return RawGeometryData::default();
    }

    let nose_pt = evaluate_curve(outline, 0.0);
    let nose_z = nose_pt.z;

    let notch_pt = evaluate_curve(outline, 1.0);
    let _notch_z = notch_pt.z; // Will be used for swallow tail later

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

    let mut z_rings = Vec::with_capacity(segments_v + 1);
    for i in 0..=segments_v {
        let v_param = (1.0 - ((i as f32 / segments_v as f32) * std::f32::consts::PI).cos()) / 2.0;
        z_rings.push(nose_z + v_param * (tip_z - nose_z));
    }
    z_rings.sort_by(|a, b| a.partial_cmp(b).unwrap());
    segments_v = z_rings.len() - 1;

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
        
        let inner_x = 0.0; // Simplify for now (ignores swallow inner walls)

        let top_pt = evaluate_bezier_at_z(model.rocker_top.as_ref().unwrap(), z_inches, v_outer);
        let bot_pt = evaluate_bezier_at_z(model.rocker_bottom.as_ref().unwrap(), z_inches, v_outer);
        let local_thickness = 0.0_f32.max(top_pt.y - bot_pt.y);
        let heat_color = color_heatmap(0.0_f32.max(1.0_f32.min(local_thickness / model.thickness)));

        for j in 0..=segments_u + 1 {
            let mut u = 0.0;
            let mut side = 1.0;
            let mut is_stringer = false;

            if j <= segments_u / 2 {
                u = j as f32 / (segments_u as f32 / 2.0);
                side = 1.0;
                if j == 0 || j == segments_u / 2 { is_stringer = true; }
            } else {
                let left_j = j - (segments_u / 2 + 1);
                u = 1.0 - left_j as f32 / (segments_u as f32 / 2.0);
                side = -1.0;
                if left_j == 0 || left_j == segments_u / 2 { is_stringer = true; }
            }

            let mut point = get_point_at_uv(model, u, v_outer, z_inches, inner_x);
            if is_stringer { point.x = inner_x; }
            point.x *= side;

            if i == 0 && nose_width < 1e-3 { point.x = 0.0; }

            ring.push((Vec3::new(point.x * scale, point.y * scale, point.z * scale), heat_color, u, v_coord));
        }
        grid.push(ring);
    }

    let mut normals = Vec::new();
    for i in 0..=segments_v {
        for j in 0..=segments_u + 1 {
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

            let tangent_u = if j > 0 && j < segments_u + 1 && j != segments_u / 2 && j != segments_u / 2 + 1 {
                grid[i][j + 1].0 - grid[i][j - 1].0
            } else if j == 0 {
                grid[i][1].0 - grid[i][0].0
            } else if j == segments_u / 2 {
                grid[i][j].0 - grid[i][j - 1].0
            } else if j == segments_u / 2 + 1 {
                grid[i][j + 1].0 - grid[i][j].0
            } else {
                grid[i][j].0 - grid[i][j - 1].0
            };

            let mut n = tangent_u.cross(tangent_v).normalize();
            if n.is_nan() || n.length_squared() < 0.0001 {
                if i == 0 { n = Vec3::new(0.0, 0.0, -1.0); }
                else if i == segments_v { n = Vec3::new(0.0, 0.0, 1.0); }
                else { n = Vec3::new(0.0, if j > segments_u / 4 && j < (segments_u * 3 / 4) { 1.0 } else { -1.0 }, 0.0); }
            }
            normals.push(n.x); normals.push(n.y); normals.push(n.z);
        }
    }

    let mut indices = Vec::new();
    for i in 0..segments_v {
        for j in 0..=segments_u {
            let a = (i * (segments_u + 2) + j) as u32;
            let b = a + 1;
            let c = ((i + 1) * (segments_u + 2) + j) as u32;
            let d = c + 1;
            
            if j == segments_u / 2 {
                indices.push(a); indices.push(b); indices.push(d);
                indices.push(a); indices.push(d); indices.push(c);
                continue;
            }
            indices.push(a); indices.push(b); indices.push(d);
            indices.push(a); indices.push(d); indices.push(c);
        }
    }

    // Add Nose Cap
    let cap_vertex_start_idx = (vertices.len() / 3) as u32;
    let bot_y = grid[0][0].0.y;
    let top_y = grid[0][segments_u / 2].0.y;
    let center_y = bot_y + (top_y - bot_y) / 2.0;
    let center_z = grid[0][0].0.z;

    vertices.push(0.0); vertices.push(center_y); vertices.push(center_z);
    uvs.push(0.5); uvs.push(0.0);
    colors.push(1.0); colors.push(1.0); colors.push(1.0);
    normals.push(0.0); normals.push(0.0); normals.push(-1.0);

    let center_idx = cap_vertex_start_idx;
    let perimeter_start_idx = center_idx + 1;

    for j in 0..=segments_u + 1 {
        let hull_index = j as usize;
        vertices.push(vertices[hull_index * 3]); vertices.push(vertices[hull_index * 3 + 1]); vertices.push(vertices[hull_index * 3 + 2]);
        uvs.push(uvs[hull_index * 2]); uvs.push(uvs[hull_index * 2 + 1]);
        colors.push(colors[hull_index * 3]); colors.push(colors[hull_index * 3 + 1]); colors.push(colors[hull_index * 3 + 2]);
        normals.push(0.0); normals.push(0.0); normals.push(-1.0);
    }
    for j in 0..=segments_u {
        indices.push(center_idx); indices.push(perimeter_start_idx + j as u32 + 1); indices.push(perimeter_start_idx + j as u32);
    }

    // Add Tail Cap (Basic blunt tail for this iteration)
    let tail_cap_vertex_start_idx = (vertices.len() / 3) as u32;
    let tail_bot_y = grid[segments_v][0].0.y;
    let tail_top_y = grid[segments_v][segments_u / 2].0.y;
    let tail_center_y = tail_bot_y + (tail_top_y - tail_bot_y) / 2.0;
    let tail_center_z = grid[segments_v][0].0.z;

    vertices.push(0.0); vertices.push(tail_center_y); vertices.push(tail_center_z);
    uvs.push(0.5); uvs.push(1.0);
    colors.push(1.0); colors.push(1.0); colors.push(1.0);
    normals.push(0.0); normals.push(0.0); normals.push(1.0);

    let tail_center_idx = tail_cap_vertex_start_idx;
    let tail_perimeter_start_idx = tail_center_idx + 1;

    let ring_start_index = segments_v * (segments_u + 2);
    for j in 0..=segments_u + 1 {
        let hull_index = ring_start_index + j;
        vertices.push(vertices[hull_index * 3]); vertices.push(vertices[hull_index * 3 + 1]); vertices.push(vertices[hull_index * 3 + 2]);
        uvs.push(uvs[hull_index * 2]); uvs.push(uvs[hull_index * 2 + 1]);
        colors.push(colors[hull_index * 3]); colors.push(colors[hull_index * 3 + 1]); colors.push(colors[hull_index * 3 + 2]);
        normals.push(0.0); normals.push(0.0); normals.push(1.0);
    }
    for j in 0..=segments_u {
        indices.push(tail_center_idx); indices.push(tail_perimeter_start_idx + j as u32); indices.push(tail_perimeter_start_idx + j as u32 + 1);
    }

    RawGeometryData {
        vertices,
        indices,
        uvs,
        colors,
        normals,
        volume_liters: 30.5, // Volume calculation can be added to Rust next
    }
}
