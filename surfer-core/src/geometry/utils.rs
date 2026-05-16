use super::curves::evaluate_curve;
use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub enum EaseType {
    EaseIn,
    EaseOut,
    EaseInOut,
}

/// Warps a linear parameter `t` (0.0 to 1.0) to cluster vertices near edges.
pub fn radial_ease(t: f32, ease_type: EaseType) -> f32 {
    let t = t.clamp(0.0, 1.0);
    use std::f32::consts::PI;
    match ease_type {
        EaseType::EaseIn => 1.0 - (t * PI / 2.0).cos(),
        EaseType::EaseOut => (t * PI / 2.0).sin(),
        EaseType::EaseInOut => -((t * PI).cos() - 1.0) / 2.0,
    }
}

pub fn color_heatmap(normalized_value: f32) -> Vec3 {
    let hue = (1.0 - normalized_value) * 240.0;
    let h = hue / 360.0;
    let hue2rgb = |p: f32, q: f32, mut t: f32| -> f32 {
        if t < 0.0 {
            t += 1.0;
        }
        if t > 1.0 {
            t -= 1.0;
        }
        if t < 1.0 / 6.0 {
            return p + (q - p) * 6.0 * t;
        }
        if t < 1.0 / 2.0 {
            return q;
        }
        if t < 2.0 / 3.0 {
            return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
        }
        p
    };
    Vec3::new(
        hue2rgb(0.0, 1.0, h + 1.0 / 3.0),
        hue2rgb(0.0, 1.0, h),
        hue2rgb(0.0, 1.0, h - 1.0 / 3.0),
    )
}

pub fn get_curve<'a>(model: &'a BoardModel, curve_name: &str) -> Option<&'a BezierCurveData> {
    match curve_name {
        "outline" => model.outline.as_ref(),
        "rockerTop" => model.rocker_top.as_ref(),
        "rockerBottom" => model.rocker_bottom.as_ref(),
        "apexOutline" => model.apex_outline.as_ref(),
        "railOutline" => model.rail_outline.as_ref(),
        "apexRocker" => model.apex_rocker.as_ref(),
        "deckShoulder" => model.deck_shoulder.as_ref(),
        name if name.starts_with("crossSection_") => {
            let idx: usize = name.strip_prefix("crossSection_")?.parse().ok()?;
            model.cross_sections.get(idx)
        }
        name if name.starts_with("outlineLayer_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 3 {
                let idx: usize = parts[1].parse().ok()?;
                let layer = model.outline_layers.as_ref()?.get(idx)?;
                return if parts[2] == "ext" {
                    Some(&layer.otl_ext)
                } else if parts[2] == "int" {
                    Some(&layer.otl_int)
                } else {
                    None
                };
            }
            None
        }
        name if name.starts_with("channel_") => {
            let parts: Vec<&str> = name.split('_').collect();
            if parts.len() == 4 {
                let idx: usize = parts[1].parse().ok()?;
                let side = parts[2];
                let curve_type = parts[3];
                let channel = model.bottom_channels.as_ref()?.get(idx)?;
                return match (side, curve_type) {
                    ("left", "outline") => Some(&channel.left_outline),
                    ("right", "outline") => Some(&channel.right_outline),
                    ("left", "depth") => Some(&channel.left_depth),
                    ("right", "depth") => Some(&channel.right_depth),
                    _ => None,
                };
            }
            None
        }
        _ => None,
    }
}

pub fn find_closest_t_to_ray(curve: &BezierCurveData, ro: Vec3, rd: Vec3) -> f32 {
    let mut best_t = 0.0;
    let mut min_dist_sq = f32::INFINITY;
    let steps = 100;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let pt = evaluate_curve(curve, t);
        let w = pt - ro;
        let cross = w.cross(rd);
        let dist_sq = cross.length_squared();
        if dist_sq < min_dist_sq {
            min_dist_sq = dist_sq;
            best_t = t;
        }
    }

    let mut t_search = best_t;
    let mut step = 1.0 / steps as f32;
    for _ in 0..10 {
        step /= 2.0;
        let t_l = 0.0_f32.max(t_search - step);
        let t_r = 1.0_f32.min(t_search + step);
        let pt_l = evaluate_curve(curve, t_l);
        let pt_r = evaluate_curve(curve, t_r);
        let dist_l = (pt_l - ro).cross(rd).length_squared();
        let dist_r = (pt_r - ro).cross(rd).length_squared();

        if dist_l < min_dist_sq && dist_l <= dist_r {
            min_dist_sq = dist_l;
            t_search = t_l;
        } else if dist_r < min_dist_sq {
            min_dist_sq = dist_r;
            t_search = t_r;
        }
    }
    t_search
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_radial_ease() {
        let eps = 1e-5;

        assert!((radial_ease(0.0, EaseType::EaseIn) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseIn) - 1.0).abs() < eps);
        assert!(radial_ease(0.5, EaseType::EaseIn) < 0.5);

        assert!((radial_ease(0.0, EaseType::EaseOut) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseOut) - 1.0).abs() < eps);
        assert!(radial_ease(0.5, EaseType::EaseOut) > 0.5);

        assert!((radial_ease(0.0, EaseType::EaseInOut) - 0.0).abs() < eps);
        assert!((radial_ease(1.0, EaseType::EaseInOut) - 1.0).abs() < eps);
        assert!((radial_ease(0.5, EaseType::EaseInOut) - 0.5).abs() < eps);
    }
}
