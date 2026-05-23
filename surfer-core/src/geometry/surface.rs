use super::{curves::*, profile::*};
use crate::geometry::solve_u_for_target_x;
use crate::model::BoardModel;
use glam::Vec3;

pub fn map_slice_local_to_world(model: &BoardModel, z: f32, u: f32, local_pt: Vec3) -> Vec3 {
    let ctx = crate::geometry::ZRingContext::new(model, z);

    let blend = match ctx.blend.as_ref() {
        Some(b) => b,
        None => return local_pt,
    };
    let t_tuck = blend.t_tuck;
    let t_shoulder = blend.t_apex + (1.0 - blend.t_apex) * 0.5;

    let p_bot = blend.evaluate(0.0);
    let p_tuck = blend.evaluate(t_tuck);
    let p_apex = blend.evaluate(blend.t_apex);
    let p_shoulder = blend.evaluate(t_shoulder);
    let p_top = blend.evaluate(1.0);

    let world_thick = ctx.profile.top_y - ctx.profile.bot_y;
    let local_thick = p_top.y - p_bot.y;
    let scale_y_top = if local_thick.abs() > 1e-5 {
        world_thick / local_thick
    } else {
        1.0
    };
    let scale_y_bot = 1.0;

    let mut final_pos = Vec3::ZERO;
    final_pos.z = z;

    if u <= t_tuck {
        let t = if t_tuck > 1e-5 { u / t_tuck } else { 0.0 };
        let w_x = if (p_tuck.x - p_bot.x).abs() > 1e-5 {
            (local_pt.x - p_bot.x) / (p_tuck.x - p_bot.x)
        } else {
            t
        };
        final_pos.x = ctx.inner_x + w_x * (ctx.profile.tuck_x - ctx.inner_x);

        let local_baseline_y = p_bot.y + t * (p_tuck.y - p_bot.y);
        let local_deviation = local_pt.y - local_baseline_y;
        let world_baseline_y = ctx.profile.bot_y + t * (ctx.profile.tuck_y - ctx.profile.bot_y);
        let applied_scale = if local_deviation > 0.0 {
            scale_y_top
        } else {
            scale_y_bot
        };
        final_pos.y = world_baseline_y + local_deviation * applied_scale;
    } else if u <= blend.t_apex {
        let denom = blend.t_apex - t_tuck;
        let t = if denom > 1e-5 {
            (u - t_tuck) / denom
        } else {
            0.0
        };
        let w_x = if (p_apex.x - p_tuck.x).abs() > 1e-5 {
            (local_pt.x - p_tuck.x) / (p_apex.x - p_tuck.x)
        } else {
            t
        };
        final_pos.x = ctx.profile.tuck_x + w_x * (ctx.profile.apex_x - ctx.profile.tuck_x);

        let local_baseline_y = p_tuck.y + t * (p_apex.y - p_tuck.y);
        let local_deviation = local_pt.y - local_baseline_y;
        let world_baseline_y = ctx.profile.tuck_y + t * (ctx.profile.apex_y - ctx.profile.tuck_y);
        let applied_scale = if local_deviation > 0.0 {
            scale_y_top
        } else {
            scale_y_bot
        };
        final_pos.y = world_baseline_y + local_deviation * applied_scale;
    } else if u <= t_shoulder {
        let denom = t_shoulder - blend.t_apex;
        let t = if denom > 1e-5 {
            (u - blend.t_apex) / denom
        } else {
            0.0
        };
        let w_x = if (p_shoulder.x - p_apex.x).abs() > 1e-5 {
            (local_pt.x - p_apex.x) / (p_shoulder.x - p_apex.x)
        } else {
            t
        };
        final_pos.x = ctx.profile.apex_x + w_x * (ctx.profile.shoulder_x - ctx.profile.apex_x);

        let local_baseline_y = p_apex.y + t * (p_shoulder.y - p_apex.y);
        let local_deviation = local_pt.y - local_baseline_y;
        let world_baseline_y =
            ctx.profile.apex_y + t * (ctx.profile.shoulder_y - ctx.profile.apex_y);
        let applied_scale = if local_deviation > 0.0 {
            scale_y_top
        } else {
            scale_y_bot
        };
        final_pos.y = world_baseline_y + local_deviation * applied_scale;
    } else {
        let denom = 1.0 - t_shoulder;
        let t = if denom > 1e-5 {
            (u - t_shoulder) / denom
        } else {
            0.0
        };
        let w_x = if (p_top.x - p_shoulder.x).abs() > 1e-5 {
            (local_pt.x - p_shoulder.x) / (p_top.x - p_shoulder.x)
        } else {
            t
        };
        final_pos.x = ctx.profile.shoulder_x + w_x * (ctx.inner_x - ctx.profile.shoulder_x);

        let local_baseline_y = p_shoulder.y + t * (p_top.y - p_shoulder.y);
        let local_deviation = local_pt.y - local_baseline_y;
        let world_baseline_y =
            ctx.profile.shoulder_y + t * (ctx.profile.top_y - ctx.profile.shoulder_y);
        let applied_scale = if local_deviation > 0.0 {
            scale_y_top
        } else {
            scale_y_bot
        };
        final_pos.y = world_baseline_y + local_deviation * applied_scale;
    }

    let norm_x_for_rail = if ctx.profile.apex_x > ctx.inner_x {
        ((final_pos.x - ctx.inner_x) / (ctx.profile.apex_x - ctx.inner_x)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let local_rail_coeff = 1.0 - (1.0 - ctx.rail_coeff) * norm_x_for_rail;
    if final_pos.y >= ctx.profile.bot_y {
        final_pos.y = ctx.profile.bot_y + (final_pos.y - ctx.profile.bot_y) * local_rail_coeff;
    }

    if final_pos.x < ctx.inner_x {
        final_pos.x = ctx.inner_x;
    }
    final_pos.y = final_pos.y.max(ctx.profile.bot_y - 5.0);

    let is_nose_pole = (z - ctx.bounds.nose_z).abs() < 1e-4;
    let is_tail_pole = (z - ctx.bounds.tip_z).abs() < 1e-4;

    if (is_nose_pole || is_tail_pole) && ctx.profile.apex_x < 0.1 {
        final_pos.x = 0.0;
    }

    final_pos
}

pub struct ZRingContext<'a> {
    pub model: &'a BoardModel,
    pub z_inches: f32,
    pub bounds: BoardBounds,
    pub v_outer: f32,
    pub inner_x: f32,
    pub profile: BoardProfile,
    pub blend: Option<BlendResult<'a>>,
    pub rail_coeff: f32,
    pub cached_channel_us: Vec<(f32, f32)>,
}

impl<'a> ZRingContext<'a> {
    pub fn new(model: &'a BoardModel, z_inches: f32) -> Self {
        let bounds = get_board_bounds(model);

        let v_outer = if let Some(outline) = &model.outline {
            find_v_at_z(outline, z_inches, 0.0, bounds.tip_t)
        } else {
            0.0
        };

        let inner_x = if let Some(outline) = &model.outline {
            if z_inches > bounds.notch_z {
                evaluate_notch_inner_x(outline, bounds.tip_t, z_inches)
            } else {
                0.0
            }
        } else {
            0.0
        };

        let profile = get_board_profile_at_z(model, z_inches, v_outer);
        let blend = get_cross_section_blend_at_z(&model.cross_sections, z_inches);

        let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
        let dist = z_inches - mid_z;
        let rail_coeff = if dist > 0.0 {
            let t = (dist / (bounds.tip_z - mid_z)).clamp(0.0, 1.0);
            let ease_t = t * t * (3.0 - 2.0 * t);
            1.0 + (model.rail_coefficient_tail - 1.0) * ease_t
        } else {
            let t = ((-dist) / (mid_z - bounds.nose_z)).clamp(0.0, 1.0);
            let ease_t = t * t * (3.0 - 2.0 * t);
            1.0 + (model.rail_coefficient_nose - 1.0) * ease_t
        };

        let mut ctx = Self {
            model,
            z_inches,
            bounds,
            v_outer,
            inner_x,
            profile,
            blend,
            rail_coeff,
            cached_channel_us: Vec::new(),
        };

        ctx.populate_cached_channels();
        ctx
    }

    fn populate_cached_channels(&mut self) {
        let mut cached = Vec::new();
        let blend = match &self.blend {
            Some(b) => b,
            None => return,
        };
        let t_apex = blend.t_apex;

        if let Some(channels) = &self.model.bottom_channels {
            for channel in channels {
                let outlines = [&channel.left_outline, &channel.right_outline];
                for outline in outlines {
                    if outline.control_points.is_empty() {
                        continue;
                    }
                    let min_z = outline.control_points.first().unwrap().z;
                    let max_z = outline.control_points.last().unwrap().z;
                    if self.z_inches >= min_z - 1e-4 && self.z_inches <= max_z + 1e-4 {
                        let chan_x = evaluate_bezier_at_z(outline, self.z_inches, 0.5).x.abs();

                        if cached.iter().any(|(x, _)| (x - chan_x).abs() < 1e-4) {
                            continue;
                        }

                        let u_search = solve_u_for_target_x(
                            |u| self.get_point_at_uv_base(u, 1.0).x - chan_x,
                            0.0,
                            t_apex,
                            1e-4,
                            15,
                        );
                        cached.push((chan_x, u_search));
                    }
                }
            }
        }
        self.cached_channel_us = cached;
    }

    pub fn get_rocker_bottom_slope_with_respect_to_z(&self, hint_t: f32) -> f32 {
        if let Some(r_bot) = &self.model.rocker_bottom {
            let t = evaluate_bezier_t_at_z_robust(r_bot, self.z_inches, hint_t);
            let deriv = evaluate_curve_derivative(r_bot, t);
            if deriv.z.abs() > 1e-5 {
                return deriv.y / deriv.z;
            }
        }
        0.0
    }

    pub fn get_rocker_top_slope_with_respect_to_z(&self, hint_t: f32) -> f32 {
        if let Some(r_top) = &self.model.rocker_top {
            let t = evaluate_bezier_t_at_z_robust(r_top, self.z_inches, hint_t);
            let deriv = evaluate_curve_derivative(r_top, t);
            if deriv.z.abs() > 1e-5 {
                return deriv.y / deriv.z;
            }
        }
        0.0
    }

    pub fn get_composite_outline_slope_with_respect_to_z(&self, hint_t: f32) -> f32 {
        let (_, tan) =
            evaluate_composite_outline_pos_and_tan_at_z(self.model, self.z_inches, hint_t);
        if tan.z.abs() > 1e-5 {
            tan.x / tan.z
        } else {
            0.0
        }
    }

    pub fn get_point_at_uv_base(&self, u: f32, _side: f32) -> Vec3 {
        let profile = &self.profile;
        let blend = self.blend.as_ref();

        if blend.is_none() {
            let py = profile.bot_y + (profile.top_y - profile.bot_y) * u;
            return Vec3::new(profile.half_width, py, self.z_inches);
        }
        let b = blend.unwrap();
        let t_tuck = b.t_tuck;
        let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;

        let p = b.evaluate(u);
        let p_bot = b.evaluate(0.0);
        let p_tuck = b.evaluate(t_tuck);
        let p_apex = b.evaluate(b.t_apex);
        let p_shoulder = b.evaluate(t_shoulder);
        let p_top = b.evaluate(1.0);

        let mut final_pos = Vec3::ZERO;
        final_pos.z = self.z_inches;

        let world_thick = profile.top_y - profile.bot_y;
        let local_thick = p_top.y - p_bot.y;
        let scale_y_top = if local_thick.abs() > 1e-5 {
            world_thick / local_thick
        } else {
            1.0
        };
        let scale_y_bot = 1.0;

        if u <= t_tuck {
            let t = if t_tuck > 1e-5 { u / t_tuck } else { 0.0 };
            let w_x = if (p_tuck.x - p_bot.x).abs() > 1e-5 {
                (p.x - p_bot.x) / (p_tuck.x - p_bot.x)
            } else {
                t
            };
            final_pos.x = self.inner_x + w_x * (profile.tuck_x - self.inner_x);

            let local_baseline_y = p_bot.y + t * (p_tuck.y - p_bot.y);
            let local_deviation = p.y - local_baseline_y;
            let world_baseline_y = profile.bot_y + t * (profile.tuck_y - profile.bot_y);
            let applied_scale = if local_deviation > 0.0 {
                scale_y_top
            } else {
                scale_y_bot
            };
            final_pos.y = world_baseline_y + local_deviation * applied_scale;
        } else if u <= b.t_apex {
            let denom = b.t_apex - t_tuck;
            let t = if denom > 1e-5 {
                (u - t_tuck) / denom
            } else {
                0.0
            };
            let w_x = if (p_apex.x - p_tuck.x).abs() > 1e-5 {
                (p.x - p_tuck.x) / (p_apex.x - p_tuck.x)
            } else {
                t
            };
            final_pos.x = profile.tuck_x + w_x * (profile.apex_x - profile.tuck_x);

            let local_baseline_y = p_tuck.y + t * (p_apex.y - p_tuck.y);
            let local_deviation = p.y - local_baseline_y;
            let world_baseline_y = profile.tuck_y + t * (profile.apex_y - profile.tuck_y);
            let applied_scale = if local_deviation > 0.0 {
                scale_y_top
            } else {
                scale_y_bot
            };
            final_pos.y = world_baseline_y + local_deviation * applied_scale;
        } else if u <= t_shoulder {
            let denom = t_shoulder - b.t_apex;
            let t = if denom > 1e-5 {
                (u - b.t_apex) / denom
            } else {
                0.0
            };
            let w_x = if (p_shoulder.x - p_apex.x).abs() > 1e-5 {
                (p.x - p_apex.x) / (p_shoulder.x - p_apex.x)
            } else {
                t
            };
            final_pos.x = profile.apex_x + w_x * (profile.shoulder_x - profile.apex_x);

            let local_baseline_y = p_apex.y + t * (p_shoulder.y - p_apex.y);
            let local_deviation = p.y - local_baseline_y;
            let world_baseline_y = profile.apex_y + t * (profile.shoulder_y - profile.apex_y);
            let applied_scale = if local_deviation > 0.0 {
                scale_y_top
            } else {
                scale_y_bot
            };
            final_pos.y = world_baseline_y + local_deviation * applied_scale;
        } else {
            let denom = 1.0 - t_shoulder;
            let t = if denom > 1e-5 {
                (u - t_shoulder) / denom
            } else {
                0.0
            };
            let w_x = if (p_top.x - p_shoulder.x).abs() > 1e-5 {
                (p.x - p_shoulder.x) / (p_top.x - p_shoulder.x)
            } else {
                t
            };
            final_pos.x = profile.shoulder_x + w_x * (self.inner_x - profile.shoulder_x);

            let local_baseline_y = p_shoulder.y + t * (p_top.y - p_shoulder.y);
            let local_deviation = p.y - local_baseline_y;
            let world_baseline_y = profile.shoulder_y + t * (profile.top_y - profile.shoulder_y);
            let applied_scale = if local_deviation > 0.0 {
                scale_y_top
            } else {
                scale_y_bot
            };
            final_pos.y = world_baseline_y + local_deviation * applied_scale;
        }

        let norm_x_for_rail = if profile.apex_x > self.inner_x {
            ((final_pos.x - self.inner_x) / (profile.apex_x - self.inner_x)).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let local_rail_coeff = 1.0 - (1.0 - self.rail_coeff) * norm_x_for_rail;
        if final_pos.y >= profile.bot_y {
            final_pos.y = profile.bot_y + (final_pos.y - profile.bot_y) * local_rail_coeff;
        }

        if final_pos.x < self.inner_x {
            final_pos.x = self.inner_x;
        }
        final_pos.y = final_pos.y.max(profile.bot_y - 5.0);

        let is_nose_pole = (self.z_inches - self.bounds.nose_z).abs() < 1e-4;
        let is_tail_pole = (self.z_inches - self.bounds.tip_z).abs() < 1e-4;

        if (is_nose_pole || is_tail_pole) && profile.apex_x < 0.1 {
            final_pos.x = 0.0;
        }

        final_pos
    }

        pub fn get_point_at_uv(&self, u: f32, side: f32) -> Vec3 {
        let mut final_pos = self.get_point_at_uv_base(u, side);

        let blend = self.blend.as_ref();
        let t_apex = if let Some(b) = blend { b.t_apex } else { 0.5 };

        if u <= t_apex {
            if let Some((mut chan_x, chan_depth)) = 
                get_channel_profile_at_z(self.model, side < 0.0, self.z_inches)
            {
                let profile = &self.profile;
                let apex_x = profile.apex_x.max(0.001);
                chan_x = chan_x.abs();
                if chan_x > self.inner_x && chan_x < apex_x {
                    let u_chan = self
                        .cached_channel_us
                        .iter()
                        .find(|(cx, _)| (cx - chan_x).abs() < 1e-3)
                        .map(|(_, val)| *val)
                        .unwrap_or(0.0);

                    let mut channel_applied = false;
                    let mut t = 0.0;

                    if u <= u_chan {
                        if u_chan > 0.0 {
                            t = u / u_chan;
                            channel_applied = true;
                        }
                    } else if t_apex > u_chan {
                        t = 1.0 - (u - u_chan) / (t_apex - u_chan);
                        channel_applied = true;
                    }

                                        if channel_applied {
                        let normal = self.get_surface_normal_base_at_uvz(u, side);
                        final_pos.x *= side;
                        final_pos -= normal * (t * chan_depth);
                        final_pos.x *= side;
                    }
                }
            }
        }

        final_pos
    }

    pub fn get_surface_normal_base_at_uvz(&self, u: f32, side: f32) -> Vec3 {
        let bounds = &self.bounds;

        if (self.z_inches - bounds.nose_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.nose_z, true);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, -1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
        if (self.z_inches - bounds.tip_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.tip_z, false);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, 1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }

        let du = 1e-4;
        let u_plus = (u + du).min(1.0);
        let u_minus = (u - du).max(0.0);
        let mut pt_plus_u = self.get_point_at_uv_base(u_plus, side);
        pt_plus_u.x *= side;
        let mut pt_minus_u = self.get_point_at_uv_base(u_minus, side);
        pt_minus_u.x *= side;
        let mut t_u = (pt_plus_u - pt_minus_u).normalize();
        if t_u.is_nan() || t_u.length_squared() < 1e-6 {
            t_u = Vec3::new(side, 0.0, 0.0);
        }

        let t_v =
            if self.z_inches <= bounds.nose_z + 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else if self.z_inches >= bounds.tip_z - 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else {
                let dz = 1e-3;
                let ctx_plus = ZRingContext::new(self.model, self.z_inches + dz);
                let mut pt_plus_v = ctx_plus.get_point_at_uv_base(u, side);
                pt_plus_v.x *= side;
                let ctx_minus = ZRingContext::new(self.model, self.z_inches - dz);
                let mut pt_minus_v = ctx_minus.get_point_at_uv_base(u, side);
                pt_minus_v.x *= side;
                (pt_plus_v - pt_minus_v).normalize()
            };
        let mut t_v_norm = t_v;
        if t_v_norm.is_nan() || t_v_norm.length_squared() < 1e-6 {
            t_v_norm = Vec3::new(0.0, 0.0, 1.0);
        }

        let cross = t_u.cross(t_v_norm);
        let mut n = if cross.length_squared() > 1e-6 { 
            cross.normalize()
        } else {
            Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0)
        };
        if side < 0.0 {
            n = -n;
        }

        let pt = self.get_point_at_uv_base(u, side);
        if pt.x.abs() < 1e-4 && self.inner_x < 1e-4 {
            n.x = 0.0;
            let len_sq = n.length_squared();
            if len_sq > 1e-6 {
                n /= len_sq.sqrt();
            } else {
                n = Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0);
            }
        }

        n
    }
                        final_pos.x *= side;
                        final_pos -= normal * (t * chan_depth);
                        final_pos.x *= side;
                    }
                }
            }
        }

        final_pos
    }

    pub fn get_surface_normal_base_at_uvz(&self, u: f32, side: f32) -> Vec3 {
        let bounds = &self.bounds;

        if (self.z_inches - bounds.nose_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.nose_z, true);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, -1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
        if (self.z_inches - bounds.tip_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.tip_z, false);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, 1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }

        let du = 1e-4;
        let u_plus = (u + du).min(1.0);
        let u_minus = (u - du).max(0.0);
        let mut pt_plus_u = self.get_point_at_uv_base(u_plus, side);
        pt_plus_u.x *= side;
        let mut pt_minus_u = self.get_point_at_uv_base(u_minus, side);
        pt_minus_u.x *= side;
        let mut t_u = (pt_plus_u - pt_minus_u).normalize();
        if t_u.is_nan() || t_u.length_squared() < 1e-6 {
            t_u = Vec3::new(side, 0.0, 0.0);
        }

                        let mut t_v =
            if self.z_inches <= bounds.nose_z + 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else if self.z_inches >= bounds.tip_z - 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else {
                let dz = 1e-3;
                let ctx_plus = ZRingContext::new(self.model, self.z_inches + dz);
                let mut pt_plus_v = ctx_plus.get_point_at_uv_base(u, side);
                pt_plus_v.x *= side;
                let ctx_minus = ZRingContext::new(self.model, self.z_inches - dz);
                let mut pt_minus_v = ctx_minus.get_point_at_uv_base(u, side);
                pt_minus_v.x *= side;
                (pt_plus_v - pt_minus_v).normalize()
            };
        if t_v.is_nan() || t_v.length_squared() < 1e-6 {
            t_v = Vec3::new(0.0, 0.0, 1.0);
        }

        let cross = t_u.cross(t_v);
        let mut n = if cross.length_squared() > 1e-6 { 
            cross.normalize()
        } else {
            Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0)
        };
        if side < 0.0 {
            n = -n;
        }

        let pt = self.get_point_at_uv_base(u, side);
        if pt.x.abs() < 1e-4 && self.inner_x < 1e-4 {
            n.x = 0.0;
            let len_sq = n.length_squared();
            if len_sq > 1e-6 {
                n /= len_sq.sqrt();
            } else {
                n = Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0);
            }
        }

        n
    }

        pub fn get_surface_normal_at_uvz(&self, u: f32, side: f32) -> Vec3 {
        let bounds = &self.bounds;

        if (self.z_inches - bounds.nose_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.nose_z, true);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, -1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }
        if (self.z_inches - bounds.tip_z).abs() < 1e-4 && self.profile.apex_x < 0.1 {
            let (n_top, n_bot) = get_pole_normals(self.model, bounds.tip_z, false);
            let mut n = slerp_normals(n_bot, n_top, u, Vec3::new(0.0, 0.0, 1.0));
            if side < 0.0 {
                n.x = -n.x;
            }
            return n;
        }

        let du = 1e-4;
        let u_plus = (u + du).min(1.0);
        let u_minus = (u - du).max(0.0);
        let mut pt_plus_u = self.get_point_at_uv(u_plus, side);
        pt_plus_u.x *= side;
        let mut pt_minus_u = self.get_point_at_uv(u_minus, side);
        pt_minus_u.x *= side;
        let mut t_u = (pt_plus_u - pt_minus_u).normalize();
        if t_u.is_nan() || t_u.length_squared() < 1e-6 {
            t_u = Vec3::new(side, 0.0, 0.0);
        }

        let t_v =
            if self.z_inches <= bounds.nose_z + 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else if self.z_inches >= bounds.tip_z - 0.5 {
                Vec3::new(0.0, 0.0, 1.0)
            } else {
                let dz = 1e-3;
                let ctx_plus = ZRingContext::new(self.model, self.z_inches + dz);
                let mut pt_plus_v = ctx_plus.get_point_at_uv(u, side);
                pt_plus_v.x *= side;
                let ctx_minus = ZRingContext::new(self.model, self.z_inches - dz);
                let mut pt_minus_v = ctx_minus.get_point_at_uv(u, side);
                pt_minus_v.x *= side;
                (pt_plus_v - pt_minus_v).normalize()
            };
        let mut t_v_norm = t_v;
        if t_v_norm.is_nan() || t_v_norm.length_squared() < 1e-6 {
            t_v_norm = Vec3::new(0.0, 0.0, 1.0);
        }

        let cross = t_u.cross(t_v_norm);
        let mut n = if cross.length_squared() > 1e-6 {
            cross.normalize()
        } else {
            Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0)
        };
        if side < 0.0 {
            n = -n;
        }

        let pt = self.get_point_at_uv(u, side);
        if pt.x.abs() < 1e-4 && self.inner_x < 1e-4 { 
            n.x = 0.0;
            let len_sq = n.length_squared();
            if len_sq > 1e-6 {
                n /= len_sq.sqrt();
            } else {
                n = Vec3::new(0.0, if u < 0.5 { -1.0 } else { 1.0 }, 0.0);
            }
        }

        n
    }
}

