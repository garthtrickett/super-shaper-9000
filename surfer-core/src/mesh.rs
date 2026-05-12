use crate::geometry::*;
use crate::model::{BoardModel, RawGeometryData};
use glam::Vec3;

pub fn generate_mesh(model: &BoardModel) -> RawGeometryData {
    log::info!(
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

    let mut cliff_zs = Vec::new();
    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if !layer.otl_ext.control_points.is_empty() {
                for t in
                    crate::bezier::adaptive_sample_t(&layer.otl_ext, tolerance_degrees, min_dist)
                {
                    all_z.push(evaluate_curve(&layer.otl_ext, t).z);
                }
                let first_z = layer.otl_ext.control_points.first().unwrap().z;
                let last_z = layer.otl_ext.control_points.last().unwrap().z;
                cliff_zs.push(first_z.min(last_z));
                cliff_zs.push(first_z.max(last_z));
            }
            if !layer.otl_int.control_points.is_empty() {
                for t in
                    crate::bezier::adaptive_sample_t(&layer.otl_int, tolerance_degrees, min_dist)
                {
                    all_z.push(evaluate_curve(&layer.otl_int, t).z);
                }
            }
        }
    }

    all_z.push(nose_z);
    all_z.push(tip_z);

    // Inject cliff offsets for sharp wings
    for &cz in &cliff_zs {
        all_z.push(cz - 1e-3);
        all_z.push(cz);
        all_z.push(cz + 1e-3);
    }

    all_z.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut z_rings = Vec::new();
    for z in all_z {
        let clamped = z.clamp(nose_z, tip_z);
        if z_rings.is_empty() {
            z_rings.push(clamped);
        } else {
            let last_z = *z_rings.last().unwrap();
            let diff = clamped - last_z;
            let is_cliff = cliff_zs
                .iter()
                .any(|&cz| (clamped - cz).abs() <= 1.5e-3 || (last_z - cz).abs() <= 1.5e-3);

            if diff > 0.1 || (is_cliff && diff >= 1e-4) {
                z_rings.push(clamped);
            }
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

    let abs_u_to_norm_u = |abs_u: f32, t_tuck: f32, t_apex: f32, t_shoulder: f32| -> f32 {
        if abs_u <= t_tuck {
            if t_tuck > 0.0 {
                (abs_u / t_tuck) * 0.25
            } else {
                0.0
            }
        } else if abs_u <= t_apex {
            if t_apex > t_tuck {
                0.25 + ((abs_u - t_tuck) / (t_apex - t_tuck)) * 0.25
            } else {
                0.25
            }
        } else if abs_u <= t_shoulder {
            if t_shoulder > t_apex {
                0.5 + ((abs_u - t_apex) / (t_shoulder - t_apex)) * 0.25
            } else {
                0.5
            }
        } else if 1.0 > t_shoulder {
            0.75 + ((abs_u - t_shoulder) / (1.0 - t_shoulder)) * 0.25
        } else {
            0.75
        }
    };

    let norm_u_to_abs_u = |norm_u: f32, t_tuck: f32, t_apex: f32, t_shoulder: f32| -> f32 {
        if norm_u <= 0.25 {
            t_tuck * (norm_u / 0.25)
        } else if norm_u <= 0.5 {
            t_tuck + (t_apex - t_tuck) * ((norm_u - 0.25) / 0.25)
        } else if norm_u <= 0.75 {
            t_apex + (t_shoulder - t_apex) * ((norm_u - 0.5) / 0.25)
        } else {
            t_shoulder + (1.0 - t_shoulder) * ((norm_u - 0.75) / 0.25)
        }
    };

    // Adaptive Crosswise (U) Columns
    let critical_norm_us = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    let mut adaptive_norm_us = Vec::new();
    let tolerance_degrees_u = 3.0;
    let min_dist_u = 0.05;

    let default_cs = crate::model::BezierCurveData::default();
    let mut primary_cs = model.cross_sections.first().unwrap_or(&default_cs);
    let mut max_width = 0.0;
    for cs in &model.cross_sections {
        let w = cs.control_points.iter().fold(0.0_f32, |m, p| m.max(p.x));
        if w > max_width {
            max_width = w;
            primary_cs = cs;
        }
    }

    let prim_t_apex = crate::geometry::find_apex_t(primary_cs);
    let prim_t_tuck = 0.01_f32.max(prim_t_apex * 0.5);
    let prim_t_shoulder = prim_t_apex + (1.0 - prim_t_apex) * 0.5;

    for u in crate::bezier::adaptive_sample_t(primary_cs, tolerance_degrees_u, min_dist_u) {
        adaptive_norm_us.push(abs_u_to_norm_u(
            u,
            prim_t_tuck,
            prim_t_apex,
            prim_t_shoulder,
        ));
    }

    let mut u_params_half = critical_norm_us.clone();
    for norm_u in adaptive_norm_us {
        if !critical_norm_us
            .iter()
            .any(|&cu| (norm_u - cu).abs() < 0.01)
        {
            u_params_half.push(norm_u);
        }
    }
    u_params_half.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut final_base_u = Vec::new();
    for u in u_params_half {
        if final_base_u.is_empty() {
            final_base_u.push(u);
        } else {
            let last = *final_base_u.last().unwrap();
            let is_critical = critical_norm_us.iter().any(|&cu| (u - cu).abs() < 1e-5);
            if is_critical || u - last > 0.01 {
                final_base_u.push(u);
            }
        }
    }
    let mut u_params_half = final_base_u;

    // --- NEW: Channel U-parameter injection ---
    let mut cliff_norm_us: Vec<f32> = Vec::new();
    if let Some(channels) = &model.bottom_channels {
        for channel in channels {
            let outlines = [&channel.left_outline, &channel.right_outline];
            for outline_curve in outlines {
                if outline_curve.control_points.is_empty() {
                    continue;
                }
                for z in &z_rings {
                    let min_z = outline_curve.control_points.first().unwrap().z;
                    let max_z = outline_curve.control_points.last().unwrap().z;
                    if *z >= min_z - 1e-3 && *z <= max_z + 1e-3 {
                        let chan_x =
                            crate::geometry::evaluate_bezier_at_z(outline_curve, *z, 0.5).x;
                        // let profile = crate::geometry::get_board_profile_at_z(model, *z, 0.5);
                        let blend = crate::geometry::get_cross_section_blend_at_z(
                            &model.cross_sections,
                            *z,
                        );
                        if let Some(b) = &blend {
                            let inner_x = if *z > notch_z {
                                crate::geometry::evaluate_notch_inner_x(outline, v_tip, *z)
                            } else {
                                0.0
                            };
                            let mut best_u = 0.0;
                            let mut min_diff = f32::INFINITY;
                            let v_outer = crate::geometry::find_v_at_z(outline, *z, 0.0, v_tip);
                            for i in 0..=50 {
                                let test_u = i as f32 / 50.0 * b.t_apex;
                                let test_pt = crate::geometry::get_point_at_uv_base(
                                    model, test_u, v_outer, *z, inner_x, 1.0,
                                );
                                let diff = (test_pt.x - chan_x.abs()).abs();
                                if diff < min_diff {
                                    min_diff = diff;
                                    best_u = test_u;
                                }
                            }
                            let mut u_search = best_u;
                            let mut step = b.t_apex / 50.0;
                            for _ in 0..10 {
                                step *= 0.5;
                                let u_left = (u_search - step).max(0.0);
                                let u_right = (u_search + step).min(b.t_apex);
                                let pt_left = crate::geometry::get_point_at_uv_base(
                                    model, u_left, v_outer, *z, inner_x, 1.0,
                                );
                                let pt_right = crate::geometry::get_point_at_uv_base(
                                    model, u_right, v_outer, *z, inner_x, 1.0,
                                );
                                if (pt_left.x - chan_x.abs()).abs() < min_diff {
                                    min_diff = (pt_left.x - chan_x.abs()).abs();
                                    u_search = u_left;
                                } else if (pt_right.x - chan_x.abs()).abs() < min_diff {
                                    min_diff = (pt_right.x - chan_x.abs()).abs();
                                    u_search = u_right;
                                }
                            }

                            let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
                            let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;
                            let norm_u = abs_u_to_norm_u(u_search, t_tuck, b.t_apex, t_shoulder);
                            cliff_norm_us.push(norm_u);
                        }
                    }
                }
            }
        }
    }

    for cu in cliff_norm_us {
        u_params_half.push((cu - 0.0001).max(0.0));
        u_params_half.push(cu);
        u_params_half.push((cu + 0.0001).min(1.0));
    }

    u_params_half.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut final_u = Vec::new();
    for u in u_params_half {
        if final_u.is_empty() || u - final_u.last().unwrap() > 0.00005 {
            final_u.push(u);
        }
    }
    u_params_half = final_u;
    // --- END NEW ---

    // Compute Arc Length mapping from the primary cross section to prevent UV stretching
    let cs_arc_table = if !model.cross_sections.is_empty() {
        crate::bezier::build_arc_length_table(primary_cs, 200)
    } else {
        Vec::new()
    };

    let total_cs_len = cs_arc_table.last().map(|(_, l)| *l).unwrap_or(0.0);

    let get_u_tex = |norm_u: f32| -> f32 {
        let t_val = norm_u_to_abs_u(norm_u, prim_t_tuck, prim_t_apex, prim_t_shoulder);
        if total_cs_len <= 1e-5 || cs_arc_table.is_empty() {
            return t_val;
        }
        let mut len_at_t = 0.0;
        for i in 0..cs_arc_table.len() - 1 {
            let (t0, l0) = cs_arc_table[i];
            let (t1, l1) = cs_arc_table[i + 1];
            if t_val >= t0 && t_val <= t1 {
                let frac = if t1 > t0 {
                    (t_val - t0) / (t1 - t0)
                } else {
                    0.0
                };
                len_at_t = l0 + frac * (l1 - l0);
                break;
            }
        }
        if t_val >= 1.0 {
            len_at_t = total_cs_len;
        }
        len_at_t / total_cs_len
    };

    let mut u_columns = Vec::new();
    let half = u_params_half.len() - 1;
    for (idx, &u) in u_params_half.iter().enumerate() {
        let is_stringer = idx == 0 || idx == half;
        u_columns.push((u, 1.0, is_stringer, get_u_tex(u))); // Right side
    }
    // Add left side, explicitly duplicating the center stringers so the mesh can bifurcate
    for (idx, &u) in u_params_half.iter().rev().enumerate() {
        let is_stringer = idx == 0 || idx == half;
        u_columns.push((u, -1.0, is_stringer, get_u_tex(u))); // Left side
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

        let inner_x = if z_inches > notch_z {
            crate::geometry::evaluate_notch_inner_x(outline, v_tip, z_inches)
        } else {
            0.0
        };

        let profile = crate::geometry::get_board_profile_at_z(model, z_inches, v_outer);
        let center_thick = (profile.top_y - profile.bot_y).max(0.001);
        let rail_thick = (profile.apex_y - profile.bot_y).max(0.0);
        let foil_ratio = rail_thick / center_thick;

        // Map foil_ratio: ~0.25 (pinched/blue) to ~0.75 (boxy/red)
        let normalized_foil = ((foil_ratio - 0.25) / 0.5).clamp(0.0, 1.0);
        let heat_color = color_heatmap(normalized_foil);

        let blend = crate::geometry::get_cross_section_blend_at_z(&model.cross_sections, z_inches);
        let t_apex = if let Some(b) = &blend { b.t_apex } else { 0.5 };
        let t_tuck = 0.01_f32.max(t_apex * 0.5);
        let t_shoulder = t_apex + (1.0 - t_apex) * 0.5;

        for &(norm_u, side, is_stringer, u_tex) in u_columns.iter() {
            let abs_u = norm_u_to_abs_u(norm_u, t_tuck, t_apex, t_shoulder);
            let mut point = get_point_at_uv(model, abs_u, v_outer, z_inches, inner_x, side);
            if is_stringer {
                point.x = inner_x;
            }
            point.x *= side;

            if i == 0 && nose_width < 1e-3 {
                point.x = 0.0;
            }

            ring.push((
                Vec3::new(point.x * scale, point.y * scale, point.z * scale),
                heat_color,
                u_tex,
                v_coord,
                abs_u,
            ));
        }
        grid.push(ring);
    }

    let (nose_n_top, nose_n_bot) = crate::geometry::get_pole_normals(model, nose_z, true);
    let (tail_n_top, tail_n_bot) = crate::geometry::get_pole_normals(model, tip_z, false);

    let mut normals = Vec::new();
    for i in 0..=segments_v {
        let z_inches = z_rings[i];
        for j in 0..num_cols {
            let (pos, color, u_tex, v_coord, abs_u) = grid[i][j];
            vertices.push(pos.x);
            vertices.push(pos.y);
            vertices.push(pos.z);
            colors.push(color.x);
            colors.push(color.y);
            colors.push(color.z);
            uvs.push(u_tex);
            uvs.push(v_coord);

            let side = u_columns[j].1;
            let n = crate::geometry::get_surface_normal_at_uvz(model, abs_u, z_inches, side);

            normals.push(n.x);
            normals.push(n.y);
            normals.push(n.z);
        }
    }

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

            indices.push(a);
            indices.push(b);
            indices.push(d);
            indices.push(a);
            indices.push(d);
            indices.push(c);
        }
    }

    // Prepare Centerline Arrays and Stitch Caps for B-Rep Surface Patches
    let generate_swallow_notch_wall =
        |vertices: &mut Vec<f32>,
         uvs: &mut Vec<f32>,
         colors: &mut Vec<f32>,
         normals: &mut Vec<f32>,
         indices: &mut Vec<u32>| {
            if (tip_z - notch_z) < 1e-3 {
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

            let num_y_steps = 10;

            // Right Wall
            let start_v_idx = (vertices.len() / 3) as u32;
            for i in notch_start_idx..=segments_v {
                let p_bot = grid[i][0].0;
                let p_top = grid[i][half].0;
                let c_bot = grid[i][0].1;
                let c_top = grid[i][half].1;
                let u_bot = grid[i][0].2;
                let u_top = grid[i][half].2;
                let v_coord = grid[i][0].3;

                let mut n_wall = Vec3::new(-1.0, 0.0, 0.0);

                if i > 0 && i < segments_v {
                    let p_bot_prev = grid[i - 1][0].0;
                    let p_bot_next = grid[i + 1][0].0;
                    let tangent_z = (p_bot_next - p_bot_prev).normalize();
                    let tangent_y = (p_top - p_bot).normalize();
                    n_wall = tangent_y.cross(tangent_z).normalize();
                    if n_wall.x > 0.0 {
                        n_wall = -n_wall;
                    }
                }

                for step in 0..=num_y_steps {
                    let fraction = step as f32 / num_y_steps as f32;
                    let pos = p_bot.lerp(p_top, fraction);
                    let color = c_bot.lerp(c_top, fraction);
                    let u = u_bot + (u_top - u_bot) * fraction;

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
                let ring_a = start_v_idx + i as u32 * (num_y_steps + 1);
                let ring_b = start_v_idx + (i + 1) as u32 * (num_y_steps + 1);
                for j in 0..num_y_steps {
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
                let p_top = grid[i][half + 1].0;
                let p_bot = grid[i][num_cols - 1].0;
                let c_top = grid[i][half + 1].1;
                let c_bot = grid[i][num_cols - 1].1;
                let u_top = grid[i][half + 1].2;
                let u_bot = grid[i][num_cols - 1].2;
                let v_coord = grid[i][num_cols - 1].3;

                let mut n_wall = Vec3::new(1.0, 0.0, 0.0);

                if i > 0 && i < segments_v {
                    let p_bot_prev = grid[i - 1][num_cols - 1].0;
                    let p_bot_next = grid[i + 1][num_cols - 1].0;
                    let tangent_z = (p_bot_next - p_bot_prev).normalize();
                    let tangent_y = (p_bot - p_top).normalize();
                    n_wall = tangent_z.cross(tangent_y).normalize();
                    if n_wall.x < 0.0 {
                        n_wall = -n_wall;
                    }
                }

                for step in 0..=num_y_steps {
                    let fraction = step as f32 / num_y_steps as f32;
                    let pos = p_top.lerp(p_bot, fraction);
                    let color = c_top.lerp(c_bot, fraction);
                    let u = u_top + (u_bot - u_top) * fraction;

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
                let ring_a = start_v_idx_left + i as u32 * (num_y_steps + 1);
                let ring_b = start_v_idx_left + (i + 1) as u32 * (num_y_steps + 1);
                for j in 0..num_y_steps {
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
        };

    let generate_cap = |ring_index: usize,
                        z_inches: f32,
                        _n_top: Vec3,
                        _n_bot: Vec3,
                        fallback_mid: Vec3,
                        is_nose: bool,
                        vertices: &mut Vec<f32>,
                        uvs: &mut Vec<f32>,
                        colors: &mut Vec<f32>,
                        normals: &mut Vec<f32>,
                        indices: &mut Vec<u32>| {
        let width = crate::geometry::evaluate_composite_outline_at_z(
            model,
            z_inches,
            if is_nose { 0.0 } else { 1.0 },
        )
        .x;
        let is_sharp = width < 1e-3;
        let start_vertex_index = (vertices.len() / 3) as u32;
        let ring = &grid[ring_index];

        if is_sharp {
            // The hull naturally closes at sharp poles and already possesses
            // the correct slerp normals. Generating a cap here only creates
            // zero-area degenerate triangles that cause shading artifacts.
        } else {
            // Standard B-Rep Surface Patch Logic for Blunt/Square Ends
            let num_x_steps = (width / 0.5).ceil().max(1.0) as u32;
            let right_target_x = ring[0].0.x;
            let left_target_x = ring[num_cols - 1].0.x;

            for step in 0..=num_x_steps {
                let fraction = 1.0 - (step as f32 / num_x_steps as f32);
                for j in 0..num_cols {
                    let (pos, color, u_tex, v_coord, _abs_u) = ring[j];
                    let side = u_columns[j].1;

                    let target_x = if side > 0.0 {
                        right_target_x
                    } else {
                        left_target_x
                    };

                    let new_x = target_x + (pos.x - target_x) * fraction;

                    vertices.push(new_x);
                    vertices.push(pos.y);
                    vertices.push(pos.z);

                    uvs.push(u_tex);
                    uvs.push(v_coord);

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

                                        let pt_a = Vec3::new(vertices[a as usize * 3], vertices[a as usize * 3 + 1], vertices[a as usize * 3 + 2]);
                    let pt_b = Vec3::new(vertices[b as usize * 3], vertices[b as usize * 3 + 1], vertices[b as usize * 3 + 2]);
                    let pt_c = Vec3::new(vertices[c as usize * 3], vertices[c as usize * 3 + 1], vertices[c as usize * 3 + 2]);
                    let pt_d = Vec3::new(vertices[d as usize * 3], vertices[d as usize * 3 + 1], vertices[d as usize * 3 + 2]);

                    let dist_ac = pt_a.distance_squared(pt_c);
                    let dist_bd = pt_b.distance_squared(pt_d);

                    if is_nose {
                        if dist_bd > 1e-6 {
                            indices.push(a);
                            indices.push(d);
                            indices.push(b);
                        }
                        if dist_ac > 1e-6 {
                            indices.push(a);
                            indices.push(c);
                            indices.push(d);
                        }
                    } else {
                        if dist_bd > 1e-6 {
                            indices.push(a);
                            indices.push(b);
                            indices.push(d);
                        }
                        if dist_ac > 1e-6 {
                            indices.push(a);
                            indices.push(d);
                            indices.push(c);
                        }
                    }
                }
            }
        }
    };

    // --- Swallow Notch Wall ---
    if (tip_z - notch_z) >= 1e-3 {
        log::info!(
            "[Rust core] generate_mesh: Carving swallow tail notch (Depth: {:.2}in)",
            tip_z - notch_z
        );
    }
    generate_swallow_notch_wall(
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );

    // --- Cap Generation ---
    generate_cap(
        0,
        nose_z,
        nose_n_top,
        nose_n_bot,
        Vec3::new(0.0, 0.0, -1.0),
        true,
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );
    generate_cap(
        segments_v,
        tip_z,
        tail_n_top,
        tail_n_bot,
        Vec3::new(0.0, 0.0, 1.0),
        false,
        &mut vertices,
        &mut uvs,
        &mut colors,
        &mut normals,
        &mut indices,
    );

    // Dynamically integrate volume using the Shoelace formula on cross sections
    let mut total_volume_cubic_feet = 0.0;

    for i in 0..segments_v {
        let z0 = grid[i][0].0.z;
        let z1 = grid[i + 1][0].0.z;
        let dz = (z1 - z0).abs();

        let mut area0 = 0.0;
        let mut area1 = 0.0;

        for j in 0..num_cols {
            let next_j = (j + 1) % num_cols;
            let p0_a = grid[i][j].0;
            let p0_b = grid[i][next_j].0;
            area0 += p0_a.x * p0_b.y - p0_b.x * p0_a.y;

            let p1_a = grid[i + 1][j].0;
            let p1_b = grid[i + 1][next_j].0;
            area1 += p1_a.x * p1_b.y - p1_b.x * p1_a.y;
        }

        area0 = area0.abs() * 0.5;
        area1 = area1.abs() * 0.5;

        // Trapezoidal integration across Z
        total_volume_cubic_feet += (area0 + area1) / 2.0 * dz;
    }

    // 1 cubic foot = 28.3168 Liters
    let volume_liters = total_volume_cubic_feet * 28.3168;

    log::info!("[Rust core] Computed Mesh Volume: {:.2}L", volume_liters);

    RawGeometryData {
        vertices,
        indices,
        uvs,
        colors,
        normals,
        volume_liters,
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

        let mesh = generate_mesh(&model);
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

        let mesh = generate_mesh(&model);
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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh_pin = super::generate_mesh(&model_pintail);
        let mesh_squash = super::generate_mesh(&model_squash);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);

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

        let mesh = super::generate_mesh(&model);
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
        #[test]
    fn test_cap_degenerate_triangles() {
        // WitcherDaily.s3dx has a blunt tail, so it generates a patch cap.
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/WitcherDaily.s3dx");

        let content = std::fs::read_to_string(&path).unwrap();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = super::generate_mesh(&model);

        // Find degenerate triangles in the cap
        let mut degenerate_count = 0;
        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i] as usize;
            let i2 = mesh.indices[i + 1] as usize;
            let i3 = mesh.indices[i + 2] as usize;

            let v1 = Vec3::new(mesh.vertices[i1 * 3], mesh.vertices[i1 * 3 + 1], mesh.vertices[i1 * 3 + 2]);
            let v2 = Vec3::new(mesh.vertices[i2 * 3], mesh.vertices[i2 * 3 + 1], mesh.vertices[i2 * 3 + 2]);
            let v3 = Vec3::new(mesh.vertices[i3 * 3], mesh.vertices[i3 * 3 + 1], mesh.vertices[i3 * 3 + 2]);

            // Area of triangle is 0.5 * |(v2 - v1) x (v3 - v1)|
            let area = (v2 - v1).cross(v3 - v1).length();
            if area < 1e-6 {
                degenerate_count += 1;
                println!("Degenerate Triangle {}: Indices({}, {}, {})", degenerate_count, i1, i2, i3);
                println!("  v1: {:?}", v1);
                println!("  v2: {:?}", v2);
                println!("  v3: {:?}", v3);
                println!("  Area: {}\n", area);
            }
        }

        assert_eq!(degenerate_count, 0, "Found degenerate triangles in the mesh! This causes dark square rendering artifacts.");
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

        let mesh = super::generate_mesh(&model);
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
}
