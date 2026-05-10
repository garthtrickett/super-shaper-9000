use crate::model::BezierCurveData;
use glam::Vec3;

/// Evaluates a 3D Cubic Bezier curve at a given `t` (0.0 to 1.0) using SIMD-backed `glam::Vec3`.
#[inline]
pub fn evaluate_bezier_cubic(p0: Vec3, t0: Vec3, t1: Vec3, p1: Vec3, t: f32) -> Vec3 {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    let uuu = uu * u;
    let ttt = tt * t;

    (p0 * uuu) + (t0 * (3.0 * uu * t)) + (t1 * (3.0 * u * tt)) + (p1 * ttt)
}

/// Evaluates a 3D Cubic Hermite spline at a given `t` (0.0 to 1.0).
/// Used for smoothly interpolating between cross-sections along the Z-axis.
#[inline]
pub fn evaluate_cubic_hermite(p1: Vec3, p2: Vec3, m1: Vec3, m2: Vec3, t: f32) -> Vec3 {
    let t2 = t * t;
    let t3 = t2 * t;

    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;

    p1 * h00 + m1 * h10 + p2 * h01 + m2 * h11
}

/// Evaluates the first derivative of a 3D Cubic Hermite spline at a given `t` (0.0 to 1.0).
#[inline]
pub fn evaluate_cubic_hermite_derivative(p1: Vec3, p2: Vec3, m1: Vec3, m2: Vec3, t: f32) -> Vec3 {
    let t2 = t * t;

    let dh00 = 6.0 * t2 - 6.0 * t;
    let dh10 = 3.0 * t2 - 4.0 * t + 1.0;
    let dh01 = -6.0 * t2 + 6.0 * t;
    let dh11 = 3.0 * t2 - 2.0 * t;

    p1 * dh00 + m1 * dh10 + p2 * dh01 + m2 * dh11
}

/// Evaluates a Rational 3D Cubic Bezier curve at a given `t` (0.0 to 1.0)
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn evaluate_rational_bezier_cubic(
    p0: Vec3,
    t0: Vec3,
    t1: Vec3,
    p1: Vec3,
    w0: f32,
    w1: f32,
    w2: f32,
    w3: f32,
    t: f32,
) -> Vec3 {
    let u = 1.0 - t;
    let tt = t * t;
    let uu = u * u;
    let uuu = uu * u;
    let ttt = tt * t;

    let b0 = uuu;
    let b1 = 3.0 * uu * t;
    let b2 = 3.0 * u * tt;
    let b3 = ttt;

    let n = (p0 * (b0 * w0)) + (t0 * (b1 * w1)) + (t1 * (b2 * w2)) + (p1 * (b3 * w3));
    let d = (b0 * w0) + (b1 * w1) + (b2 * w2) + (b3 * w3);

    n / d
}

/// Evaluates the first derivative of a Rational 3D Cubic Bezier curve at `t`
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn evaluate_rational_first_derivative(
    p0: Vec3,
    t0: Vec3,
    t1: Vec3,
    p1: Vec3,
    w0: f32,
    w1: f32,
    w2: f32,
    w3: f32,
    t: f32,
) -> Vec3 {
    let u = 1.0 - t;
    let uu = u * u;
    let tt = t * t;
    let tu = t * u;

    let b0_3 = uu * u;
    let b1_3 = 3.0 * uu * t;
    let b2_3 = 3.0 * u * tt;
    let b3_3 = t * tt;

    let b0_2 = uu;
    let b1_2 = 2.0 * tu;
    let b2_2 = tt;

    let p = (p0 * (b0_3 * w0)) + (t0 * (b1_3 * w1)) + (t1 * (b2_3 * w2)) + (p1 * (b3_3 * w3));
    let d = (b0_3 * w0) + (b1_3 * w1) + (b2_3 * w2) + (b3_3 * w3);
    let pt = p / d;

    let n_prime = (t0 * w1 - p0 * w0) * (3.0 * b0_2)
        + (t1 * w2 - t0 * w1) * (3.0 * b1_2)
        + (p1 * w3 - t1 * w2) * (3.0 * b2_2);

    let d_prime = (w1 - w0) * (3.0 * b0_2) + (w2 - w1) * (3.0 * b1_2) + (w3 - w2) * (3.0 * b2_2);

    (n_prime - pt * d_prime) / d
}