/// Spherical Linear Interpolation for normal vectors.
pub fn slerp_normals(n1: Vec3, n2: Vec3, t: f32, fallback_mid: Vec3) -> Vec3 {
    let t = t.clamp(0.0, 1.0);
    let dot = n1.dot(n2).clamp(-1.0, 1.0);

    if dot > 0.9999 {
        return n1.lerp(n2, t).normalize();
    }

    if dot < -0.9999 {
        if t < 0.5 {
            return slerp_normals(n1, fallback_mid, t * 2.0, fallback_mid);
        } else {
            return slerp_normals(fallback_mid, n2, (t - 0.5) * 2.0, fallback_mid);
        }
    }

    let theta = dot.acos();
    let sin_theta = theta.sin();
    let w1 = ((1.0 - t) * theta).sin() / sin_theta;
    let w2 = (t * theta).sin() / sin_theta;

    (n1 * w1 + n2 * w2).normalize()
}

pub fn get_pole_normals(model: &BoardModel, z_inches: f32, _is_nose: bool) -> (Vec3, Vec3) {
    let r_top = model.rocker_top.as_ref().unwrap();
    let r_bot = model.rocker_bottom.as_ref().unwrap();

    let t_top = find_v_at_z(r_top, z_inches, 0.0, 1.0);
    let t_bot = find_v_at_z(r_bot, z_inches, 0.0, 1.0);

    let (_, tan_top) = crate::bezier::evaluate_composite_pos_and_tangent(r_top, t_top);
    let (_, tan_bot) = crate::bezier::evaluate_composite_pos_and_tangent(r_bot, t_bot);

    // The stringer lies on the YZ plane (X=0). The X-axis (1,0,0) is perpendicular to this plane.
    // Top normal: Tangent x X-axis points outward (+Y)
    let mut n_top = tan_top.cross(Vec3::X).normalize();
    if n_top.is_nan() || n_top.length_squared() < 1e-5 {
        n_top = Vec3::Y;
    }

    // Bottom normal: X-axis x Tangent points outward (-Y)
    let mut n_bot = Vec3::X.cross(tan_bot).normalize();
    if n_bot.is_nan() || n_bot.length_squared() < 1e-5 {
        n_bot = Vec3::NEG_Y;
    }

    (n_top, n_bot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BezierCurveData;
    use approx::assert_relative_eq;
    use glam::Vec3;

    #[test]
    fn test_no_deck_y_spike_at_pin_tail() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(10.0, 0.0, 40.0),
                Vec3::new(2.0, 0.0, 95.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, 0.0, 5.0),
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

        let blend = get_cross_section_blend_at_z(&model.cross_sections, 99.0).unwrap();
        let t_shoulder = blend.t_apex + (1.0 - blend.t_apex) * 0.5;

        let ctx_99 = ZRingContext::new(&model, 99.0);
        let pt_99 = ctx_99.get_point_at_uv(t_shoulder, 1.0);
        let ctx_100 = ZRingContext::new(&model, 100.0);
        let pt_100 = ctx_100.get_point_at_uv(t_shoulder, 1.0);

        let diff_y = (pt_100.y - pt_99.y).abs();
        assert!(
            diff_y < 0.2,
            "Shoulder Y spiked abruptly at the tip! y_99: {}, y_100: {}",
            pt_99.y,
            pt_100.y
        );
    }

    #[test]
    fn test_analytical_surface_normals() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 50.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 50.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, -0.5, 0.0),
                Vec3::new(5.0, 1.0, 0.0),
            ],
            tangents2: vec![
                Vec3::new(5.0, -1.0, 0.0),
                Vec3::new(10.0, 0.5, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            ..Default::default()
        }];

        let ctx = ZRingContext::new(&model, 50.0);

        let n_deck = ctx.get_surface_normal_at_uvz(1.0, 1.0);
        assert!(n_deck.y > 0.99);
        assert!(n_deck.x.abs() < 1e-4);

        let n_bot = ctx.get_surface_normal_at_uvz(0.0, 1.0);
        assert!(n_bot.y < -0.99);
        assert!(n_bot.x.abs() < 1e-4);

        let n_apex = ctx.get_surface_normal_at_uvz(0.5, 1.0);
        assert!(n_apex.x > 0.9);

        let n_apex_left = ctx.get_surface_normal_at_uvz(0.5, -1.0);
        assert!(n_apex_left.x < -0.9);
    }

    #[test]
    fn test_zone_based_uv_evaluation() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., 1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., 0.6667, 66.6667)],
            tangents2: vec![Vec3::new(0., 0.3333, 33.3333), Vec3::new(0., 1., 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0., -1., 100.)],
            tangents1: vec![Vec3::ZERO, Vec3::new(0., -0.6667, 66.6667)],
            tangents2: vec![Vec3::new(0., -0.3333, 33.3333), Vec3::new(0., -1., 100.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            tangents1: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::new(10., 0., 0.), Vec3::ZERO],
            ..Default::default()
        }];

        let ctx = ZRingContext::new(&model, 50.0);
        let pt_bot_stringer = ctx.get_point_at_uv(0.0, 1.0);
        assert_eq!(pt_bot_stringer.x, 0.0);

        let pt_top_stringer = ctx.get_point_at_uv(1.0, 1.0);
        assert_eq!(pt_top_stringer.x, 0.0);
    }

    #[test]
    fn test_pin_tail_uv_singularity() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)], // X=0 at tail (pin)
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(0.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        let u = 0.5;
        let z = 99.99;
        let ctx = ZRingContext::new(&model, z);
        let n = ctx.get_surface_normal_at_uvz(u, 1.0);
        assert!(!n.is_nan());
    }

    #[test]
    fn test_swallow_tail_split_normals() {
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
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        let ctx = ZRingContext::new(&model, 98.0);
        let n = ctx.get_surface_normal_at_uvz(0.5, 1.0);
        assert!(!n.is_nan());
    }

    #[test]
    fn test_concave_zero_crossing_artifact() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        let cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(2.5, -1.0, 0.0),
                Vec3::new(5.0, 0.0, 0.0),
                Vec3::new(7.5, 1.0, 0.0),
                Vec3::new(10.0, 2.0, 0.0),
            ],
            tangents1: vec![Vec3::ZERO; 5],
            tangents2: vec![Vec3::ZERO; 5],
            ..Default::default()
        };
        model.cross_sections = vec![cs];

        let blend = get_cross_section_blend_at_z(&model.cross_sections, 50.0).unwrap();
        let t_tuck = blend.t_tuck;

        let u_test = t_tuck / 2.0; // t = 0.25 (P1)
        let slice_pt = blend.evaluate(u_test);
        assert!(slice_pt.y < -0.1);

        let ctx = ZRingContext::new(&model, 50.0);
        let pt = ctx.get_point_at_uv(u_test, 1.0);
        assert!(pt.y < -0.1);
    }

    #[test]
    fn test_z_ring_context_caching() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 50.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 50.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });

        let ctx = ZRingContext::new(&model, 50.0);
        assert_eq!(ctx.z_inches, 50.0);
        assert_eq!(ctx.bounds.nose_z, 0.0);
        assert_eq!(ctx.bounds.tip_z, 100.0);

        let pt = ctx.get_point_at_uv(0.5, 1.0);
        assert!(pt.x > 0.0);

        let n = ctx.get_surface_normal_at_uvz(0.5, 1.0);
        assert!(n.length() > 0.99 && n.length() < 1.01);
    }

    #[test]
    fn test_mini_simmons_tuck_x_not_less_than_inner_x() {
        let mut model = BoardModel::default();
        let basic_cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
            ..Default::default()
        };
        model.cross_sections = vec![basic_cs];
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            tangents1: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0.0, 1.0, 60.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0.0, -1.0, 60.0)],
            ..Default::default()
        });

        let bounds = get_board_bounds(&model);

        let steps = 10;
        let mut violations = 0;

        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let z = bounds.notch_z + (bounds.tip_z - bounds.notch_z) * f;

            let v_outer = find_v_at_z(model.outline.as_ref().unwrap(), z, 0.0, bounds.tip_t);
            let profile = get_board_profile_at_z(&model, z, v_outer);

            let inner_x = if z > bounds.notch_z {
                evaluate_notch_inner_x(model.outline.as_ref().unwrap(), bounds.tip_t, z)
            } else {
                0.0
            };

            if profile.tuck_x < inner_x - 1e-4 {
                violations += 1;
            }
        }

        assert_eq!(violations, 0);
    }

    #[test]
    fn test_mini_simmons_mesh_generation_diagnostics() {
        let mut model = BoardModel::default();
        let basic_cs = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
            ..Default::default()
        };
        model.cross_sections = vec![basic_cs];
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            tangents1: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 60.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0.0, 1.0, 60.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::ZERO, Vec3::new(0.0, -1.0, 60.0)],
            ..Default::default()
        });

        let bounds = get_board_bounds(&model);
        assert!((bounds.tip_z - bounds.notch_z) < 1e-3);
    }

    #[test]
    fn test_channel_projection_on_v_tail() {
        use crate::model::ChannelLayer;
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 66.6667)],
            tangents2: vec![Vec3::new(10.0, 0.0, 33.3333), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            tangents1: vec![Vec3::ZERO, Vec3::ZERO],
            tangents2: vec![Vec3::ZERO, Vec3::ZERO],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(5.0, -0.5, 0.0)],
            tangents2: vec![Vec3::new(5.0, -0.5, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        }];
        model.v_concave_tail = 5.0;

        model.bottom_channels = Some(vec![ChannelLayer {
            name: "V-Tail Channel".to_string(),
            is_symmetric: true,
            left_outline: BezierCurveData::default(),
            right_outline: BezierCurveData {
                control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
                tangents1: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 66.6667)],
                tangents2: vec![Vec3::new(5.0, 0.0, 33.3333), Vec3::new(5.0, 0.0, 100.0)],
                ..Default::default()
            },
            left_depth: BezierCurveData::default(),
            right_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
                tangents1: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 66.6667)],
                tangents2: vec![Vec3::new(0.0, 1.0, 33.3333), Vec3::new(0.0, 1.0, 100.0)],
                ..Default::default()
            },
        }]);

        let z = 75.0;
        let u_chan = 0.25;

        let ctx = ZRingContext::new(&model, z);
        let pt_base = ctx.get_point_at_uv_base(u_chan, 1.0);
        let pt_chan = ctx.get_point_at_uv(u_chan, 1.0);

        let dx = (pt_chan.x - pt_base.x).abs();
        let dy = (pt_chan.y - pt_base.y).abs();

        assert!(dx > 0.05);
        assert!(dy > 0.05);
    }

    #[test]
    fn test_normal_slerp() {
        let n1 = Vec3::new(0.0, -1.0, 0.0);
        let n2 = Vec3::new(0.0, 1.0, 0.0);
        let fallback = Vec3::new(0.0, 0.0, -1.0);

        let mid = slerp_normals(n1, n2, 0.5, fallback);
        assert!((mid.z - (-1.0)).abs() < 1e-5);
        assert!(mid.y.abs() < 1e-5);
        assert!(mid.x.abs() < 1e-5);

        let n3 = Vec3::new(0.0, -1.0, 0.0);
        let n4 = Vec3::new(0.0, 0.0, -1.0);
        let mid_90 = slerp_normals(n3, n4, 0.5, Vec3::X);

        let expected_val = -2.0_f32.sqrt() / 2.0;
        assert!((mid_90.length() - 1.0).abs() < 1e-5);
        assert!((mid_90.y - expected_val).abs() < 1e-5);
        assert!((mid_90.z - expected_val).abs() < 1e-5);
    }

    #[test]
    fn test_concave_preservation_during_lofting() {
        let mut model = BoardModel::default();
        model.length = 100.0;
        model.width = 20.0;

        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(0.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 2.0, 0.0), Vec3::new(0.0, 2.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::ZERO; 2],
            tangents2: vec![Vec3::ZERO; 2],
            ..Default::default()
        });

        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 50.0),
                Vec3::new(5.0, -1.0, 50.0),
                Vec3::new(10.0, 0.0, 50.0),
                Vec3::new(5.0, 1.0, 50.0),
                Vec3::new(0.0, 2.0, 50.0),
            ],
            tangents1: vec![Vec3::ZERO; 5],
            tangents2: vec![Vec3::ZERO; 5],
            ..Default::default()
        }];

        let ctx = ZRingContext::new(&model, 50.0);

        // Validate the BoardProfile didn't squish the tuck_y
        assert!(
            (ctx.profile.tuck_y - (-1.0)).abs() < 1e-4,
            "Concave was squished! Expected -1.0, got {}",
            ctx.profile.tuck_y
        );

        // Validate the 3D projection didn't squish it either
        let pt = ctx.get_point_at_uv_base(0.25, 1.0); // t_tuck = 0.5/2 = 0.25
        assert!(
            (pt.y - (-1.0)).abs() < 1e-4,
            "Concave point was squished during mapping! Expected -1.0, got {}",
            pt.y
        );
    }

    #[test]
    fn test_z_ring_channel_cache_coverage() {
        let mut model = BoardModel::default();
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, 0.0), Vec3::new(0.0, -1.0, 100.0)],
            ..Default::default()
        });
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
            ..Default::default()
        });
        model.cross_sections = vec![BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.0, 0.0),
                Vec3::new(10.0, 0.0, 0.0),
                Vec3::new(0.0, 1.0, 0.0),
            ],
            ..Default::default()
        }];

        let ctx_no_channels = ZRingContext::new(&model, 50.0);
        assert!(ctx_no_channels.cached_channel_us.is_empty());

        model.bottom_channels = Some(vec![crate::model::ChannelLayer {
            name: "Test Channel".to_string(),
            is_symmetric: true,
            left_outline: BezierCurveData::default(),
            left_depth: BezierCurveData::default(),
            right_outline: BezierCurveData {
                control_points: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 100.0)],
                ..Default::default()
            },
            right_depth: BezierCurveData {
                control_points: vec![Vec3::new(0.0, 1.0, 0.0), Vec3::new(0.0, 1.0, 100.0)],
                ..Default::default()
            },
        }]);

        let ctx_with_channels = ZRingContext::new(&model, 50.0);
        assert!(!ctx_with_channels.cached_channel_us.is_empty());
        assert_eq!(ctx_with_channels.cached_channel_us.len(), 1);
        assert_relative_eq!(
            ctx_with_channels.cached_channel_us[0].0,
            5.0,
            epsilon = 1e-4
        );
    }

    #[test]
    fn test_wing_tuck_offset_prevents_intersection() {
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

        model.rail_outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 0.0, 0.0),
                Vec3::new(9.0, 0.0, 50.0),
                Vec3::new(0.0, 0.0, 100.0),
            ],
            tangents1: vec![
                Vec3::ZERO,
                Vec3::new(9.0, 0.0, 40.0),
                Vec3::new(0.0, 0.0, 90.0),
            ],
            tangents2: vec![
                Vec3::new(0.0, 0.0, 10.0),
                Vec3::new(9.0, 0.0, 60.0),
                Vec3::ZERO,
            ],
            ..Default::default()
        });

        let base_outline_x = evaluate_bezier_at_z(model.outline.as_ref().unwrap(), 75.0, 0.5).x;

        let wing_ext = BezierCurveData {
            control_points: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 70.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 80.0),
            ],
            tangents1: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 70.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 75.0),
            ],
            tangents2: vec![
                Vec3::new(base_outline_x - 2.0, 0.0, 75.0),
                Vec3::new(base_outline_x - 2.0, 0.0, 80.0),
            ],
            ..Default::default()
        };
        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            active: true,
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

        let profile = get_board_profile_at_z(&model, 75.0, 0.5);

        assert!(profile.tuck_x < profile.apex_x);
    }
}
