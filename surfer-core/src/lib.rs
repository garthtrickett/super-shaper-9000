pub mod bezier;
pub mod model;
pub mod geometry;
pub mod mesh;
pub mod reducer;

use model::{BoardAction, BoardModel, Effect, RawGeometryData};

pub struct SurferEngine {
    model: BoardModel,
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
        }
    }

    pub fn get_model(&self) -> &BoardModel {
        &self.model
    }

        pub fn update(&mut self, action: BoardAction) -> (BoardModel, Vec<Effect>) {
        let effects = reducer::update(&mut self.model, action);
        (self.model.clone(), effects)
    }

        /// Prove the pipeline works by generating the real mesh!
    pub fn compute_mesh(&self) -> RawGeometryData {
        mesh::generate_mesh(&self.model)
    }

    /// Generates a flat Float32Array-compatible buffer of [x1, y1, z1, x2, y2, z2] segments for curvature combs.
    pub fn compute_curvature_combs(&self) -> Vec<f32> {
        let mut combs = Vec::new();
        if !self.model.show_curvature.unwrap_or(false) {
            return combs;
        }

        let scale = 200.0; // Multiplier to make curvature visually legible
        let steps = 40;
        let view_scale = 1.0 / 12.0; // CAD inches to World coordinates

        let mut add_curve = |curve: &Option<crate::model::BezierCurveData>| {
            if let Some(c) = curve {
                let num_segments = c.control_points.len().saturating_sub(1);
                for seg in 0..num_segments {
                    let p0 = c.control_points[seg];
                    let t0 = c.tangents2[seg];
                    let t1 = c.tangents1[seg + 1];
                    let p1 = c.control_points[seg + 1];

                    for i in 0..=steps {
                        let t = i as f32 / steps as f32;
                        let pt = crate::bezier::evaluate_bezier_cubic(p0, t0, t1, p1, t);
                        let quill = crate::bezier::evaluate_curvature_quill(p0, t0, t1, p1, t, scale);

                        let tip = pt + quill;

                        combs.push(pt.x * view_scale);
                        combs.push(pt.y * view_scale);
                        combs.push(pt.z * view_scale);

                        combs.push(tip.x * view_scale);
                        combs.push(tip.y * view_scale);
                        combs.push(tip.z * view_scale);
                    }
                }
            }
        };

        if self.model.show_outline.unwrap_or(true) { add_curve(&self.model.outline); }
        if self.model.show_rocker_top.unwrap_or(true) { add_curve(&self.model.rocker_top); }
        if self.model.show_rocker_bottom.unwrap_or(true) { add_curve(&self.model.rocker_bottom); }
        if self.model.show_apex_outline.unwrap_or(true) { add_curve(&self.model.apex_outline); }
        if self.model.show_rail_outline.unwrap_or(true) { add_curve(&self.model.rail_outline); }
        if self.model.show_apex_rocker.unwrap_or(true) { add_curve(&self.model.apex_rocker); }

        if self.model.show_cross_sections.unwrap_or(true) {
            for cs in &self.model.cross_sections {
                add_curve(&Some(cs.clone()));
            }
        }

        combs
    }
}