/// Evaluates the second derivative of a Rational 3D Cubic Bezier curve at `t`
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn evaluate_rational_second_derivative(
    p0: Vec3,
    t0: Vec3,
    t1: Vec3,
    p1: Vec3,
    w0: f32,
    w1: f32,
    w2: f32,
    w3: f32,
    t: f32,
) -> Vec3 {
    let u = 1.0 - t;
    let uu = u * u;
    let tt = t * t;
    let tu = t * u;

    let b0_3 = uu * u;
    let b1_3 = 3.0 * uu * t;
    let b2_3 = 3.0 * u * tt;
    let b3_3 = t * tt;

    let b0_2 = uu;
    let b1_2 = 2.0 * tu;
    let b2_2 = tt;

    let b0_1 = u;
    let b1_1 = t;

    let p = (p0 * (b0_3 * w0)) + (t0 * (b1_3 * w1)) + (t1 * (b2_3 * w2)) + (p1 * (b3_3 * w3));
    let d = (b0_3 * w0) + (b1_3 * w1) + (b2_3 * w2) + (b3_3 * w3);
    let pt = p / d;

    let n_prime = (t0 * w1 - p0 * w0) * (3.0 * b0_2)
        + (t1 * w2 - t0 * w1) * (3.0 * b1_2)
        + (p1 * w3 - t1 * w2) * (3.0 * b2_2);

    let d_prime = (w1 - w0) * (3.0 * b0_2) + (w2 - w1) * (3.0 * b1_2) + (w3 - w2) * (3.0 * b2_2);

    let pt_prime = (n_prime - pt * d_prime) / d;

    let n_double_prime = (t1 * w2 - t0 * w1 * 2.0 + p0 * w0) * (6.0 * b0_1)
        + (p1 * w3 - t1 * w2 * 2.0 + t0 * w1) * (6.0 * b1_1);

    let d_double_prime = (w2 - w1 * 2.0 + w0) * (6.0 * b0_1) + (w3 - w2 * 2.0 + w1) * (6.0 * b1_1);

    (n_double_prime - pt_prime * (2.0 * d_prime) - pt * d_double_prime) / d
}

/// Evaluates the first derivative of a 3D Cubic Bezier curve at a given `t` (0.0 to 1.0)
#[inline]
pub fn evaluate_bezier_first_derivative(p0: Vec3, t0: Vec3, t1: Vec3, p1: Vec3, t: f32) -> Vec3 {
    let u = 1.0 - t;
    let uu = u * u;
    let tt = t * t;
    let tu = t * u;

    (t0 - p0) * (3.0 * uu) + (t1 - t0) * (6.0 * tu) + (p1 - t1) * (3.0 * tt)
}

/// Evaluates the second derivative of a 3D Cubic Bezier curve at a given `t` (0.0 to 1.0)
#[inline]
pub fn evaluate_bezier_second_derivative(p0: Vec3, t0: Vec3, t1: Vec3, p1: Vec3, t: f32) -> Vec3 {
    let u = 1.0 - t;

    (t1 - t0 * 2.0 + p0) * (6.0 * u) + (p1 - t1 * 2.0 + t0) * (6.0 * t)
}

/// Computes the curvature quill (principal normal scaled by curvature magnitude) at a given `t`
#[inline]
pub fn evaluate_curvature_quill(
    p0: Vec3,
    t0: Vec3,
    t1: Vec3,
    p1: Vec3,
    weights: Option<(f32, f32, f32, f32)>,
    t: f32,
    scale: f32,
) -> Vec3 {
    let (d1, d2) = if let Some((w0, w1, w2, w3)) = weights {
        (
            evaluate_rational_first_derivative(p0, t0, t1, p1, w0, w1, w2, w3, t),
            evaluate_rational_second_derivative(p0, t0, t1, p1, w0, w1, w2, w3, t),
        )
    } else {
        (
            evaluate_bezier_first_derivative(p0, t0, t1, p1, t),
            evaluate_bezier_second_derivative(p0, t0, t1, p1, t),
        )
    };

    let d1_len_sq = d1.length_squared();
    if d1_len_sq < 1e-6 {
        return Vec3::ZERO;
    }

    let cross = d1.cross(d2);
    let cross_len = cross.length();
    if cross_len < 1e-6 {
        return Vec3::ZERO; // Straight line
    }

    let d1_len = d1_len_sq.sqrt();
    let kappa = cross_len / (d1_len_sq * d1_len);
    let n = cross.cross(d1).normalize();

    // Cap the maximum visual length of the quill to prevent screen-spanning spikes on tight corners
    let length = (kappa * scale).min(15.0);

    n * length
}

