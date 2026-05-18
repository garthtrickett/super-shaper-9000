pub mod bezier;
pub mod brd_exporter;
pub mod brd_parser;
pub mod geometry;
pub mod mesh;
pub mod model;
pub mod obj_exporter;
pub mod reducer;
pub mod s3dx_exporter;
pub mod s3dx_parser;

#[cfg(test)]
#[ctor::ctor(unsafe)]
fn init_test_logger() {
    let _ = env_logger::builder().is_test(true).try_init();
}

use crate::mesh::MeshCache;
use model::{BoardAction, BoardModel, DirtyState, Effect, RawGeometryData};

pub struct SurferEngine {
    model: BoardModel,
    dirty_state: DirtyState,
    mesh_cache: MeshCache,
}

impl Default for SurferEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SurferEngine {
    pub fn new() -> Self {
        Self {
            model: BoardModel::default(),
            dirty_state: DirtyState::default(),
            mesh_cache: MeshCache::default(),
        }
    }

    pub fn get_model(&self) -> &BoardModel {
        &self.model
    }

    pub fn update(&mut self, action: BoardAction) -> (BoardModel, Vec<Effect>) {
        let effects = reducer::update(&mut self.model, &mut self.dirty_state, action);
        (self.model.clone(), effects)
    }

    /// Prove the pipeline works by generating the real mesh!
    pub fn compute_mesh(&mut self) -> RawGeometryData {
        let mesh = mesh::generate_mesh(&self.model, &mut self.dirty_state, &mut self.mesh_cache);
        self.dirty_state.global_rebuild = false;
        self.dirty_state.dirty_z_ranges.clear();
        mesh
    }

    /// Generates a flat Float32Array-compatible buffer of [x1, y1, z1, x2, y2, z2] segments for curvature combs.
    pub fn compute_slice_profile(&self, z_inches: f32) -> Vec<f32> {
        let mut pts = Vec::new();
        let bounds = crate::geometry::get_board_bounds(&self.model);
        let outline = match &self.model.outline {
            Some(o) => o,
            None => return pts,
        };
        let v_tip = bounds.tip_t;
        let _v_outer = crate::geometry::find_v_at_z(outline, z_inches, 0.0, v_tip);

        let ctx = crate::geometry::ZRingContext::new(&self.model, z_inches);
        let t_tuck = if let Some(b) = &ctx.blend {
            0.01_f32.max(b.t_apex * 0.5)
        } else {
            0.5
        };

        let steps = 100;
        pts.push((steps + 1) as f32);

        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let (u, side) = if f < 0.5 {
                (t_tuck * (1.0 - f * 2.0), -1.0)
            } else {
                (t_tuck * ((f - 0.5) * 2.0), 1.0)
            };
            let pt = ctx.get_point_at_uv(u, side);
            pts.push(pt.x);
            pts.push(pt.y);
        }

        if let Some(channels) = &self.model.bottom_channels {
            pts.push(channels.len() as f32);
            let profile = &ctx.profile;
            for channel in channels {
                if channel.left_outline.control_points.is_empty() {
                    pts.push(0.0);
                    pts.push(0.0);
                } else {
                    let cx =
                        crate::geometry::evaluate_bezier_at_z(&channel.left_outline, z_inches, 0.5)
                            .x;
                    let cy =
                        crate::geometry::evaluate_bezier_at_z(&channel.left_depth, z_inches, 0.5).y;
                    pts.push(cx);
                    pts.push(profile.bot_y + cy);
                }
                if channel.right_outline.control_points.is_empty() {
                    pts.push(0.0);
                    pts.push(0.0);
                } else {
                    let cx = crate::geometry::evaluate_bezier_at_z(
                        &channel.right_outline,
                        z_inches,
                        0.5,
                    )
                    .x;
                    let cy =
                        crate::geometry::evaluate_bezier_at_z(&channel.right_depth, z_inches, 0.5)
                            .y;
                    pts.push(cx);
                    pts.push(profile.bot_y + cy);
                }
            }
        } else {
            pts.push(0.0);
        }

