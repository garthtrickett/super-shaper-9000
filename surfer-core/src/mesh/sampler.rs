use crate::geometry::{
    evaluate_bezier_at_z, evaluate_curve, evaluate_notch_inner_x, find_apex_t,
    get_cross_section_blend_at_z,
};
use crate::model::BoardModel;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_z_rings_with_wings() {
        use crate::model::{BezierCurveData, BoardModel, OutlineLayer};
        use glam::Vec3;

        let mut model = BoardModel::default();
        model.length = 100.0;

        let outline = BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents1: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            tangents2: vec![Vec3::new(10.0, 0.0, 0.0), Vec3::new(10.0, 0.0, 100.0)],
            weights: None,
            ..Default::default()
        };
        model.outline = Some(outline.clone());

        let wing_ext = BezierCurveData {
            control_points: vec![Vec3::new(8.0, 0.0, 70.0), Vec3::new(8.0, 0.0, 80.0)],
            tangents1: vec![Vec3::new(8.0, 0.0, 70.0), Vec3::new(8.0, 0.0, 80.0)],
            tangents2: vec![Vec3::new(8.0, 0.0, 70.0), Vec3::new(8.0, 0.0, 80.0)],
            weights: None,
            ..Default::default()
        };

        model.outline_layers = Some(vec![OutlineLayer {
            name: "Wing".to_string(),
            active: true,
            otl_ext: wing_ext,
            otl_int: BezierCurveData::default(),
        }]);

        let z_rings = compute_z_rings(
            &model,
            &crate::model::DirtyState::default(),
            &crate::mesh::MeshCache::default(),
            0.0,
            100.0,
            &outline,
        );

        // Assert that the cliff coordinates were injected around Z=70 and Z=80
        assert!(
            z_rings.iter().any(|&z| (z - (70.0 - 1e-3)).abs() < 1e-5),
            "Missing cliff approach at 70"
        );
        assert!(
            z_rings.iter().any(|&z| (z - 70.0).abs() < 1e-5),
            "Missing cliff at 70"
        );
        assert!(
            z_rings.iter().any(|&z| (z - (70.0 + 1e-3)).abs() < 1e-5),
            "Missing cliff departure at 70"
        );

        assert!(
            z_rings.iter().any(|&z| (z - (80.0 - 1e-3)).abs() < 1e-5),
            "Missing cliff approach at 80"
        );
        assert!(
            z_rings.iter().any(|&z| (z - 80.0).abs() < 1e-5),
            "Missing cliff at 80"
        );
        assert!(
            z_rings.iter().any(|&z| (z - (80.0 + 1e-3)).abs() < 1e-5),
            "Missing cliff departure at 80"
        );
    }

    #[test]
    fn test_u_column_struct_properties() {
        let col = crate::mesh::UColumn {
            norm_u: 0.5,
            side: -1.0,
            is_stringer: false,
            u_tex: 0.25,
        };
        assert_eq!(col.norm_u, 0.5);
        assert_eq!(col.side, -1.0);
        assert_eq!(col.is_stringer, false);
        assert_eq!(col.u_tex, 0.25);
    }

    #[test]
    fn test_abs_u_to_norm_u_and_back() {
        let t_tuck = 0.2;
        let t_apex = 0.4;
        let t_shoulder = 0.7;

        let u_val = 0.3;
        let norm = abs_u_to_norm_u(u_val, t_tuck, t_apex, t_shoulder);
        let back = norm_u_to_abs_u(norm, t_tuck, t_apex, t_shoulder);
        assert!((back - u_val).abs() < 1e-5);
    }
}