/// Computes the exact position of a target tangent handle to achieve G2 (Curvature) continuity.
///
/// # Arguments
/// * `anchor` - The knot coordinate ($K$) shared by both curve segments.
/// * `t_source` - The tangent handle of the master segment at $K$.
/// * `f_source` - The *far* tangent handle of the master segment.
/// * `f_target` - The *far* tangent handle of the target segment.
///
/// # Returns
/// The required coordinate for `t_target` to ensure the target segment has the exact
/// same curvature (rate of bend) as the source segment at the anchor point.
#[inline]
pub fn solve_g2_tangent(anchor: Vec3, t_source: Vec3, f_source: Vec3, f_target: Vec3) -> Vec3 {
    let v = t_source - anchor;
    let v_len_sq = v.length_squared();

    // If the source tangent is directly on top of the anchor,
    // curvature is undefined/infinite. Fallback to anchor.
    if v_len_sq < 1e-6 {
        return anchor;
    }

    let cross_src = v.cross(f_source - anchor).length();
    let cross_tgt = v.cross(f_target - anchor).length();

    // If source curvature is ~0 (a straight line or collinear handles)
    if cross_src < 1e-6 {
        // Fall back to standard G1 (mirrored tangent of equal length)
        // because we cannot achieve 0 curvature unless the target is also straight
        return anchor - v;
    }

    // The algebraic solution for matching curvature magnitude
    // between two cubic Bezier segments meeting at G1.
    let c = (cross_tgt / cross_src).sqrt();

    // Clamp multiplier to prevent exploding handles on extreme CAD distortions
    let c_clamped = c.clamp(0.01, 100.0);

    anchor - (v * c_clamped)
}

/// Evaluates the position and tangent (normalized first derivative) of a composite Bezier curve at global `t` (0.0 to 1.0)
#[inline]
pub fn evaluate_composite_pos_and_tangent(curve: &BezierCurveData, t: f32) -> (Vec3, Vec3) {
    let num_segments = curve.control_points.len().saturating_sub(1);
    if num_segments == 0 {
        return (
            curve.control_points.first().copied().unwrap_or(Vec3::ZERO),
            Vec3::X,
        );
    }

    let num_segments_f = num_segments as f32;
    let scaled_t = t * num_segments_f;
    let mut segment_idx = scaled_t.floor() as usize;
    if segment_idx >= num_segments {
        segment_idx = num_segments - 1;
    }

    let local_t = scaled_t - segment_idx as f32;

    let p0 = curve.control_points[segment_idx];
    let p1 = curve.control_points[segment_idx + 1];
    let t0 = curve.tangents2[segment_idx];
    let t1 = curve.tangents1[segment_idx + 1];

    let weights = curve.weights.as_ref().and_then(|w| {
        if w.len() > segment_idx + 1 {
            Some((w[segment_idx], 1.0, 1.0, w[segment_idx + 1]))
        } else {
            None
        }
    });

    let (pos, d1) = if let Some((w0, w1, w2, w3)) = weights {
        (
            evaluate_rational_bezier_cubic(p0, t0, t1, p1, w0, w1, w2, w3, local_t),
            evaluate_rational_first_derivative(p0, t0, t1, p1, w0, w1, w2, w3, local_t),
        )
    } else {
        (
            evaluate_bezier_cubic(p0, t0, t1, p1, local_t),
            evaluate_bezier_first_derivative(p0, t0, t1, p1, local_t),
        )
    };

    let tan = if d1.length_squared() > 1e-6 {
        d1.normalize()
    } else {
        Vec3::X
    };

    (pos, tan)
}

