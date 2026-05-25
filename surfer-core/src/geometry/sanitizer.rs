use crate::geometry::{evaluate_curve, find_v_at_z, get_board_bounds, RockerArcLengthTable};
use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

pub const BYPASS_CALIBRATION: bool = false; // Sandbox toggle to isolate parser vs. calibration bugs

/// Trims or snaps a spline to lie strictly within [min_z, max_z] coordinates by evaluating its
/// shape at the boundary and adjusting the end control points and adjacent handles accordingly.
fn clip_curve_to_z_bounds(curve: &mut BezierCurveData, min_z: f32, max_z: f32) {
    if curve.control_points.is_empty() {
        return;
    }

    // 1. Trim start (usually nose at minimum Z)
    let first_p = curve.control_points[0];
    if first_p.z < min_z {
        let t = find_v_at_z(curve, min_z, 0.0, 1.0);
        let pt = evaluate_curve(curve, t);

        let old_anchor = curve.control_points[0];
        let old_t2 = curve.tangents2.first().copied().unwrap_or(old_anchor);
        let t2_offset = old_t2 - old_anchor;

        curve.control_points[0] = pt;
        if !curve.tangents1.is_empty() {
            curve.tangents1[0] = pt;
        }
        if !curve.tangents2.is_empty() {
            curve.tangents2[0] = pt + t2_offset;
        }
    } else if first_p.z > min_z {
        curve.control_points[0].z = min_z;
        if !curve.tangents1.is_empty() {
            curve.tangents1[0].z = min_z;
        }
        if !curve.tangents2.is_empty() {
            curve.tangents2[0].z = min_z;
        }
    }

    // 2. Trim end (usually tail at maximum Z)
    let last_idx = curve.control_points.len() - 1;
    let last_p = curve.control_points[last_idx];
    if last_p.z > max_z {
        let t = find_v_at_z(curve, max_z, 0.0, 1.0);
        let pt = evaluate_curve(curve, t);

        let old_anchor = curve.control_points[last_idx];
        let old_t1 = curve.tangents1.get(last_idx).copied().unwrap_or(old_anchor);
        let t1_offset = old_t1 - old_anchor;

        curve.control_points[last_idx] = pt;
        if !curve.tangents2.is_empty() {
            curve.tangents2[last_idx] = pt;
        }
        if !curve.tangents1.is_empty() {
            curve.tangents1[last_idx] = pt + t1_offset;
        }
    } else if last_p.z < max_z {
        curve.control_points[last_idx].z = max_z;
        if !curve.tangents1.is_empty() {
            curve.tangents1[last_idx].z = max_z;
        }
        if !curve.tangents2.is_empty() {
            curve.tangents2[last_idx].z = max_z;
        }
    }
}

/// Synchronizes the nose and tail endpoints of all rocker and reference curves
/// to match the outline's actual Z boundaries.
pub fn synchronize_board_endpoints(model: &mut BoardModel) {
    let outline = match &model.outline {
        Some(o) => o,
        None => return,
    };
    if outline.control_points.is_empty() {
        return;
    }

    let min_z = evaluate_curve(outline, 0.0).z;

    let mut max_z = f32::NEG_INFINITY;
    let steps = 50;
    for i in 0..=steps {
        let t = i as f32 / steps as f32;
        let p = evaluate_curve(outline, t);
        if p.z > max_z {
            max_z = p.z;
        }
    }

    let clip_curve = |curve_opt: &mut Option<BezierCurveData>| {
        if let Some(curve) = curve_opt {
            clip_curve_to_z_bounds(curve, min_z, max_z);
        }
    };

    clip_curve(&mut model.rocker_top);
    clip_curve(&mut model.rocker_bottom);
    clip_curve(&mut model.apex_rocker);
    clip_curve(&mut model.rail_outline);
    clip_curve(&mut model.apex_outline);
    clip_curve(&mut model.deck_shoulder);
}

