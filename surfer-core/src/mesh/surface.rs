use crate::geometry::{
    color_heatmap, evaluate_bezier_at_z,
};
use crate::model::BoardModel;
use glam::Vec3;

#[derive(Clone, Debug, Default)]
pub struct SurfacePoint {
    pub pos: Vec3,
    pub normal: Vec3,
    pub color: Vec3,
    pub u_tex: f32,
    pub v_coord: f32,
    pub abs_u: f32,
}

pub type SurfaceGrid = Vec<Vec<SurfacePoint>>;

pub struct SurfaceData {
    pub grid: SurfaceGrid,
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
    u_columns: &[(f32, f32, bool, f32)],
    outline: &crate::model::BezierCurveData,
    _notch_z: f32,
    v_tip: f32,
    scale: f32,
) -> SurfaceData {
    let segments_v = z_rings.len().saturating_sub(1);
    let num_cols = u_columns.len();

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
    let mut grid = Vec::with_capacity(segments_v + 1);

    for i in 0..=segments_v {
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
                if cache_idx < cache.grid.len() {
                    // CACHE HIT: Rescue the pre-calculated row of geometric points and normals.
                    // We only need to overwrite the `v_coord` which may have shifted topologically.
                    let mut cloned_ring = cache.grid[cache_idx].clone();
                    for pt in &mut cloned_ring {
                        pt.v_coord = v_coord;
                    }
                    grid.push(cloned_ring);
                    continue;
                }
            }
        }

        // CACHE MISS: Recalculate this specific Z-ring.
        let mut ring = Vec::with_capacity(num_cols);
        
        let ctx = crate::geometry::ZRingContext::new(model, z_inches);

        let center_thick = (ctx.profile.top_y - ctx.profile.bot_y).max(0.001);
        let rail_thick = (ctx.profile.apex_y - ctx.profile.bot_y).max(0.0);
        let foil_ratio = rail_thick / center_thick;

        let normalized_foil = ((foil_ratio - 0.25) / 0.5).clamp(0.0, 1.0);
        let heat_color = color_heatmap(normalized_foil);

        let t_apex = if let Some(b) = &ctx.blend { b.t_apex } else { 0.5 };
        let t_tuck = 0.01_f32.max(t_apex * 0.5);
        let t_shoulder = t_apex + (1.0 - t_apex) * 0.5;

        for &(norm_u, side, is_stringer, u_tex) in u_columns.iter() {
            let abs_u = crate::mesh::sampler::norm_u_to_abs_u(norm_u, t_tuck, t_apex, t_shoulder);
            let mut point = ctx.get_point_at_uv(abs_u, side);
            if is_stringer {
                point.x = ctx.inner_x;
            }
            point.x *= side;

            let normal = ctx.get_surface_normal_at_uvz(abs_u, side);

            ring.push(SurfacePoint {
                pos: Vec3::new(point.x * scale, point.y * scale, point.z * scale),
                normal,
                color: heat_color,
                u_tex,
                v_coord,
                abs_u,
            });
        }
        grid.push(ring);
    }

    // Fast 2D to 1D Topology Extrusion
    let mut normals = Vec::new();
    for ring in &grid {
        for sp in ring {
            vertices.push(sp.pos.x);
            vertices.push(sp.pos.y);
            vertices.push(sp.pos.z);
            colors.push(sp.color.x);
            colors.push(sp.color.y);
            colors.push(sp.color.z);
            uvs.push(sp.u_tex);
            uvs.push(sp.v_coord);
            normals.push(sp.normal.x);
            normals.push(sp.normal.y);
            normals.push(sp.normal.z);
        }
    }

    SurfaceData {
        grid,
        vertices,
        normals,
        uvs,
        colors,
    }
}
