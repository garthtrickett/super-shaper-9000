pub mod bezier;
pub mod model;
pub mod geometry;
pub mod mesh;
pub mod reducer;
pub mod s3dx_parser;
pub mod s3dx_exporter;

#[cfg(test)]
#[ctor::ctor(unsafe)]
fn init_test_logger() {
    let _ = env_logger::builder().is_test(true).try_init();
}

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
            pub fn compute_slice_profile(&self, z_inches: f32) -> Vec<f32> {
        let mut pts = Vec::new();
        let bounds = crate::geometry::get_board_bounds(&self.model);
        let outline = match &self.model.outline {
            Some(o) => o,
            None => return pts,
        };
        let v_tip = bounds.tip_t;
        let v_outer = crate::geometry::find_v_at_z(outline, z_inches, 0.0, v_tip);
        let notch_z = bounds.notch_z;
        let inner_x = if z_inches > notch_z {
            crate::geometry::evaluate_notch_inner_x(outline, v_tip, z_inches)
        } else {
            0.0
        };

        let blend = crate::geometry::get_cross_section_blend_at_z(&self.model.cross_sections, z_inches);
        let t_tuck = if let Some(b) = &blend {
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
            let pt = crate::geometry::get_point_at_uv(&self.model, u, v_outer, z_inches, inner_x, side);
            pts.push(pt.x);
            pts.push(pt.y);
        }

        if let Some(channels) = &self.model.bottom_channels {
            pts.push(channels.len() as f32);
            let profile = crate::geometry::get_board_profile_at_z(&self.model, z_inches, v_outer);
            for channel in channels {
                if channel.left_outline.control_points.is_empty() {
                    pts.push(0.0); pts.push(0.0);
                } else {
                    let cx = crate::geometry::evaluate_bezier_at_z(&channel.left_outline, z_inches, 0.5).x;
                    let cy = crate::geometry::evaluate_bezier_at_z(&channel.left_depth, z_inches, 0.5).y;
                    pts.push(cx);
                    pts.push(profile.bot_y + cy);
                }
                if channel.right_outline.control_points.is_empty() {
                    pts.push(0.0); pts.push(0.0);
                } else {
                    let cx = crate::geometry::evaluate_bezier_at_z(&channel.right_outline, z_inches, 0.5).x;
                    let cy = crate::geometry::evaluate_bezier_at_z(&channel.right_depth, z_inches, 0.5).y;
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
        let mut stats = Vec::new();
        let bounds = crate::geometry::get_board_bounds(&self.model);
        let outline = match &self.model.outline {
            Some(o) => o,
            None => return stats,
        };
        let steps = 50;

        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let z = bounds.nose_z + (bounds.tip_z - bounds.nose_z) * f;
            let v_outer = crate::geometry::find_v_at_z(outline, z, 0.0, bounds.tip_t);
            let profile = crate::geometry::get_board_profile_at_z(&self.model, z, v_outer);

            stats.push(z);
            stats.push((profile.top_y - profile.bot_y).max(0.0)); // Center Thickness
            stats.push((profile.apex_y - profile.bot_y).max(0.0)); // Rail Thickness
        }
        stats
    }

    /// Generates a flat Float32Array-compatible buffer of[x1, y1, z1, x2, y2, z2] segments for curvature combs.
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

                                        let weights = c.weights.as_ref().and_then(|w| {
                        if w.len() > seg + 1 {
                            Some((w[seg], 1.0, 1.0, w[seg + 1]))
                        } else {
                            None
                        }
                    });

                    for i in 0..=steps {
                        let t = i as f32 / steps as f32;
                        let pt = if let Some((w0, w1, w2, w3)) = weights {
                            crate::bezier::evaluate_rational_bezier_cubic(p0, t0, t1, p1, w0, w1, w2, w3, t)
                        } else {
                            crate::bezier::evaluate_bezier_cubic(p0, t0, t1, p1, t)
                        };
                        let quill = crate::bezier::evaluate_curvature_quill(p0, t0, t1, p1, weights, t, scale);

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