/// Dynamically samples a curve's parameter `t` (0.0 to 1.0) by subdividing areas of high curvature.
/// Returns a sorted, deduplicated list of optimal `t` values.
pub fn adaptive_sample_t(
    curve: &BezierCurveData,
    tolerance_degrees: f32,
    min_dist: f32,
) -> Vec<f32> {
    let mut t_values = Vec::new();
    if curve.control_points.is_empty() {
        return t_values;
    }

    let tolerance_radians = tolerance_degrees.to_radians();
    let max_depth = 8; // Prevent infinite recursion on micro-corners

    t_values.push(0.0);

    #[allow(clippy::too_many_arguments)]
    fn subdivide(
        curve: &BezierCurveData,
        t_start: f32,
        p_start: Vec3,
        tan_start: Vec3,
        t_end: f32,
        p_end: Vec3,
        tan_end: Vec3,
        tolerance_radians: f32,
        min_dist: f32,
        depth: usize,
        max_depth: usize,
        results: &mut Vec<f32>,
    ) {
        let dist = p_start.distance(p_end);

        // Calculate angle between tangents. clamp to[-1, 1] to avoid NaN from float precision drifts.
        let dot = tan_start.dot(tan_end).clamp(-1.0, 1.0);
        let angle = dot.acos();

        // Force at least depth 3 (8 segments base) to ensure we don't skip over massive 180-degree loops or S-curves
        let needs_subdivision = (angle > tolerance_radians && dist > min_dist) || depth < 3;

        if needs_subdivision && depth < max_depth && (t_end - t_start) > 0.0001 {
            let t_mid = (t_start + t_end) / 2.0;
            let (p_mid, tan_mid) = evaluate_composite_pos_and_tangent(curve, t_mid);

            subdivide(
                curve,
                t_start,
                p_start,
                tan_start,
                t_mid,
                p_mid,
                tan_mid,
                tolerance_radians,
                min_dist,
                depth + 1,
                max_depth,
                results,
            );
            subdivide(
                curve,
                t_mid,
                p_mid,
                tan_mid,
                t_end,
                p_end,
                tan_end,
                tolerance_radians,
                min_dist,
                depth + 1,
                max_depth,
                results,
            );
        } else {
            results.push(t_end);
        }
    }

    let (p0, t0) = evaluate_composite_pos_and_tangent(curve, 0.0);
    let (p1, t1) = evaluate_composite_pos_and_tangent(curve, 1.0);

    subdivide(
        curve,
        0.0,
        p0,
        t0,
        1.0,
        p1,
        t1,
        tolerance_radians,
        min_dist,
        0,
        max_depth,
        &mut t_values,
    );

    // Filter floating point overlaps
    t_values.dedup_by(|a, b| (*a - *b).abs() < 1e-5);
    t_values
}

/// Samples a composite Bezier curve with `steps` resolution.
/// Replicates the TypeScript `sampleBezierCurve` logic identically.
/// Builds a table of (t, accumulated_length) for a composite Bezier curve.
/// Uses multi-segment linear approximation which is highly performant and stable.
pub fn build_arc_length_table(curve: &BezierCurveData, steps: usize) -> Vec<(f32, f32)> {
    let mut table = Vec::with_capacity(steps + 1);
    let mut total_length = 0.0;
    let mut last_pt = evaluate_composite_pos_and_tangent(curve, 0.0).0;

    table.push((0.0, 0.0));

    let steps_f = steps as f32;
    for i in 1..=steps {
        let t = i as f32 / steps_f;
        let pt = evaluate_composite_pos_and_tangent(curve, t).0;
        total_length += last_pt.distance(pt);
        table.push((t, total_length));
        last_pt = pt;
    }

    table
}

/// Finds the parameter `t` (0.0 to 1.0) that corresponds to a target arc-length ratio (0.0 to 1.0).
/// Uses binary search on the pre-computed arc-length table.
pub fn get_t_at_arc_length_ratio(table: &[(f32, f32)], target_ratio: f32) -> f32 {
    if table.is_empty() {
        return 0.0;
    }

    let target_ratio = target_ratio.clamp(0.0, 1.0);
    let total_length = table.last().unwrap().1;
    let target_length = target_ratio * total_length;

    if target_length <= 0.0 {
        return 0.0;
    }
    if target_length >= total_length {
        return 1.0;
    }

    // Binary search to find the segment containing the target length
    let mut low = 0;
    let mut high = table.len() - 1;

    while low <= high {
        let mid = low + (high - low) / 2;
        if table[mid].1 < target_length {
            low = mid + 1;
        } else if table[mid].1 > target_length {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        } else {
            return table[mid].0;
        }
    }

    let idx = low.clamp(1, table.len() - 1);
    let (t0, l0) = table[idx - 1];
    let (t1, l1) = table[idx];

    let segment_len = l1 - l0;
    if segment_len <= 1e-6 {
        return t0;
    }

    let fraction = (target_length - l0) / segment_len;
    t0 + fraction * (t1 - t0)
}