pub fn abs_u_to_norm_u(abs_u: f32, t_tuck: f32, t_apex: f32, t_shoulder: f32) -> f32 {
    if abs_u <= t_tuck {
        if t_tuck > 0.0 {
            (abs_u / t_tuck) * 0.25
        } else {
            0.0
        }
    } else if abs_u <= t_apex {
        if t_apex > t_tuck {
            0.25 + ((abs_u - t_tuck) / (t_apex - t_tuck)) * 0.25
        } else {
            0.25
        }
    } else if abs_u <= t_shoulder {
        if t_shoulder > t_apex {
            0.5 + ((abs_u - t_apex) / (t_shoulder - t_apex)) * 0.25
        } else {
            0.5
        }
    } else if 1.0 > t_shoulder {
        0.75 + ((abs_u - t_shoulder) / (1.0 - t_shoulder)) * 0.25
    } else {
        0.75
    }
}

pub fn norm_u_to_abs_u(norm_u: f32, t_tuck: f32, t_apex: f32, t_shoulder: f32) -> f32 {
    if norm_u <= 0.25 {
        t_tuck * (norm_u / 0.25)
    } else if norm_u <= 0.5 {
        t_tuck + (t_apex - t_tuck) * ((norm_u - 0.25) / 0.25)
    } else if norm_u <= 0.75 {
        t_apex + (t_shoulder - t_apex) * ((norm_u - 0.5) / 0.25)
    } else {
        t_shoulder + (1.0 - t_shoulder) * ((norm_u - 0.75) / 0.25)
    }
}

pub fn compute_z_rings(
    model: &BoardModel,
    dirty: &crate::model::DirtyState,
    cache: &crate::mesh::MeshCache,
    nose_z: f32,
    tip_z: f32,
    outline: &crate::model::BezierCurveData,
) -> Vec<f32> {
    let mut all_z = Vec::new();
    let tolerance_degrees = 3.0;
    let min_dist = 0.5;

    if !dirty.global_rebuild && !cache.z_rings.is_empty() {
        for &z in &cache.z_rings {
            let is_dirty = dirty
                .dirty_z_ranges
                .iter()
                .any(|&(min_z, max_z)| z >= min_z && z <= max_z);
            if !is_dirty {
                all_z.push(z);
            }
        }
    }

    let mut cliff_zs = Vec::new();
    if let Some(layers) = &model.outline_layers {
        for layer in layers {
            if !layer.active {
                continue;
            }
            if !layer.otl_ext.control_points.is_empty() {
                let first_z = layer.otl_ext.control_points.first().unwrap().z;
                let last_z = layer.otl_ext.control_points.last().unwrap().z;
                cliff_zs.push(first_z.min(last_z));
                cliff_zs.push(first_z.max(last_z));
            }
        }
    }

    let mut sample_curve = |curve: &crate::model::BezierCurveData| {
        for t in crate::bezier::adaptive_sample_t(curve, tolerance_degrees, min_dist) {
            let z = evaluate_curve(curve, t).z;
            if dirty.global_rebuild
                || dirty
                    .dirty_z_ranges
                    .iter()
                    .any(|&(min_z, max_z)| z >= min_z && z <= max_z)
            {
                all_z.push(z);
            }
        }
    };

    if dirty.global_rebuild || !dirty.dirty_z_ranges.is_empty() {
        if let Some(r_top) = &model.rocker_top {
            sample_curve(r_top);
        }
        if let Some(r_bot) = &model.rocker_bottom {
            sample_curve(r_bot);
        }
        sample_curve(outline);

        if let Some(layers) = &model.outline_layers {
            for layer in layers {
                if !layer.active {
                    continue;
                }
                if !layer.otl_ext.control_points.is_empty() {
                    sample_curve(&layer.otl_ext);
                }
                if !layer.otl_int.control_points.is_empty() {
                    sample_curve(&layer.otl_int);
                }
            }
        }

        if dirty.global_rebuild
            || dirty
                .dirty_z_ranges
                .iter()
                .any(|&(min_z, max_z)| nose_z >= min_z && nose_z <= max_z)
        {
            all_z.push(nose_z);
        }
        if dirty.global_rebuild
            || dirty
                .dirty_z_ranges
                .iter()
                .any(|&(min_z, max_z)| tip_z >= min_z && tip_z <= max_z)
        {
            all_z.push(tip_z);
        }

        for &cz in &cliff_zs {
            if dirty.global_rebuild
                || dirty
                    .dirty_z_ranges
                    .iter()
                    .any(|&(min_z, max_z)| cz >= min_z && cz <= max_z)
            {
                all_z.push(cz - 1e-3);
                all_z.push(cz);
                all_z.push(cz + 1e-3);
            }
        }

        // Inject baseline density of evenly spaced Z-rings to get smooth topographic contours
        let baseline_steps = 120;
        for i in 0..=baseline_steps {
            let f = i as f32 / baseline_steps as f32;
            let z = nose_z + (tip_z - nose_z) * f;
            if dirty.global_rebuild
                || dirty
                    .dirty_z_ranges
                    .iter()
                    .any(|&(min_z, max_z)| z >= min_z && z <= max_z)
            {
                all_z.push(z);
            }
        }
    }

    all_z.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut z_rings = Vec::new();
    for z in all_z {
        let clamped = z.clamp(nose_z, tip_z);
        if z_rings.is_empty() {
            z_rings.push(clamped);
        } else {
            let last_z = *z_rings.last().unwrap();
            let diff = clamped - last_z;
            let is_cliff = cliff_zs
                .iter()
                .any(|&cz| (clamped - cz).abs() <= 1.5e-3 || (last_z - cz).abs() <= 1.5e-3);

            if diff > 0.1 || (is_cliff && diff >= 1e-4) {
                z_rings.push(clamped);
            }
        }
    }

    if let Some(last) = z_rings.last_mut() {
        if (tip_z - *last).abs() > 1e-4 {
            if tip_z - *last <= 0.1 {
                *last = tip_z;
            } else {
                z_rings.push(tip_z);
            }
        }
    }

    z_rings
}

