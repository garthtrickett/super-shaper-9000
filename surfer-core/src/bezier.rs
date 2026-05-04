use glam::Vec3;
use crate::model::BezierCurveData;

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

/// Samples a composite Bezier curve with `steps` resolution. 
/// Replicates the TypeScript `sampleBezierCurve` logic identically.
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
pub fn evaluate_curvature_quill(p0: Vec3, t0: Vec3, t1: Vec3, p1: Vec3, t: f32, scale: f32) -> Vec3 {
    let d1 = evaluate_bezier_first_derivative(p0, t0, t1, p1, t);
    let d2 = evaluate_bezier_second_derivative(p0, t0, t1, p1, t);

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

    n * kappa * scale
}

/// Samples a composite Bezier curve with `steps` resolution. 
/// Replicates the TypeScript `sampleBezierCurve` logic identically.
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

        pts.push(evaluate_bezier_cubic(p0, t0, t1, p1, local_t));
    }
    pts
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::Vec3;

    #[test]
    fn test_derivatives_and_curvature() {
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p1 = Vec3::new(3.0, 0.0, 0.0);
        
        // 1. Straight line
        let t0_straight = Vec3::new(1.0, 0.0, 0.0);
        let t1_straight = Vec3::new(2.0, 0.0, 0.0);
        
        let d2_straight = evaluate_bezier_second_derivative(p0, t0_straight, t1_straight, p1, 0.5);
        assert_eq!(d2_straight, Vec3::ZERO);
        
        let quill_straight = evaluate_curvature_quill(p0, t0_straight, t1_straight, p1, 0.5, 1.0);
        assert_eq!(quill_straight, Vec3::ZERO);
        
        // 2. Bent curve
        let t0_bent = Vec3::new(1.0, 1.0, 0.0);
        let t1_bent = Vec3::new(2.0, 1.0, 0.0);
        
        let d1_bent = evaluate_bezier_first_derivative(p0, t0_bent, t1_bent, p1, 0.5);
        let quill_bent = evaluate_curvature_quill(p0, t0_bent, t1_bent, p1, 0.5, 1.0);
        
        // The magnitude of the quill should be greater than 0 since the curve is bent
        assert!(quill_bent.length() > 0.0, "Curvature quill should be non-zero for a bent curve");
        
        // The dot product of the first derivative and principal normal (quill) should be 0 (perpendicular)
        assert!(d1_bent.dot(quill_bent).abs() < 1e-5, "Quill should be perpendicular to tangent");
        
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
        };

        let samples = sample_curve(&curve, 2);
        assert_eq!(samples.len(), 3);
        
        assert_eq!(samples[0].x, 0.0);
        assert_eq!(samples[1].x, 5.0);
        assert_eq!(samples[2].x, 10.0);
        println!("✅ sample_curve passed and generated expected vertex distribution.");
    }
}
