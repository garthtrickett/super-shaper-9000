use glam::Vec3;

pub fn generate_hull_indices(
    vertices: &[f32],
    segments_v: usize,
    num_cols: usize,
    right_half_cols: usize,
) -> Vec<u32> {
    let mut indices = Vec::new();
    for i in 0..segments_v {
        for j in 0..num_cols - 1 {
            // Do not bridge the right and left halves at the top stringer!
            if j == right_half_cols - 1 {
                continue;
            }

            let a = (i * num_cols + j) as u32;
            let b = a + 1;
            let c = ((i + 1) * num_cols + j) as u32;
            let d = c + 1;

            let idx_a = a as usize * 3;
            let idx_b = b as usize * 3;
            let idx_c = c as usize * 3;
            let idx_d = d as usize * 3;

            let pos_a = Vec3::new(vertices[idx_a], vertices[idx_a + 1], vertices[idx_a + 2]);
            let pos_b = Vec3::new(vertices[idx_b], vertices[idx_b + 1], vertices[idx_b + 2]);
            let pos_c = Vec3::new(vertices[idx_c], vertices[idx_c + 1], vertices[idx_c + 2]);
            let pos_d = Vec3::new(vertices[idx_d], vertices[idx_d + 1], vertices[idx_d + 2]);

            // Only push valid triangles. If a ring collapses to a point at the poles,
            // we dynamically drop the degenerate zero-area triangles.
            // We use the cross product area to catch Z-collapses, U-collapses, and diagonal folds.
            if (pos_b - pos_a).cross(pos_d - pos_a).length_squared() > 1e-16 {
                indices.push(a);
                indices.push(b);
                indices.push(d);
            }
            if (pos_d - pos_a).cross(pos_c - pos_a).length_squared() > 1e-16 {
                indices.push(a);
                indices.push(d);
                indices.push(c);
            }
        }
    }
    indices
}

