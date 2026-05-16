use crate::geometry::{
    color_heatmap, evaluate_bezier_at_z, get_point_at_uv, get_surface_normal_at_uvz,
};
use crate::model::BoardModel;
use glam::Vec3;

#[derive(Clone, Debug, Default)]
pub struct SurfacePoint {
    pub pos: Vec3,
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
    _dirty: &crate::model::DirtyState,
    _cache: &crate::mesh::MeshCache,
    z_rings: &[f32],
    u_columns: &[(f32, f32, bool, f32)],
    outline: &crate::model::BezierCurveData,
    notch_z: f32,
    v_tip: f32,
    scale: f32,
) -> SurfaceData {
    let segments_v = z_rings.len() - 1;
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
    let mut grid = Vec::new();

    for i in 0..=segments_v {
        let mut ring = Vec::new();
        let z_inches = z_rings[i];
        let v_coord = if total_arc_length > 0.0 {
            slice_arc_lengths[i] / total_arc_length
        } else {
            0.0
        };
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
            let abs_u = crate::mesh::sampler::norm_u_to_abs_u(norm_u, t_tuck, t_apex, t_shoulder);
            let mut point = get_point_at_uv(model, abs_u, v_outer, z_inches, inner_x, side);
            if is_stringer {
                point.x = inner_x;
            }
            point.x *= side;

            ring.push(SurfacePoint {
                pos: Vec3::new(point.x * scale, point.y * scale, point.z * scale),
                color: heat_color,
                u_tex,
                v_coord,
                abs_u,
            });
        }
        grid.push(ring);
    }

    let mut normals = Vec::new();
    for i in 0..=segments_v {
        let z_inches = z_rings[i];
        for j in 0..num_cols {
            let sp = &grid[i][j];
            vertices.push(sp.pos.x);
            vertices.push(sp.pos.y);
            vertices.push(sp.pos.z);
            colors.push(sp.color.x);
            colors.push(sp.color.y);
            colors.push(sp.color.z);
            uvs.push(sp.u_tex);
            uvs.push(sp.v_coord);

            let side = u_columns[j].1;
            let n = get_surface_normal_at_uvz(model, sp.abs_u, z_inches, side);

            normals.push(n.x);
            normals.push(n.y);
            normals.push(n.z);
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
