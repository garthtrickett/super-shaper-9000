use super::curves::evaluate_curve;
use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub fn intersect_ray_sphere(ro: Vec3, rd: Vec3, center: Vec3, radius: f32) -> Option<f32> {
    let oc = ro - center;
    let b = oc.dot(rd);
    let c = oc.dot(oc) - radius * radius;
    let d = b * b - c;
    if d > 0.0 {
        let t = -b - d.sqrt();
        if t > 0.0 {
            return Some(t);
        }
    }
    None
}

pub fn distance_ray_line(ro: Vec3, rd: Vec3, a: Vec3, b: Vec3) -> f32 {
    let u = rd;
    let v = b - a;
    let w = ro - a;
    let a_dot = u.dot(u);
    let b_dot = u.dot(v);
    let c_dot = v.dot(v);
    let d_dot = u.dot(w);
    let e_dot = v.dot(w);
    let d = a_dot * c_dot - b_dot * b_dot;
    let sc = if d < 1e-6 {
        0.0
    } else {
        (b_dot * e_dot - c_dot * d_dot) / d
    };
    let tc = if d < 1e-6 {
        if b_dot > c_dot {
            d_dot / b_dot
        } else {
            e_dot / c_dot
        }
    } else {
        (a_dot * e_dot - b_dot * d_dot) / d
    };
    let tc = tc.clamp(0.0, 1.0);
    let d_vec = w + u * sc - v * tc;
    d_vec.length()
}

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

pub fn solve_u_for_target_x<F>(
    mut f: F,
    mut a: f32,
    mut b: f32,
    tolerance: f32,
    max_iterations: usize,
) -> f32
where
    F: FnMut(f32) -> f32,
{
    let mut fa = f(a);
    let mut fb = f(b);

    if fa.abs() < tolerance {
        return a;
    }
    if fb.abs() < tolerance {
        return b;
    }

    if fa * fb > 0.0 {
        return if fa.abs() < fb.abs() { a } else { b };
    }

    let mut last_side = 0;

    for _ in 0..max_iterations {
        if (b - a).abs() < tolerance {
            break;
        }

        let denominator = fb - fa;
        let mut next = if denominator.abs() > 1e-6 {
            b - fb * (b - a) / denominator
        } else {
            0.5 * (a + b)
        };

        let margin = 0.01 * (b - a).abs();
        if next < a.min(b) + margin || next > a.max(b) - margin {
            next = 0.5 * (a + b);
        }

        let fnext = f(next);
        if fnext.abs() < tolerance {
            return next;
        }

        if fnext * fa < 0.0 {
            b = next;
            fb = fnext;
            if last_side == 1 {
                fa /= 2.0;
            }
            last_side = 1;
        } else {
            a = next;
            fa = fnext;
            if last_side == 2 {
                fb /= 2.0;
            }
            last_side = 2;
        }
    }

    if fa.abs() < fb.abs() { a } else { b }
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
    use approx::assert_relative_eq;

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

    #[test]
    fn test_rocker_arc_length_integration() {
        // Create a heavily rockered bottom curve (nose at Y=5.0, center at Y=-2.0, tail at Y=4.0)
        let rocker = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 5.0, -35.0),
                Vec3::new(0.0, -2.0, 0.0),
                Vec3::new(0.0, 4.0, 35.0),
            ],
            ..Default::default()
        };

        let table = RockerArcLengthTable::new(&rocker, -35.0, 35.0);

        // Cartesian Z length is 35 - (-35) = 70.0
        let cartesian_len = 70.0_f32;

        println!(
            "[Test] Cartesian Length: {}, Curvilinear Length: {}",
            cartesian_len, table.total_length
        );

        // Integrated curvilinear length along the curved bottom rocker MUST be strictly greater than the flat baseline length
        assert!(table.total_length > cartesian_len);

        // Assert some key inverse mappings
        let nose_z = table.map_s_to_z(table.total_length);
        assert!((nose_z - (-35.0)).abs() < 1e-3);

        let tail_z = table.map_s_to_z(0.0);
        assert!((tail_z - 35.0).abs() < 1e-3);

        let mid_z = table.map_s_to_z(table.total_length * 0.5);
        // Midpoint should be close to 0.0 (middle of the board)
        assert!(mid_z.abs() < 5.0);
    }

            #[test]
        fn test_hybrid_solver_precision() {
            let root = solve_u_for_target_x(|x| x * x - 4.0, 0.0, 5.0, 1e-5, 10);
            assert_relative_eq!(root, 2.0, epsilon = 1e-4);
        }

    #[test]
    fn test_hybrid_solver_bounds_safety() {
        let root_flat = solve_u_for_target_x(|_x| 1.0, 0.0, 5.0, 1e-5, 10);
        assert!(root_flat == 0.0 || root_flat == 5.0);

        let root_out = solve_u_for_target_x(|x| x + 10.0, 0.0, 5.0, 1e-5, 10);
        assert_eq!(root_out, 0.0);
    }

    #[test]
    fn test_inverse_mapping_solver() {
        let rocker = BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 5.0, -35.0),
                Vec3::new(0.0, -2.0, 0.0),
                Vec3::new(0.0, 4.0, 35.0),
            ],
            ..Default::default()
        };

        let table = RockerArcLengthTable::new(&rocker, -35.0, 35.0);

        // Perform round-trip checks for 100 points along the board
        let steps = 100;
        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let original_z = -35.0 + 70.0 * f;

            // 1. Convert Cartesian Z to curvilinear S (from tail)
            let s_from_tail = table.map_z_to_s(original_z);

            // 2. Convert curvilinear S back to Cartesian Z
            let calibrated_z = table.map_s_to_z(s_from_tail);

            // 3. Assert they are mathematically identical down to the fourth decimal place
            assert_relative_eq!(original_z, calibrated_z, epsilon = 1e-4);
        }
    }
}

