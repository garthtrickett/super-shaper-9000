pub fn compute_volume(vertices: &[f32], segments_v: usize, num_cols: usize) -> f32 {
    if segments_v == 0 || num_cols == 0 {
        return 0.0;
    }

    let mut total_volume_cubic_feet = 0.0;

    let get_pos = |i: usize, j: usize| {
        let idx = (i * num_cols + j) * 3;
        glam::Vec3::new(vertices[idx], vertices[idx + 1], vertices[idx + 2])
    };

    for i in 0..segments_v {
        let z0 = get_pos(i, 0).z;
        let z1 = get_pos(i + 1, 0).z;
        let dz = (z1 - z0).abs();

        let mut area0 = 0.0;
        let mut area1 = 0.0;

        for j in 0..num_cols {
            let next_j = (j + 1) % num_cols;
            let p0_a = get_pos(i, j);
            let p0_b = get_pos(i, next_j);
            area0 += p0_a.x * p0_b.y - p0_b.x * p0_a.y;

            let p1_a = get_pos(i + 1, j);
            let p1_b = get_pos(i + 1, next_j);
            area1 += p1_a.x * p1_b.y - p1_b.x * p1_a.y;
        }

        area0 = area0.abs() * 0.5;
        area1 = area1.abs() * 0.5;

        // Trapezoidal integration across Z
        total_volume_cubic_feet += (area0 + area1) / 2.0 * dz;
    }

    // 1 cubic foot = 28.3168 Liters
    total_volume_cubic_feet * 28.3168
}

#[cfg(test)]
mod tests {
    use super::*;

        #[test]
    fn test_compute_volume_box() {
        let mut vertices = Vec::new();
        let num_cols = 4;
        let segments_v = 1;

        let push_ring = |v: &mut Vec<f32>, z: f32| {
            v.extend_from_slice(&[-0.5, -0.5, z]);
            v.extend_from_slice(&[0.5, -0.5, z]);
            v.extend_from_slice(&[0.5, 0.5, z]);
            v.extend_from_slice(&[-0.5, 0.5, z]);
        };

        push_ring(&mut vertices, 0.0);
        push_ring(&mut vertices, 1.0);

        let vol = compute_volume(&vertices, segments_v, num_cols);
        assert!((vol - 28.3168).abs() < 1e-4);
    }

        #[test]
    fn test_compute_volume_wedge() {
        let mut vertices = Vec::new();
        let num_cols = 4;
        let segments_v = 1;

        let push_ring = |v: &mut Vec<f32>, z: f32, width: f32, height: f32| {
            v.extend_from_slice(&[-width / 2.0, 0.0, z]);
            v.extend_from_slice(&[width / 2.0, 0.0, z]);
            v.extend_from_slice(&[width / 2.0, height, z]);
            v.extend_from_slice(&[-width / 2.0, height, z]);
        };

        push_ring(&mut vertices, 0.0, 2.0, 2.0);
        push_ring(&mut vertices, 1.0, 2.0, 0.0);

        let vol = compute_volume(&vertices, segments_v, num_cols);
        assert!((vol - 56.6336).abs() < 1e-3, "Volume mismatch: got {}", vol);
    }
}
