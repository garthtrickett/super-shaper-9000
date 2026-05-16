use crate::mesh::surface::SurfaceGrid;

pub fn compute_volume(grid: &SurfaceGrid) -> f32 {
    if grid.is_empty() || grid[0].is_empty() {
        return 0.0;
    }

    let segments_v = grid.len() - 1;
    let num_cols = grid[0].len();
    let mut total_volume_cubic_feet = 0.0;

    for i in 0..segments_v {
        let z0 = grid[i][0].pos.z;
        let z1 = grid[i + 1][0].pos.z;
        let dz = (z1 - z0).abs();

        let mut area0 = 0.0;
        let mut area1 = 0.0;

        for j in 0..num_cols {
            let next_j = (j + 1) % num_cols;
            let p0_a = grid[i][j].pos;
            let p0_b = grid[i][next_j].pos;
            area0 += p0_a.x * p0_b.y - p0_b.x * p0_a.y;

            let p1_a = grid[i + 1][j].pos;
            let p1_b = grid[i + 1][next_j].pos;
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
    use crate::mesh::surface::SurfacePoint;
    use glam::Vec3;

    #[test]
    fn test_compute_volume_box() {
        // A simple 1x1x1 box in coordinate space.
        // Z from 0 to 1
        // Cross section is a square from (-0.5, -0.5) to (0.5, 0.5). Area = 1.0.
        // Volume should be 1.0 cubic unit * 28.3168 Liters

        let make_ring = |z: f32| -> Vec<SurfacePoint> {
            vec![
                SurfacePoint {
                    pos: Vec3::new(-0.5, -0.5, z),
                    color: Vec3::ZERO,
                    u_tex: 0.0,
                    v_coord: 0.0,
                    abs_u: 0.0,
                },
                SurfacePoint {
                    pos: Vec3::new(0.5, -0.5, z),
                    color: Vec3::ZERO,
                    u_tex: 0.0,
                    v_coord: 0.0,
                    abs_u: 0.0,
                },
                SurfacePoint {
                    pos: Vec3::new(0.5, 0.5, z),
                    color: Vec3::ZERO,
                    u_tex: 0.0,
                    v_coord: 0.0,
                    abs_u: 0.0,
                },
                SurfacePoint {
                    pos: Vec3::new(-0.5, 0.5, z),
                    color: Vec3::ZERO,
                    u_tex: 0.0,
                    v_coord: 0.0,
                    abs_u: 0.0,
                },
            ]
        };

        let grid: SurfaceGrid = vec![make_ring(0.0), make_ring(1.0)];

                let vol = compute_volume(&grid);
        assert!((vol - 28.3168).abs() < 1e-4);
    }

    #[test]
    fn test_compute_volume_wedge() {
        // A wedge that linearly tapers from a 2x2 square to a 2x0 line.
        // Z from 0 to 1
        // Area at Z=0 is 4.0. Area at Z=1 is 0.0.
        // Trapezoidal integration: (4 + 0) / 2 * 1.0 = 2.0 cubic units.
        
        let make_ring = |z: f32, width: f32, height: f32| -> Vec<SurfacePoint> {
            vec![
                SurfacePoint { pos: Vec3::new(-width/2.0, 0.0, z), color: Vec3::ZERO, u_tex: 0.0, v_coord: 0.0, abs_u: 0.0 },
                SurfacePoint { pos: Vec3::new(width/2.0, 0.0, z), color: Vec3::ZERO, u_tex: 0.0, v_coord: 0.0, abs_u: 0.0 },
                SurfacePoint { pos: Vec3::new(width/2.0, height, z), color: Vec3::ZERO, u_tex: 0.0, v_coord: 0.0, abs_u: 0.0 },
                SurfacePoint { pos: Vec3::new(-width/2.0, height, z), color: Vec3::ZERO, u_tex: 0.0, v_coord: 0.0, abs_u: 0.0 },
            ]
        };

        let grid: SurfaceGrid = vec![
            make_ring(0.0, 2.0, 2.0),
            make_ring(1.0, 2.0, 0.0),
        ];

        let vol = compute_volume(&grid);
        // Expected liters: 2.0 * 28.3168 = 56.6336
        assert!((vol - 56.6336).abs() < 1e-3, "Volume mismatch: got {}", vol);
    }
}