/// Calibrates the imported linear coordinates of the board by mapping curvilinear
/// "tape-measure" distances back to flat Cartesian 3D Z-coordinates using the bottom rocker's arc length.
pub fn calibrate_model_coordinates(model: &mut BoardModel) {
    if BYPASS_CALIBRATION {
        return;
    }
    let rocker = match &model.rocker_bottom {
        Some(r) => r,
        None => return,
    };
    if rocker.control_points.is_empty() {
        return;
    }
    let bounds = get_board_bounds(model);
    let table = RockerArcLengthTable::new(rocker, bounds.nose_z, bounds.tip_z);

    let active_length = bounds.tip_z - bounds.nose_z;
    let scale_factor = if active_length > 0.0 {
        table.total_length / active_length
    } else {
        1.0
    };

    let warp_curve = |curve_opt: &mut Option<BezierCurveData>| {
        if let Some(curve) = curve_opt {
            for i in 0..curve.control_points.len() {
                let z_imported = curve.control_points[i].z;
                let s_from_tail = (bounds.tip_z - z_imported) * scale_factor;
                let z_calibrated = table.map_s_to_z(s_from_tail);
                let dz = z_calibrated - z_imported;

                curve.control_points[i].z += dz;
                if i < curve.tangents1.len() {
                    curve.tangents1[i].z += dz;
                }
                if i < curve.tangents2.len() {
                    curve.tangents2[i].z += dz;
                }
            }
        }
    };

    warp_curve(&mut model.outline);
    warp_curve(&mut model.rail_outline);
    warp_curve(&mut model.apex_outline);
    warp_curve(&mut model.deck_shoulder);
    warp_curve(&mut model.rocker_top);
    warp_curve(&mut model.rocker_bottom);
    warp_curve(&mut model.apex_rocker);

    if let Some(layers) = &mut model.outline_layers {
        for l in layers {
            let mut ext = Some(l.otl_ext.clone());
            warp_curve(&mut ext);
            if let Some(ext) = ext {
                l.otl_ext = ext;
            }

            let mut int = Some(l.otl_int.clone());
            warp_curve(&mut int);
            if let Some(int) = int { 
                l.otl_int = int;
            }
        }
    }

    if let Some(channels) = &mut model.bottom_channels {
        for c in channels {
            let mut lo = Some(c.left_outline.clone());
            warp_curve(&mut lo);
            if let Some(lo) = lo {
                c.left_outline = lo;
            }
            let mut ro = Some(c.right_outline.clone());
            warp_curve(&mut ro);
            if let Some(ro) = ro {
                c.right_outline = ro;
            }
            let mut ld = Some(c.left_depth.clone());
            warp_curve(&mut ld);
            if let Some(ld) = ld {
                c.left_depth = ld;
            }
            let mut rd = Some(c.right_depth.clone());
            warp_curve(&mut rd);
            if let Some(rd) = rd {
                c.right_depth = rd;
            }
        }
    }

    for cs in &mut model.cross_sections {
        if cs.control_points.is_empty() {
            continue;
        }
        let z_imported = cs.control_points[0].z;
        let s_from_tail = (bounds.tip_z - z_imported) * scale_factor;
        let z_calibrated = table.map_s_to_z(s_from_tail);
        let dz = z_calibrated - z_imported;

        for p in &mut cs.control_points {
            p.z += dz;
        }
        for p in &mut cs.tangents1 {
            p.z += dz;
        }
        for p in &mut cs.tangents2 {
            p.z += dz;
        }
    }

    if let Some(fin_boxes) = &mut model.imported_fin_boxes {
        for fb in fin_boxes {
            let s_from_tail = (bounds.tip_z - fb.z) * scale_factor;
            let z_calibrated = table.map_s_to_z(s_from_tail);
            fb.z = z_calibrated;

            if !fb.central {
                let hint_t = (fb.z - bounds.nose_z) / model.length;
                let outline_pt = crate::geometry::evaluate_composite_outline_at_z(model, fb.z, hint_t);
                let half_width = outline_pt.x.max(0.0);

                let max_allowed_x = (half_width - (fb.width / 2.0) - 0.1).max(0.0);
                if fb.x > max_allowed_x {
                    fb.x = max_allowed_x;
                }
            }
        }
    }
}