pub fn sample_curve(curve: &BezierCurveData, steps: usize) -> Vec<Vec3> {
    let mut pts = Vec::with_capacity(steps + 1);
    let num_segments = curve.control_points.len().saturating_sub(1);
    if num_segments == 0 {
        return pts;
    }

    let num_segments_f = num_segments as f32;
    let steps_f = steps as f32;

    for i in 0..=steps {
        let t = i as f32 / steps_f;
        let scaled_t = t * num_segments_f;
        let mut segment_idx = scaled_t.floor() as usize;
        if segment_idx >= num_segments {
            segment_idx = num_segments - 1;
        }

        let local_t = scaled_t - segment_idx as f32;

        let p0 = curve.control_points[segment_idx];
        let p1 = curve.control_points[segment_idx + 1];
        // t0 is the OUTGOING tangent of P0 (tangents2)
        let t0 = curve.tangents2[segment_idx];
        // t1 is the INCOMING tangent of P1 (tangents1)
        let t1 = curve.tangents1[segment_idx + 1];

        let weights = curve.weights.as_ref().and_then(|w| {
            if w.len() > segment_idx + 1 {
                Some((w[segment_idx], 1.0, 1.0, w[segment_idx + 1]))
            } else {
                None
            }
        });

        let pt = if let Some((w0, w1, w2, w3)) = weights {
            evaluate_rational_bezier_cubic(p0, t0, t1, p1, w0, w1, w2, w3, local_t)
        } else {
            evaluate_bezier_cubic(p0, t0, t1, p1, local_t)
        };

        pts.push(pt);
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;

    #[test]
    fn test_cubic_hermite_z_linearity() {
        // This test proves that while X and Y can curve smoothly, Z remains mathematically
        // linear. This is critical for 3D lofting to prevent self-intersecting meshes.
        let p1 = Vec3::new(0.0, 0.0, 10.0);
        let p2 = Vec3::new(0.0, 0.0, 20.0);

        let dz = 10.0;
        let m1 = Vec3::new(0.0, 0.0, dz);
        let m2 = Vec3::new(0.0, 0.0, dz);

        let mid = evaluate_cubic_hermite(p1, p2, m1, m2, 0.5);
        assert_eq!(
            mid.z, 15.0,
            "Z coordinate must remain perfectly linear to prevent bulging"
        );
        println!("✅ test_cubic_hermite_z_linearity passed.");
    }

    #[test]
    fn test_derivatives_and_curvature() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // 1. Straight line
        let t0_straight = Vec3::new(1.0, 0.0, 0.0);
        let t1_straight = Vec3::new(2.0, 0.0, 0.0);

        let d2_straight = evaluate_bezier_second_derivative(p0, t0_straight, t1_straight, p1, 0.5);
        assert_eq!(d2_straight, Vec3::ZERO);

        let quill_straight =
            evaluate_curvature_quill(p0, t0_straight, t1_straight, p1, None, 0.5, 1.0);
        assert_eq!(quill_straight, Vec3::ZERO);

        // 2. Bent curve
        let t0_bent = Vec3::new(1.0, 1.0, 0.0);
        let t1_bent = Vec3::new(2.0, 1.0, 0.0);

        let d1_bent = evaluate_bezier_first_derivative(p0, t0_bent, t1_bent, p1, 0.5);
        let quill_bent = evaluate_curvature_quill(p0, t0_bent, t1_bent, p1, None, 0.5, 1.0);

        // The magnitude of the quill should be greater than 0 since the curve is bent
        assert!(
            quill_bent.length() > 0.0,
            "Curvature quill should be non-zero for a bent curve"
        );

        // The dot product of the first derivative and principal normal (quill) should be 0 (perpendicular)
        assert!(
            d1_bent.dot(quill_bent).abs() < 1e-5,
            "Quill should be perpendicular to tangent"
        );

        println!("✅ test_derivatives_and_curvature passed.");
    }

    #[test]
    fn test_evaluate_bezier_cubic() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 0.0, 0.0);
        let t1 = Vec3::new(2.0, 0.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // Evaluated exactly at the midpoint
        let mid = evaluate_bezier_cubic(p0, t0, t1, p1, 0.5);

        // A straight line bezier should evaluate precisely to its midpoint
        assert_eq!(mid.x, 1.5);
        assert_eq!(mid.y, 0.0);
        assert_eq!(mid.z, 0.0);
        println!("✅ evaluate_bezier_cubic passed.");
    }

    #[test]
    fn test_sample_curve() {
        let curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };

        let samples = sample_curve(&curve, 2);
        assert_eq!(samples.len(), 3);

        assert_eq!(samples[0].x, 0.0);
        assert_eq!(samples[1].x, 5.0);
        assert_eq!(samples[2].x, 10.0);
        println!("✅ sample_curve passed and generated expected vertex distribution.");
    }

    #[test]
    fn test_solve_g2_tangent() {
        let anchor = Vec3::new(0.0, 0.0, 0.0);

        // Source curve (Left side, evaluates at t=1)
        let f_source = Vec3::new(-2.0, 1.0, 0.0); // A1
        let t_source = Vec3::new(-1.0, 0.0, 0.0); // A2

        // Target curve (Right side, evaluates at t=0)
        let f_target = Vec3::new(2.0, -2.0, 0.0); // B2

        let t_target = solve_g2_tangent(anchor, t_source, f_source, f_target);

        // Expected mathematically: c = sqrt(2). t_target = (sqrt(2), 0, 0)
        let c_expected = 2.0_f32.sqrt();
        assert!((t_target.x - c_expected).abs() < 1e-5);
        assert_eq!(t_target.y, 0.0);
        assert_eq!(t_target.z, 0.0);

        // Verify dynamically using evaluate_curvature_quill
        let quill_src = evaluate_curvature_quill(
            Vec3::new(-3.0, 0.0, 0.0), // Arbitrary A0
            f_source,
            t_source,
            anchor,
            None,
            1.0,
            1.0,
        );

        let quill_tgt = evaluate_curvature_quill(
            anchor,
            t_target,
            f_target,
            Vec3::new(3.0, 0.0, 0.0), // Arbitrary B3
            None,
            0.0,
            1.0,
        );

        // Quills must match in length (curvature magnitude) perfectly across the joint.
        assert!(
            (quill_src.length() - quill_tgt.length()).abs() < 1e-5,
            "G2 Curvatures must match!"
        );

        println!("✅ test_solve_g2_tangent passed.");
    }

    #[test]
    fn test_rational_bezier_equivalence() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 1.0, 0.0);
        let t1 = Vec3::new(2.0, -1.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        let t = 0.3;
        let std_pos = evaluate_bezier_cubic(p0, t0, t1, p1, t);
        let rat_pos = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);

        assert!(
            (std_pos - rat_pos).length() < 1e-5,
            "Rational with weights 1.0 must match Standard"
        );

        let std_d1 = evaluate_bezier_first_derivative(p0, t0, t1, p1, t);
        let rat_d1 = evaluate_rational_first_derivative(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);
        assert!(
            (std_d1 - rat_d1).length() < 1e-5,
            "Rational d1 with weights 1.0 must match Standard"
        );

        let std_d2 = evaluate_bezier_second_derivative(p0, t0, t1, p1, t);
        let rat_d2 = evaluate_rational_second_derivative(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, t);
        assert!(
            (std_d2 - rat_d2).length() < 1e-4,
            "Rational d2 with weights 1.0 must match Standard"
        );
    }

    #[test]
    fn test_rational_weight_pull() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 5.0, 0.0);
        let t1 = Vec3::new(2.0, 5.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        let mid_std = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 1.0, 1.0, 1.0, 1.0, 0.5);

        // Increase weight of P0
        let mid_pulled = evaluate_rational_bezier_cubic(p0, t0, t1, p1, 10.0, 1.0, 1.0, 1.0, 0.5);

        // P0 is at origin, so mid_pulled should be closer to origin than mid_std
        assert!(
            mid_pulled.length() < mid_std.length(),
            "Increasing P0 weight should pull curve towards P0"
        );
    }

    #[test]
    fn test_rational_derivatives_endpoints() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let t0 = Vec3::new(1.0, 1.0, 0.0);
        let t1 = Vec3::new(2.0, -1.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);

        // t = 0
        let d1_start = evaluate_rational_first_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 0.0);
        let d2_start = evaluate_rational_second_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 0.0);
        assert!(
            !d1_start.is_nan() && !d2_start.is_nan(),
            "Derivatives should not be NaN at t=0"
        );

        // t = 1
        let d1_end = evaluate_rational_first_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 1.0);
        let d2_end = evaluate_rational_second_derivative(p0, t0, t1, p1, 2.0, 1.0, 1.0, 3.0, 1.0);
        assert!(
            !d1_end.is_nan() && !d2_end.is_nan(),
            "Derivatives should not be NaN at t=1"
        );
    }

    #[test]
    fn test_adaptive_sampling() {
        // Curve 1: Straight line
        let straight = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };
        let t_straight = adaptive_sample_t(&straight, 5.0, 0.1);
        // With depth < 3 forced, it should split into 8 segments -> 9 points
        assert_eq!(t_straight.len(), 9);

        // Curve 2: Highly bent curve
        let bent = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 10.0, 0.0)],
            tangents2: vec![Vec3::new(0.0, 10.0, 0.0), Vec3::new(10.0, 0.0, 0.0)],
            ..Default::default()
        };
        let t_bent = adaptive_sample_t(&bent, 5.0, 0.1);
        // The bent curve requires more subdivisions to meet the angle tolerance
        assert!(
            t_bent.len() > 9,
            "Bent curve should subdivide heavily compared to a straight curve"
        );

                println!("✅ test_adaptive_sampling passed.");
    }

    #[test]
    fn test_uv_arc_length_uniformity() {
        let curve = BezierCurveData {
            control_points: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 0.0), Vec3::new(20.0, 0.0, 0.0)],
            tangents1: vec![Vec3::new(0.0, 0.0, 0.0), Vec3::new(5.0, 0.0, 0.0), Vec3::new(15.0, 0.0, 0.0)],
            tangents2: vec![Vec3::new(5.0, 0.0, 0.0), Vec3::new(15.0, 0.0, 0.0), Vec3::new(20.0, 0.0, 0.0)],
            ..Default::default()
        };

        // Create a highly asymmetrical parameterization via weights
        let mut asym_curve = curve.clone();
        asym_curve.weights = Some(vec![1.0, 10.0, 1.0]);

        let table = build_arc_length_table(&asym_curve, 1000);
        
        let t25 = get_t_at_arc_length_ratio(&table, 0.25);
        let t50 = get_t_at_arc_length_ratio(&table, 0.50);
        let t75 = get_t_at_arc_length_ratio(&table, 0.75);

        let p0 = evaluate_composite_pos_and_tangent(&asym_curve, 0.0).0;
        let p25 = evaluate_composite_pos_and_tangent(&asym_curve, t25).0;
        let p50 = evaluate_composite_pos_and_tangent(&asym_curve, t50).0;
        let p75 = evaluate_composite_pos_and_tangent(&asym_curve, t75).0;
        let p100 = evaluate_composite_pos_and_tangent(&asym_curve, 1.0).0;

        let d1 = p0.distance(p25);
        let d2 = p25.distance(p50);
        let d3 = p50.distance(p75);
        let d4 = p75.distance(p100);

        let avg = (d1 + d2 + d3 + d4) / 4.0;
        
        // Assert that physical distance between arc-length mapped points is roughly equal
        assert!((d1 - avg).abs() < 0.1, "D1 mismatch: {} vs {}", d1, avg);
        assert!((d2 - avg).abs() < 0.1, "D2 mismatch: {} vs {}", d2, avg);
        assert!((d3 - avg).abs() < 0.1, "D3 mismatch: {} vs {}", d3, avg);
        assert!((d4 - avg).abs() < 0.1, "D4 mismatch: {} vs {}", d4, avg);
        
        println!("✅ test_uv_arc_length_uniformity passed.");
    }
}