        pts
    }

    /// Returns a flat buffer of[z, center_thickness, rail_thickness] triplets for 2D graphing.
    pub fn compute_foil_stats(&self) -> Vec<f32> {
        let bounds = crate::geometry::get_board_bounds(&self.model);
        let outline = match &self.model.outline {
            Some(o) => o,
            None => return Vec::new(),
        };
        let steps = 50;

        use rayon::prelude::*;
        (0..=steps)
            .into_par_iter()
            .flat_map(|i| {
                let f = i as f32 / steps as f32;
                let z = bounds.nose_z + (bounds.tip_z - bounds.nose_z) * f;
                let v_outer = crate::geometry::find_v_at_z(outline, z, 0.0, bounds.tip_t);
                let profile = crate::geometry::get_board_profile_at_z(&self.model, z, v_outer);

                vec![
                    z,
                    (profile.top_y - profile.bot_y).max(0.0), // Center Thickness
                    (profile.apex_y - profile.bot_y).max(0.0), // Rail Thickness
                ]
            })
            .collect()
    }

    pub fn find_closest_t(
        &self,
        curve_name: &str,
        ray_origin: [f32; 3],
        ray_dir: [f32; 3],
    ) -> Option<f32> {
        let curve = crate::geometry::get_curve(&self.model, curve_name)?;
        use glam::Vec3;
        Some(crate::geometry::find_closest_t_to_ray(
            curve,
            Vec3::from_array(ray_origin),
            Vec3::from_array(ray_dir),
        ))
    }

    pub fn get_point_on_curve(&self, curve_name: &str, t: f32) -> Option<[f32; 3]> {
        let curve = crate::geometry::get_curve(&self.model, curve_name)?;
        let pt = crate::geometry::evaluate_curve(curve, t);
        Some([pt.x, pt.y, pt.z])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use glam::Vec3;

    #[test]
    fn test_incremental_meshing_cache_hits() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.width = 20.0;
        model.thickness = 3.0;

        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![Vec3::ZERO; 3],
            tangents2: vec![Vec3::ZERO; 3],
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

        let mut engine = SurferEngine::new();
        engine.update(BoardAction::LoadDesign {
            state: Box::new(model),
        });

        // 1. First Pass (Global Rebuild)
        let mesh1 = engine.compute_mesh();

        // Extract reference vertices from the tail (Z > 75.0)
        let scale = 1.0 / 12.0;
        let mut tail_vertices_run1 = Vec::new();
        for i in 0..(mesh1.vertices.len() / 3) {
            let z = mesh1.vertices[i * 3 + 2];
            if z > 75.0 * scale {
                tail_vertices_run1.push(mesh1.vertices[i * 3]); // X
                tail_vertices_run1.push(mesh1.vertices[i * 3 + 1]); // Y
                tail_vertices_run1.push(mesh1.vertices[i * 3 + 2]); // Z
            }
        }

        // 2. Local Mutation near the nose
        // Move outline node 0 (Nose)
        engine.update(BoardAction::UpdateNodePosition {
            curve: "outline".to_string(),
            index: 0,
            node_type: "anchor".to_string(),
            position: [2.0, 0.0, 0.0],
        });

        // Verify dirty state
        assert!(
            !engine.dirty_state.global_rebuild,
            "Local mutation should not trigger global rebuild"
        );
        assert!(
            !engine.dirty_state.dirty_z_ranges.is_empty(),
            "Should have flagged a dirty z-range"
        );

        // 3. Second Pass (Incremental Build)
        let mesh2 = engine.compute_mesh();

        // 4. Verify cache hit (tail vertices are BITWISE identical)
        let mut tail_vertices_run2 = Vec::new();
        for i in 0..(mesh2.vertices.len() / 3) {
            let z = mesh2.vertices[i * 3 + 2];
            if z > 75.0 * scale {
                tail_vertices_run2.push(mesh2.vertices[i * 3]);
                tail_vertices_run2.push(mesh2.vertices[i * 3 + 1]);
                tail_vertices_run2.push(mesh2.vertices[i * 3 + 2]);
            }
        }

        assert_eq!(
            tail_vertices_run1.len(),
            tail_vertices_run2.len(),
            "Tail topology changed unexpectedly!"
        );

        assert!(tail_vertices_run1.len() > 0, "No vertices found in tail");

        let mut identical_floats = 0;
        for (v1, v2) in tail_vertices_run1.iter().zip(tail_vertices_run2.iter()) {
            if v1.to_bits() == v2.to_bits() {
                identical_floats += 1;
            }
        }

        assert_eq!(
            identical_floats,
            tail_vertices_run1.len(),
            "Cache missed! Vertices in the unaffected tail region were re-computed and lost bitwise identicality."
        );
    }
}