#[allow(clippy::too_many_arguments)]
pub fn generate_swallow_notch_wall(
    z_rings: &[f32],
    segments_v: usize,
    num_cols: usize,
    half: usize,
    notch_z: f32,
    tip_z: f32,
    v_tip: f32,
    vertices: &mut Vec<f32>,
    uvs: &mut Vec<f32>,
    colors: &mut Vec<f32>,
    normals: &mut Vec<f32>,
    indices: &mut Vec<u32>,
) {
    if v_tip >= 0.999 || (tip_z - notch_z) < 1e-3 {
        return;
    }

    let mut notch_start_idx = 0;
    for (i, &z_inch) in z_rings.iter().enumerate() {
        if z_inch > notch_z + 1e-4 {
            notch_start_idx = i.saturating_sub(1);
            break;
        }
    }

    let num_z_steps = segments_v - notch_start_idx;
    if num_z_steps < 1 {
        return;
    }

    let get_pos = |verts: &[f32], i: usize, j: usize| {
        let idx = (i * num_cols + j) * 3;
        Vec3::new(verts[idx], verts[idx + 1], verts[idx + 2])
    };
    let get_uv = |uv_arr: &[f32], i: usize, j: usize| {
        let idx = (i * num_cols + j) * 2;
        (uv_arr[idx], uv_arr[idx + 1])
    };
    let get_col = |col_arr: &[f32], i: usize, j: usize| {
        let idx = (i * num_cols + j) * 3;
        Vec3::new(col_arr[idx], col_arr[idx + 1], col_arr[idx + 2])
    };

    // Right Wall
    let start_v_idx = (vertices.len() / 3) as u32;
    for i in notch_start_idx..=segments_v {
        let p_bot = get_pos(vertices, i, 0);
        let p_top = get_pos(vertices, i, half);

        let mut n_wall = Vec3::new(-1.0, 0.0, 0.0);

        if i > 0 && i < segments_v {
            let p_bot_prev = get_pos(vertices, i - 1, 0);
            let p_bot_next = get_pos(vertices, i + 1, 0);
            let tangent_z = (p_bot_next - p_bot_prev).normalize();
            let tangent_y = (p_top - p_bot).normalize();
            n_wall = tangent_y.cross(tangent_z).normalize();
            if n_wall.x > 0.0 {
                n_wall = -n_wall;
            }
        }

        for j in 0..=half {
            let hull_pos = get_pos(vertices, i, j);
            let color = get_col(colors, i, j);
            let (u, v_coord) = get_uv(uvs, i, j);

            let pos = Vec3::new(p_bot.x, hull_pos.y, hull_pos.z);

            vertices.push(pos.x);
            vertices.push(pos.y);
            vertices.push(pos.z);
            uvs.push(u);
            uvs.push(v_coord);
            colors.push(color.x);
            colors.push(color.y);
            colors.push(color.z);
            normals.push(n_wall.x);
            normals.push(n_wall.y);
            normals.push(n_wall.z);
        }
    }

    for i in 0..num_z_steps {
        let ring_a = start_v_idx + i as u32 * (half as u32 + 1);
        let ring_b = start_v_idx + (i + 1) as u32 * (half as u32 + 1);
        for j in 0..half as u32 {
            let a = ring_a + j;
            let b = a + 1;
            let c = ring_b + j;
            let d = c + 1;
            indices.push(a);
            indices.push(c);
            indices.push(b);
            indices.push(b);
            indices.push(c);
            indices.push(d);
        }
    }

    // Left Wall
    let start_v_idx_left = (vertices.len() / 3) as u32;
    for i in notch_start_idx..=segments_v {
        let p_top = get_pos(vertices, i, half + 1);
        let p_bot = get_pos(vertices, i, num_cols - 1);

        let mut n_wall = Vec3::new(1.0, 0.0, 0.0);

        if i > 0 && i < segments_v {
            let p_bot_prev = get_pos(vertices, i - 1, num_cols - 1);
            let p_bot_next = get_pos(vertices, i + 1, num_cols - 1);
            let tangent_z = (p_bot_next - p_bot_prev).normalize();
            let tangent_y = (p_bot - p_top).normalize();
            n_wall = tangent_z.cross(tangent_y).normalize();
            if n_wall.x < 0.0 {
                n_wall = -n_wall;
            }
        }

        for j in (half + 1)..num_cols {
            let hull_pos = get_pos(vertices, i, j);
            let color = get_col(colors, i, j);
            let (u, v_coord) = get_uv(uvs, i, j);

            let pos = Vec3::new(p_bot.x, hull_pos.y, hull_pos.z);

            vertices.push(pos.x);
            vertices.push(pos.y);
            vertices.push(pos.z);
            uvs.push(u);
            uvs.push(v_coord);
            colors.push(color.x);
            colors.push(color.y);
            colors.push(color.z);
            normals.push(n_wall.x);
            normals.push(n_wall.y);
            normals.push(n_wall.z);
        }
    }

    for i in 0..num_z_steps {
        let ring_a = start_v_idx_left + i as u32 * (half as u32 + 1);
        let ring_b = start_v_idx_left + (i + 1) as u32 * (half as u32 + 1);
        for j in 0..half as u32 {
            let a = ring_a + j;
            let b = a + 1;
            let c = ring_b + j;
            let d = c + 1;
            indices.push(a);
            indices.push(c);
            indices.push(b);
            indices.push(b);
            indices.push(c);
            indices.push(d);
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn generate_cap(
    ring_index: usize,
    fallback_mid: Vec3,
    is_nose: bool,
    num_cols: usize,
    half: usize,
    right_half_cols: usize,
    u_columns: &[(f32, f32, bool, f32)],
    scale: f32,
    vertices: &mut Vec<f32>,
    uvs: &mut Vec<f32>,
    colors: &mut Vec<f32>,
    normals: &mut Vec<f32>,
    indices: &mut Vec<u32>,
) {
    let mut ring_pos = Vec::with_capacity(num_cols);
    let mut ring_color = Vec::with_capacity(num_cols);
    let ring_start_idx = ring_index * num_cols;
    for j in 0..num_cols {
        let idx = (ring_start_idx + j) * 3;
        ring_pos.push(Vec3::new(
            vertices[idx],
            vertices[idx + 1],
            vertices[idx + 2],
        ));
        ring_color.push(Vec3::new(colors[idx], colors[idx + 1], colors[idx + 2]));
    }

    let mut right_min_x = f32::INFINITY;
    let mut right_max_x = f32::NEG_INFINITY;
    for pos in ring_pos.iter().take(half + 1) {
        let x = pos.x;
        right_min_x = right_min_x.min(x);
        right_max_x = right_max_x.max(x);
    }
    let ring_width = right_max_x - right_min_x;
    let is_sharp = ring_width < 0.005;
    let start_vertex_index = (vertices.len() / 3) as u32;

    if is_sharp {
        // The hull naturally closes at sharp poles and already possesses
        // the correct slerp normals. Generating a cap here only creates
        // zero-area degenerate triangles that cause shading artifacts.
    } else {
        // Standard B-Rep Surface Patch Logic for Blunt/Square Ends
        let width_inches = ring_width / scale;
        let num_x_steps = (width_inches / 0.5).ceil().max(1.0) as u32;
        let right_target_x = ring_pos[0].x;
        let right_target_y_bot = ring_pos[0].y;
        let right_target_y_top = ring_pos[half].y;

        let left_target_x = ring_pos[num_cols - 1].x;
        let left_target_y_bot = ring_pos[num_cols - 1].y;
        let left_target_y_top = ring_pos[half + 1].y;

        for step in 0..=num_x_steps {
            let fraction = 1.0 - (step as f32 / num_x_steps as f32);
            for j in 0..num_cols {
                let pos = ring_pos[j];
                let color = ring_color[j];
                let side = u_columns[j].1;

                let target_x = if side > 0.0 {
                    right_target_x
                } else {
                    left_target_x
                };

                let pos_bot_y = ring_pos[if side > 0.0 { 0 } else { num_cols - 1 }].y;
                let pos_top_y = ring_pos[if side > 0.0 { half } else { half + 1 }].y;
                let y_frac = if (pos_top_y - pos_bot_y).abs() > 1e-5 {
                    (pos.y - pos_bot_y) / (pos_top_y - pos_bot_y)
                } else {
                    0.5
                };

                let target_y_bot = if side > 0.0 {
                    right_target_y_bot
                } else {
                    left_target_y_bot
                };
                let target_y_top = if side > 0.0 {
                    right_target_y_top
                } else {
                    left_target_y_top
                };
                let center_y = target_y_bot + (target_y_top - target_y_bot) * y_frac;

                let new_x = if step == 0 {
                    pos.x
                } else {
                    target_x + (pos.x - target_x) * fraction
                };
                let new_y = if step == 0 {
                    pos.y
                } else {
                    center_y + (pos.y - center_y) * fraction
                };

                vertices.push(new_x);
                vertices.push(new_y);
                vertices.push(pos.z);

                // Prevent UV degeneracy which poisons WebGL tangent generation and causes black holes
                uvs.push(new_x);
                uvs.push(new_y);

                colors.push(color.x);
                colors.push(color.y);
                colors.push(color.z);

                let blended_normal = fallback_mid;
                normals.push(blended_normal.x);
                normals.push(blended_normal.y);
                normals.push(blended_normal.z);
            }
        }

        for step in 0..num_x_steps {
            let ring_a_start = start_vertex_index + step * (num_cols as u32);
            let ring_b_start = start_vertex_index + (step + 1) * (num_cols as u32);

            for j in 0..num_cols - 1 {
                if j == right_half_cols - 1 {
                    continue; // Do not bridge the right and left halves on the caps!
                }

                let a = ring_a_start + j as u32;
                let b = a + 1;
                let c = ring_b_start + j as u32;
                let d = c + 1;

                let pt_a = Vec3::new(
                    vertices[a as usize * 3],
                    vertices[a as usize * 3 + 1],
                    vertices[a as usize * 3 + 2],
                );
                let pt_b = Vec3::new(
                    vertices[b as usize * 3],
                    vertices[b as usize * 3 + 1],
                    vertices[b as usize * 3 + 2],
                );
                let pt_c = Vec3::new(
                    vertices[c as usize * 3],
                    vertices[c as usize * 3 + 1],
                    vertices[c as usize * 3 + 2],
                );
                let pt_d = Vec3::new(
                    vertices[d as usize * 3],
                    vertices[d as usize * 3 + 1],
                    vertices[d as usize * 3 + 2],
                );

                if is_nose {
                    if (pt_d - pt_a).cross(pt_b - pt_a).length() > 1e-9 {
                        indices.push(a);
                        indices.push(d);
                        indices.push(b);
                    }
                    if (pt_c - pt_a).cross(pt_d - pt_a).length() > 1e-9 {
                        indices.push(a);
                        indices.push(c);
                        indices.push(d);
                    }
                } else {
                    if (pt_b - pt_a).cross(pt_d - pt_a).length() > 1e-9 {
                        indices.push(a);
                        indices.push(b);
                        indices.push(d);
                    }
                    if (pt_d - pt_a).cross(pt_c - pt_a).length() > 1e-9 {
                        indices.push(a);
                        indices.push(d);
                        indices.push(c);
                    }
                }
            }
        }
    }
}
