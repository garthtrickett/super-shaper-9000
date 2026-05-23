use crate::geometry::evaluate_bezier_at_z;
use crate::model::BoardModel;
use glam::Vec3;

pub struct SurfaceData {
    pub vertices: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub colors: Vec<f32>,
}

#[allow(clippy::too_many_arguments)]
pub fn build_surface(
    model: &BoardModel,
    dirty: &crate::model::DirtyState,
    cache: &crate::mesh::MeshCache,
    z_rings: &[f32],
    u_columns: &[crate::mesh::UColumn],
    outline: &crate::model::BezierCurveData,
    _notch_z: f32,
    v_tip: f32,
    scale: f32,
) -> SurfaceData {
    let segments_v = z_rings.len().saturating_sub(1);
    let num_cols = u_columns.len();
    let total_points = (segments_v + 1) * num_cols;

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

    let mut vertices = vec![0.0; total_points * 3];
    let mut normals = vec![0.0; total_points * 3];
    let mut uvs = vec![0.0; total_points * 2];
    let mut colors = vec![0.0; total_points * 3];

    use rayon::prelude::*;

    vertices
        .par_chunks_exact_mut(num_cols * 3)
        .zip(normals.par_chunks_exact_mut(num_cols * 3))
        .zip(uvs.par_chunks_exact_mut(num_cols * 2))
        .zip(colors.par_chunks_exact_mut(num_cols * 3))
        .enumerate()
        .for_each(|(i, (((v_chunk, n_chunk), u_chunk), c_chunk))| {
            let z_inches = z_rings[i];
            let v_coord = if total_arc_length > 0.0 {
                slice_arc_lengths[i] / total_arc_length
            } else {
                0.0
            };

            let is_dirty = dirty.global_rebuild
                || dirty
                    .dirty_z_ranges
                    .iter()
                    .any(|&(min_z, max_z)| z_inches >= min_z && z_inches <= max_z);

            if !is_dirty {
                if let Ok(cache_idx) = cache
                    .z_rings
                    .binary_search_by(|z| z.partial_cmp(&z_inches).unwrap())
                {
                    let cache_v_offset = cache_idx * num_cols * 3;
                    let cache_u_offset = cache_idx * num_cols * 2;

                    if cache_v_offset + num_cols * 3 <= cache.vertices.len() {
                        v_chunk.copy_from_slice(
                            &cache.vertices[cache_v_offset..cache_v_offset + num_cols * 3],
                        );
                        n_chunk.copy_from_slice(
                            &cache.normals[cache_v_offset..cache_v_offset + num_cols * 3],
                        );
                        c_chunk.copy_from_slice(
                            &cache.colors[cache_v_offset..cache_v_offset + num_cols * 3],
                        );
                        u_chunk.copy_from_slice(
                            &cache.uvs[cache_u_offset..cache_u_offset + num_cols * 2],
                        );

                        for j in 0..num_cols {
                            u_chunk[j * 2 + 1] = v_coord;
                        }
                        return;
                    }
                }
            }

            let ctx = crate::geometry::ZRingContext::new(model, z_inches);
            let center_thick = (ctx.profile.top_y - ctx.profile.bot_y).max(0.001);
            let rail_thick = (ctx.profile.apex_y - ctx.profile.bot_y).max(0.0);
            let foil_ratio = rail_thick / center_thick;
            let normalized_foil = ((foil_ratio - 0.25) / 0.5).clamp(0.0, 1.0);

            let t_apex = if let Some(b) = &ctx.blend {
                b.t_apex
            } else {
                0.5
            };
            let t_tuck = if let Some(b) = &ctx.blend {
                b.t_tuck
            } else {
                0.01_f32.max(t_apex * 0.5)
            };
            let t_shoulder = t_apex + (1.0 - t_apex) * 0.5;

            for (j, col) in u_columns.iter().enumerate() {
                let abs_u =
                    crate::mesh::sampler::norm_u_to_abs_u(col.norm_u, t_tuck, t_apex, t_shoulder);
                let mut point = ctx.get_point_at_uv(abs_u, col.side);
                if col.is_stringer {
                    point.x = ctx.inner_x;
                }
                point.x *= col.side;

                let normal = ctx.get_surface_normal_at_uvz(abs_u, col.side);

                let v_idx = j * 3;
                v_chunk[v_idx] = point.x * scale;
                v_chunk[v_idx + 1] = point.y * scale;
                v_chunk[v_idx + 2] = point.z * scale;

                n_chunk[v_idx] = normal.x;
                n_chunk[v_idx + 1] = normal.y;
                n_chunk[v_idx + 2] = normal.z;

                c_chunk[v_idx] = normalized_foil;
                c_chunk[v_idx + 1] = point.y - ctx.profile.bot_y; // Elevation relative to stringer (inches)
                c_chunk[v_idx + 2] = 0.0;

                let u_idx = j * 2;
                u_chunk[u_idx] = col.u_tex;
                u_chunk[u_idx + 1] = v_coord;
            }
        });

    SurfaceData {
        vertices,
        normals,
        uvs,
        colors,
    }
}