/// Numerical integration table mapping running curvilinear tape-measure distances (S)
/// along the bottom rocker curve back into flat Cartesian Z-coordinates.
pub struct RockerArcLengthTable {
    pub z_values: Vec<f32>,
    pub s_values: Vec<f32>,
    pub total_length: f32,
}

impl RockerArcLengthTable {
    pub fn new(rocker: &crate::model::BezierCurveData, nose_z: f32, tip_z: f32) -> Self {
        let mut z_values = Vec::new();
        let mut s_values = Vec::new();

        let step_size = 0.1_f32;
        let mut current_z = nose_z;
        let mut current_s = 0.0_f32;

        z_values.push(current_z);
        s_values.push(current_s);

        let mut prev_y = super::evaluate_bezier_at_z(rocker, current_z, 0.0).y;

        while current_z + step_size < tip_z {
            let next_z = current_z + step_size;
            let t_hint = (next_z - nose_z) / (tip_z - nose_z);
            let next_y = super::evaluate_bezier_at_z(rocker, next_z, t_hint).y;

            let dz = next_z - current_z;
            let dy = next_y - prev_y;
            let ds = (dz * dz + dy * dy).sqrt();

            current_s += ds;
            current_z = next_z;
            prev_y = next_y;

            z_values.push(current_z);
            s_values.push(current_s);
        }

        // Final fractional step to reach exactly tip_z
        if current_z < tip_z {
            let next_y = super::evaluate_bezier_at_z(rocker, tip_z, 1.0).y;
            let dz = tip_z - current_z;
            let dy = next_y - prev_y;
            let ds = (dz * dz + dy * dy).sqrt();

            current_s += ds;
            z_values.push(tip_z);
            s_values.push(current_s);
        }

        let total_length = current_s;

        Self {
            z_values,
            s_values,
            total_length,
        }
    }

    /// Maps a curvilinear distance S (measured from the Tail, Z positive) back to a flat Cartesian Z.
    pub fn map_s_to_z(&self, s_from_tail: f32) -> f32 {
        let s_from_nose = (self.total_length - s_from_tail).clamp(0.0, self.total_length);

        // Binary search to find the lower-bound index in our S table
        let mut low = 0;
        let mut high = self.s_values.len() - 1;

        while low < high {
            let mid = (low + high) / 2;
            if self.s_values[mid] < s_from_nose {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        let idx = low.clamp(1, self.s_values.len() - 1);
        let s0 = self.s_values[idx - 1];
        let s1 = self.s_values[idx];
        let z0 = self.z_values[idx - 1];
        let z1 = self.z_values[idx];

        let ds = s1 - s0;
        if ds < 1e-5 {
            return z0;
        }

        let frac = (s_from_nose - s0) / ds;
        z0 + frac * (z1 - z0)
    }

    /// Maps an absolute Cartesian Z back to its curvilinear running distance S (measured from the Tail).
    pub fn map_z_to_s(&self, target_z: f32) -> f32 {
        // Binary search to find the lower-bound index in our Z table (Z values are sorted ascending)
        let mut low = 0;
        let mut high = self.z_values.len() - 1;

        while low < high {
            let mid = (low + high) / 2;
            if self.z_values[mid] < target_z {
                low = mid + 1;
            } else {
                high = mid;
            }
        }

        let idx = low.clamp(1, self.z_values.len() - 1);
        let z0 = self.z_values[idx - 1];
        let z1 = self.z_values[idx];
        let s0 = self.s_values[idx - 1];
        let s1 = self.s_values[idx];

        let dz = z1 - z0;
        if dz < 1e-5 {
            return (self.total_length - s0).max(0.0);
        }

        let frac = (target_z - z0) / dz;
        let s_from_nose = s0 + frac * (s1 - s0);

        (self.total_length - s_from_nose).max(0.0)
    }
}