/// A strict normalization gatekeeper for all imported CAD files (.s3dx and .brd).
/// Forces all cross-sections to perfectly anchor to the board's stringer (YZ-plane),
/// ensures horizontal tangent handles across the center for G1 continuity,
/// synthesizes missing deck nodes for open curves, removes micro-segments,
/// and explicitly caps the nose and tail extremes.
pub fn sanitize_imported_model(model: &mut BoardModel) {
    // 1. Micro-Segment Filtering
    for cs in &mut model.cross_sections {
        if cs.control_points.is_empty() {
            continue;
        }
        let mut i = 1;
        while i < cs.control_points.len() {
            let dist = cs.control_points[i].distance(cs.control_points[i - 1]);
            if dist < 0.01 {
                cs.control_points.remove(i);
                if i < cs.tangents1.len() {
                    cs.tangents1.remove(i);
                }
                if i < cs.tangents2.len() {
                    cs.tangents2.remove(i);
                }
                if let Some(w) = &mut cs.weights {
                    if i < w.len() {
                        w.remove(i);
                    }
                }
            } else {
                i += 1;
            }
        }
    }

    // 2. Synchronize Board Endpoints
    // Rockers and outline must share identical boundaries to prevent flat-clamped out-of-bounds evaluations.
    synchronize_board_endpoints(model);

    let bounds = crate::geometry::get_board_bounds(model);

    // Prune slices residing in the stripped nose/tail cap zones before calibration,
    // preventing multiple boundary slices from stacking/collapsing at the same Z coordinate.
    model.cross_sections.retain(|cs| {
        if cs.control_points.is_empty() {
            return false;
        }
        let z = cs.control_points[0].z;
        z >= bounds.nose_z - 0.1 && z <= bounds.tip_z + 0.1
    });

    // 2. Open Couple Synthesis
    let top_rocker = model.rocker_top.clone().unwrap_or_default();
    for cs in &mut model.cross_sections {
        if cs.control_points.is_empty() {
            continue;
        }
        let last_idx = cs.control_points.len() - 1;
        let last_p = cs.control_points[last_idx];

        // If the last point is far from the stringer (X > 0.1), it's an open slice missing a deck node
        if last_p.x > 0.1 {
            let slice_z = last_p.z;
            let deck_height = crate::geometry::evaluate_bezier_at_z(&top_rocker, slice_z, 0.5).y;
            let new_p = Vec3::new(0.0, deck_height, slice_z);

            // Synthesize a horizontal incoming tangent swooping smoothly from the rail
            let new_t1 = Vec3::new(last_p.x * 0.5, deck_height, slice_z);
            let new_t2 = new_p; // Dead outgoing tangent (end of curve)

            cs.control_points.push(new_p);
            cs.tangents1.push(new_t1);
            cs.tangents2.push(new_t2);
            if let Some(w) = &mut cs.weights {
                w.push(1.0);
            }
        }
    }

    // 3. Endpoint Clamping & Orthogonalization
    for cs in &mut model.cross_sections {
        if cs.control_points.is_empty() {
            continue;
        }

        // First point (Bottom stringer)
        if let Some(first_p) = cs.control_points.first_mut() {
            first_p.x = 0.0;
        }
        let anchor_0_y = cs.control_points[0].y;
        let anchor_0_z = cs.control_points[0].z;
        if let Some(first_t2) = cs.tangents2.first_mut() {
            // Force horizontal outward slope to guarantee bottom G1 continuity
            first_t2.y = anchor_0_y;
            first_t2.z = anchor_0_z;
        }

        // Last point (Top stringer)
        let last_idx = cs.control_points.len() - 1;
        if let Some(last_p) = cs.control_points.last_mut() {
            last_p.x = 0.0;
        }
        let anchor_n_y = cs.control_points[last_idx].y;
        let anchor_n_z = cs.control_points[last_idx].z;
        if let Some(last_t1) = cs.tangents1.last_mut() {
            // Force horizontal inward slope to guarantee deck G1 continuity
            last_t1.y = anchor_n_y;
            last_t1.z = anchor_n_z;
        }
    }

    // 4. Extreme Pole Capping
    // Ensure slices are correctly sorted from nose to tail first
    model.cross_sections.sort_by(|a, b| {
        let za = a.control_points.first().map(|p| p.z).unwrap_or(0.0);
        let zb = b.control_points.first().map(|p| p.z).unwrap_or(0.0);
        za.partial_cmp(&zb).unwrap()
    });

    let bounds = crate::geometry::get_board_bounds(model);
    let bottom_rocker = model.rocker_bottom.clone().unwrap_or_default();

    if let Some(first_cs) = model.cross_sections.first() {
        let first_z = first_cs.control_points.first().map(|p| p.z).unwrap_or(0.0);
        // Inject Nose Cap if missing (Nose is at negative Z in our coordinate space)
        if first_z > bounds.nose_z + 0.1 {
            let y = crate::geometry::evaluate_bezier_at_z(&bottom_rocker, bounds.nose_z, 0.0).y;
            let p = Vec3::new(0.0, y, bounds.nose_z);
            model.cross_sections.insert(
                0,
                BezierCurveData {
                    control_points: vec![p],
                    tangents1: vec![p],
                    tangents2: vec![p],
                    weights: None,
                    apex_ratio: Some(0.5),
                    tuck_ratio: Some(0.25),
                },
            );
        }
    }

    if let Some(last_cs) = model.cross_sections.last() {
        let last_z = last_cs.control_points.first().map(|p| p.z).unwrap_or(0.0);
        // Inject Tail Cap if missing (Tail is at positive Z in our coordinate space)
        if last_z < bounds.tip_z - 0.1 {
            let y = crate::geometry::evaluate_bezier_at_z(&bottom_rocker, bounds.tip_z, 1.0).y;
            let p = Vec3::new(0.0, y, bounds.tip_z);
            model.cross_sections.push(BezierCurveData {
                control_points: vec![p],
                tangents1: vec![p],
                tangents2: vec![p],
                weights: None,
                apex_ratio: Some(0.5),
                tuck_ratio: Some(0.25),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    #[test]
    fn test_sanitization_pipeline() {
        let mut model = BoardModel::default();
        model.length = 100.0;

        // Leaving tangent arrays empty delegates to the solver's straight linear interpolation fallback
        model.rocker_top = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, 5.0, -50.0), Vec3::new(0.0, 5.0, 50.0)],
            ..Default::default()
        });
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![Vec3::new(0.0, -1.0, -50.0), Vec3::new(0.0, -1.0, 50.0)],
            ..Default::default()
        });
        model.outline = Some(BezierCurveData {
            control_points: vec![Vec3::new(10.0, 0.0, -50.0), Vec3::new(10.0, 0.0, 50.0)],
            ..Default::default()
        });

        // Create an open, off-center, micro-segmented slice in the middle of the board
        let broken_slice = BezierCurveData {
            control_points: vec![
                Vec3::new(0.2, -1.0, 0.0),   // Off-center start
                Vec3::new(0.205, -1.0, 0.0), // Micro-segment (dist = 0.005)
                Vec3::new(5.0, -0.5, 0.0),   // Rail
                Vec3::new(8.0, 1.0, 0.0),    // Open deck (missing center return)
            ],
            tangents1: vec![
                Vec3::new(0.2, -2.0, 0.0), // Misaligned incoming tangent
                Vec3::ZERO,
                Vec3::ZERO,
                Vec3::new(8.0, 1.0, 0.0), // Misaligned incoming tangent
            ],
            tangents2: vec![
                Vec3::new(0.2, -0.5, 0.0), // Misaligned outgoing tangent
                Vec3::ZERO,
                Vec3::ZERO,
                Vec3::ZERO,
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0]),
            ..Default::default()
        };
        model.cross_sections.push(broken_slice);

        // Run the Sanitizer
        sanitize_imported_model(&mut model);

        // 1. Extreme Pole Capping Assertions
        // It should have injected 2 new caps at bounds.nose_z (-50) and bounds.tip_z (50).
        assert_eq!(
            model.cross_sections.len(),
            3,
            "Should have injected a nose and tail cap"
        );

        let nose_cap = &model.cross_sections[0];
        assert_eq!(nose_cap.control_points.len(), 1);
        assert_eq!(nose_cap.control_points[0].z, -50.0);

        let tail_cap = &model.cross_sections[2];
        assert_eq!(tail_cap.control_points.len(), 1);
        assert_eq!(tail_cap.control_points[0].z, 50.0);

        // 2. Micro-Segment Filtering Assertions
        let sanitized_slice = &model.cross_sections[1];
        // Original had 4 points. Micro-segment removed -> 3. Open couple synthesized -> 4.
        assert_eq!(sanitized_slice.control_points.len(), 4);

        // 3. Endpoint Clamping & Orthogonalization Assertions
        let first_p = sanitized_slice.control_points.first().unwrap();
        assert_eq!(first_p.x, 0.0, "Bottom stringer must be clamped to X=0.0");

        let first_t2 = sanitized_slice.tangents2.first().unwrap();
        assert_eq!(
            first_t2.y, first_p.y,
            "Bottom stringer T2 must be horizontal"
        );
        assert_eq!(
            first_t2.z, first_p.z,
            "Bottom stringer T2 must be orthogonal to YZ plane"
        );

        // 4. Open Couple Synthesis Assertions
        let last_p = sanitized_slice.control_points.last().unwrap();
        assert_eq!(last_p.x, 0.0, "Synthesized top stringer must be at X=0.0");
        assert_eq!(
            last_p.y, 5.0,
            "Synthesized top stringer must match rocker_top height"
        );

        let last_t1 = sanitized_slice.tangents1.last().unwrap();
        assert_eq!(last_t1.y, last_p.y, "Top stringer T1 must be horizontal");
        assert_eq!(
            last_t1.z, last_p.z,
            "Top stringer T1 must be orthogonal to YZ plane"
        );
    }

    #[test]
    fn test_model_coordinates_calibration() {
        let mut model = BoardModel::default();
        model.length = 100.0;

        // Setup heavily rockered bottom (asymmetrical rocker: 5" nose vs 4" tail)
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 5.0, -50.0),
                Vec3::new(0.0, -2.0, 0.0),
                Vec3::new(0.0, 4.0, 50.0),
            ],
            ..Default::default()
        });

        // Setup a straight outline where control points are evenly spaced in Cartesian Z
        model.outline = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(5.0, 0.0, -50.0), // Nose
                Vec3::new(10.0, 0.0, 0.0),  // Midpoint
                Vec3::new(5.0, 0.0, 50.0),  // Tail
            ],
            ..Default::default()
        });

        calibrate_model_coordinates(&mut model);

        // Nose and Tail boundaries must remain exactly at their Cartesian bounds
        let outline = model.outline.as_ref().unwrap();
        assert_relative_eq!(outline.control_points[0].z, -50.0, epsilon = 1e-4);
        assert_relative_eq!(outline.control_points[2].z, 50.0, epsilon = 1e-4);

        let rocker_bottom = model.rocker_bottom.as_ref().unwrap();
        assert_relative_eq!(rocker_bottom.control_points[0].z, -50.0, epsilon = 1e-4);
        assert_relative_eq!(rocker_bottom.control_points[2].z, 50.0, epsilon = 1e-4);

        // The midpoint (Z_imported = 0.0, which means s_from_tail = 50.0, i.e., exactly half the board length)
        // Since the rocker bottom curves, half the curvilinear length occurs closer to the nose/tail than the flat center.
        // Therefore, the calibrated Cartesian Z of the midpoint must be slightly shifted toward the tail (positive Z)
        // due to the asymmetry of the nose rocker (5.0) vs. tail rocker (4.0).
        let mid_z = outline.control_points[1].z;
        println!("[Test] Calibrated Midpoint Z: {}", mid_z);
        assert!(mid_z < 0.0);

        let r_mid_z = rocker_bottom.control_points[1].z;
        assert_relative_eq!(r_mid_z, mid_z, epsilon = 1e-4);
    }

    #[test]
    fn test_curvilinear_round_trip_symmetry() {
        let mut model = BoardModel::default();
        model.length = 100.0;

        // Setup a bottom rocker with complex curve
        model.rocker_bottom = Some(BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, 6.0, -50.0),
                Vec3::new(0.0, -1.5, 0.0),
                Vec3::new(0.0, 3.5, 50.0),
            ],
            ..Default::default()
        });

        // Setup a test curve (like outline) with some control points in raw "curvilinear" format.
        let raw_outline = BezierCurveData {
            control_points: vec![
                Vec3::new(5.0, 0.0, -50.0),
                Vec3::new(10.0, 0.0, -25.0),
                Vec3::new(12.0, 0.0, 25.0),
                Vec3::new(6.0, 0.0, 50.0),
            ],
            ..Default::default()
        };
        model.outline = Some(raw_outline.clone());

        // Calibrate model to Cartesian space
        calibrate_model_coordinates(&mut model);

        // Retrieve table and scale_factor (simulating the export pass)
        let rocker = model.rocker_bottom.as_ref().unwrap();
        let bounds = get_board_bounds(&model);
        let table = RockerArcLengthTable::new(rocker, bounds.nose_z, bounds.tip_z);
        let active_length = bounds.tip_z - bounds.nose_z;
        let scale_factor = if active_length > 0.0 {
            table.total_length / active_length
        } else {
            1.0
        };

        // Warp the calibrated outline back into curvilinear space (export simulation)
        let mut uncalibrated_outline = model.outline.clone().unwrap();
        for p in &mut uncalibrated_outline.control_points {
            let s_from_tail = table.map_z_to_s(p.z);
            let uncalibrated_z = bounds.tip_z - (s_from_tail / scale_factor);
            p.z = uncalibrated_z;
        }

        // Compare the uncalibrated outline with the original raw outline
        for (p_orig, p_uncal) in raw_outline
            .control_points
            .iter()
            .zip(uncalibrated_outline.control_points.iter())
        {
            assert_relative_eq!(p_orig.x, p_uncal.x, epsilon = 1e-4);
            assert_relative_eq!(p_orig.y, p_uncal.y, epsilon = 1e-4);
            assert_relative_eq!(p_orig.z, p_uncal.z, epsilon = 5e-3);
        }
    }
}