pub fn compute_u_columns(
    model: &BoardModel,
    dirty: &crate::model::DirtyState,
    cache: &crate::mesh::MeshCache,
    z_rings: &[f32],
    outline: &crate::model::BezierCurveData,
    notch_z: f32,
    v_tip: f32,
) -> Vec<crate::mesh::UColumn> {
    if !dirty.global_rebuild && !cache.u_columns.is_empty() && dirty.dirty_z_ranges.is_empty() {
        return cache.u_columns.clone();
    }

    let critical_norm_us = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    let mut adaptive_norm_us = Vec::new();
    let tolerance_degrees_u = 3.0;
    let min_dist_u = 0.05;

    let default_cs = crate::model::BezierCurveData::default();
    let mut primary_cs = model.cross_sections.first().unwrap_or(&default_cs);
    let mut max_width = 0.0;
    for cs in &model.cross_sections {
        let w = cs.control_points.iter().fold(0.0_f32, |m, p| m.max(p.x));
        if w > max_width {
            max_width = w;
            primary_cs = cs;
        }
    }

    let prim_t_apex = find_apex_t(primary_cs);
    let prim_t_tuck = primary_cs
        .tuck_ratio
        .unwrap_or_else(|| 0.01_f32.max(prim_t_apex * 0.5));
    let prim_t_shoulder = prim_t_apex + (1.0 - prim_t_apex) * 0.5;

    for u in crate::bezier::adaptive_sample_t(primary_cs, tolerance_degrees_u, min_dist_u) {
        adaptive_norm_us.push(abs_u_to_norm_u(
            u,
            prim_t_tuck,
            prim_t_apex,
            prim_t_shoulder,
        ));
    }

    let mut u_params_half = critical_norm_us.clone();
    for norm_u in adaptive_norm_us {
        if !critical_norm_us
            .iter()
            .any(|&cu| (norm_u - cu).abs() < 0.01)
        {
            u_params_half.push(norm_u);
        }
    }
    u_params_half.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let mut final_base_u = Vec::new();
    for u in u_params_half {
        if final_base_u.is_empty() {
            final_base_u.push(u);
        } else {
            let last = *final_base_u.last().unwrap();
            let is_critical = critical_norm_us.iter().any(|&cu| (u - cu).abs() < 1e-5);
            if is_critical || u - last > 0.01 {
                final_base_u.push(u);
            }
        }
    }
    let mut u_params_half = final_base_u;

    let mut cliff_norm_us: Vec<f32> = Vec::new();
    if let Some(channels) = &model.bottom_channels {
        for channel in channels {
            let outlines = [&channel.left_outline, &channel.right_outline];
            for outline_curve in outlines {
                if outline_curve.control_points.is_empty() {
                    continue;
                }
                for z in z_rings {
                    let min_z = outline_curve.control_points.first().unwrap().z;
                    let max_z = outline_curve.control_points.last().unwrap().z;
                    if *z >= min_z - 1e-3 && *z <= max_z + 1e-3 {
                        let chan_x = evaluate_bezier_at_z(outline_curve, *z, 0.5).x;
                        let blend = get_cross_section_blend_at_z(&model.cross_sections, *z);
                        if let Some(b) = &blend {
                            let _inner_x = if *z > notch_z {
                                evaluate_notch_inner_x(outline, v_tip, *z)
                            } else {
                                0.0
                            };

                            let ctx = crate::geometry::ZRingContext::new(model, *z);
                            let target_x = chan_x.abs();
                            let u_search = crate::geometry::solve_u_for_target_x(
                                |u| ctx.get_point_at_uv_base(u, 1.0).x - target_x,
                                0.0,
                                b.t_apex,
                                1e-4,
                                15,
                            );

                            let t_tuck = 0.01_f32.max(b.t_apex * 0.5);
                            let t_shoulder = b.t_apex + (1.0 - b.t_apex) * 0.5;
                            let norm_u = abs_u_to_norm_u(u_search, t_tuck, b.t_apex, t_shoulder);
                            cliff_norm_us.push(norm_u);
                        }
                    }
                }
            }
        }
    }

    for cu in cliff_norm_us {
        u_params_half.push((cu - 0.0001).max(0.0));
        u_params_half.push(cu);
        u_params_half.push((cu + 0.0001).min(1.0));
    }

    u_params_half.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut final_u = Vec::new();
    for u in u_params_half {
        if final_u.is_empty() || u - final_u.last().unwrap() > 0.00005 {
            final_u.push(u);
        }
    }
    u_params_half = final_u;

    let cs_arc_table = if !model.cross_sections.is_empty() {
        crate::bezier::build_arc_length_table(primary_cs, 200)
    } else {
        Vec::new()
    };

    let total_cs_len = cs_arc_table.last().map(|(_, l)| *l).unwrap_or(0.0);

    let get_u_tex = |norm_u: f32| -> f32 {
        let t_val = norm_u_to_abs_u(norm_u, prim_t_tuck, prim_t_apex, prim_t_shoulder);
        if total_cs_len <= 1e-5 || cs_arc_table.is_empty() {
            return t_val;
        }
        let mut len_at_t = 0.0;
        for i in 0..cs_arc_table.len() - 1 {
            let (t0, l0) = cs_arc_table[i];
            let (t1, l1) = cs_arc_table[i + 1];
            if t_val >= t0 && t_val <= t1 {
                let frac = if t1 > t0 {
                    (t_val - t0) / (t1 - t0)
                } else {
                    0.0
                };
                len_at_t = l0 + frac * (l1 - l0);
                break;
            }
        }
        if t_val >= 1.0 {
            len_at_t = total_cs_len;
        }
        len_at_t / total_cs_len
    };

    let mut u_columns = Vec::new();
    let half = u_params_half.len() - 1;
    for (idx, &u) in u_params_half.iter().enumerate() {
        let is_stringer = idx == 0 || idx == half;
        u_columns.push(crate::mesh::UColumn {
            norm_u: u,
            side: 1.0,
            is_stringer,
            u_tex: get_u_tex(u),
        });
    }
    for (idx, &u) in u_params_half.iter().rev().enumerate() {
        let is_stringer = idx == 0 || idx == half;
        u_columns.push(crate::mesh::UColumn {
            norm_u: u,
            side: -1.0,
            is_stringer,
            u_tex: get_u_tex(u),
        });
    }

    u_columns
}
