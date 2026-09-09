use crate::model::{BezierCurveData, BoardModel};
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use md5::{Digest, Md5};

/// The model works in inches, but AkuShaper's `.brd` format stores every
/// dimension and coordinate in centimetres (its parser always reads `p01` &
/// coordinates as cm). Multiply all positional output by this so AkuShaper
/// shows true size; dimensionless values (apex/tuck ratios) are NOT scaled.
const IN_TO_CM: f32 = 2.54;

type DesCbcEnc = cbc::Encryptor<des::Des>;

fn format_aku_curve(
    curve: &Option<BezierCurveData>,
    is_thickness: bool,
    table: &crate::geometry::RockerArcLengthTable,
    scale_factor: f32,
) -> String {
    if let Some(c) = curve {
        if c.control_points.is_empty() {
            return String::new();
        }

        // Only the outline tapers to zero at the tips, so only it gets 0-caps.
        // Rocker/deck curves (is_thickness) keep their nonzero nose/tail heights;
        // forcing a y=0 cap there makes the curve dive to 0 at the tip (via the
        // endpoint's beyond-the-tip Bezier handle), producing a hook in the
        // rocker profile.
        let injected = if is_thickness {
            c.clone()
        } else {
            crate::geometry::inject_export_caps(c.clone(), is_thickness)
        };
        let mut pts = injected.control_points;
        let mut t1 = injected.tangents1;
        let mut t2 = injected.tangents2;

        pts.reverse();
        let old_t1 = t1.clone();
        let old_t2 = t2.clone();
        t1 = old_t2.into_iter().rev().collect();
        t2 = old_t1.into_iter().rev().collect();

        let mut out = String::new();
        for i in 0..pts.len() {
            let s_from_tail = table.map_z_to_s(pts[i].z);
            let px = if scale_factor > 0.0 {
                (s_from_tail / scale_factor).max(0.0)
            } else {
                0.0
            };
            let py = if is_thickness { pts[i].y } else { pts[i].x };

            let s_t1_from_tail = table.map_z_to_s(t1[i].z);
            let t1x = if scale_factor > 0.0 {
                (s_t1_from_tail / scale_factor).max(0.0)
            } else {
                0.0
            };
            let t1y = if is_thickness { t1[i].y } else { t1[i].x };

            let s_t2_from_tail = table.map_z_to_s(t2[i].z);
            let t2x = if scale_factor > 0.0 {
                (s_t2_from_tail / scale_factor).max(0.0)
            } else {
                0.0
            };
            let t2y = if is_thickness { t2[i].y } else { t2[i].x };

            // AkuShaper BoardIO requires each control point wrapped as
            // `(cp [comma,separated,values] flag flag)`; bare `[a b c]` lines
            // are rejected as "Unrecognized BoardIO property" and the curve is
            // dropped. The two trailing booleans are corner flags; false/false
            // (smooth) loads and renders correctly.
            out.push_str(&format!(
                "(cp [{:.6},{:.6},{:.6},{:.6},{:.6},{:.6}] false false)\n",
                px * IN_TO_CM,
                py * IN_TO_CM,
                t1x * IN_TO_CM,
                t1y * IN_TO_CM,
                t2x * IN_TO_CM,
                t2y * IN_TO_CM
            ));
        }
        out.push_str(")\n");
        out
    } else {
        String::new()
    }
}

/// Number of cross-section stations to sample along the board for .brd export.
const EXPORT_SLICE_STATIONS: usize = 12;

/// Build one rail cross-section (in slice-local coords: x = half-width from the
/// stringer, y = height above the bottom) by sampling the lofted board profile
/// at longitudinal position `z`. Points run bottom-center -> tuck -> apex ->
/// shoulder -> deck-center, matching the control-point order AkuShaper expects.
fn sample_rail_points(model: &BoardModel, z: f32, hint_t: f32) -> Vec<(f32, f32)> {
    let p = crate::geometry::get_board_profile_at_z(model, z, hint_t);
    let base = p.bot_y; // make the bottom of the slice y = 0
    vec![
        (0.0, 0.0),
        (p.tuck_x, p.tuck_y - base),
        (p.apex_x, p.apex_y - base),
        (p.shoulder_x, p.shoulder_y - base),
        (0.0, p.top_y - base),
    ]
}

pub fn serialize_aku_shaper(model: &BoardModel) -> String {
    let rocker = model.rocker_bottom.as_ref();
    let bounds = crate::geometry::get_board_bounds(model);
    let default_rocker = BezierCurveData::default();
    let table = crate::geometry::RockerArcLengthTable::new(
        rocker.unwrap_or(&default_rocker),
        bounds.nose_z,
        bounds.tip_z,
    );

    let active_length = bounds.tip_z - bounds.nose_z;
    let scale_factor = if active_length > 0.0 {
        table.total_length / active_length
    } else {
        1.0
    };

    let mut out = String::new();
    // Params use `key : value` spacing to match AkuShaper's .brd format.
    out.push_str(&format!("p01 : {:.6}\n", model.length * IN_TO_CM));
    out.push_str(&format!("p04 : {:.6}\n", model.width * IN_TO_CM));
    out.push_str(&format!("p03 : {:.6}\n", model.thickness * IN_TO_CM));

    // Fins (p50) MUST be present: AkuShaper's BoardIO calls `new Fins(dArray, ..)`
    // unconditionally after the read loop and indexes dArray[0..8], so an absent
    // p50 leaves it an empty array and throws in Fins.<init>, aborting the whole
    // load (board never appears). 9 zeros is the "no fins" default every real
    // Aku fixture ships; staying at length 9 avoids the length>17 cluster branch.
    out.push_str("p50 : [0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]\n");

    // Blank/machine placement arrays. Like fins, AkuShaper dereferences these
    // unconditionally after the read loop: blankTailPos (p30) is `.clone()`d and
    // boardStartPos (p31) is indexed at [0] and [2], so an absent (null) value
    // NPEs and aborts the load. They position the board on the foam blank for
    // CNC, not the board shape, so values only need to be non-null and
    // non-degenerate; length-scaled keeps the machine transform well-formed.
    let half_len = model.length * IN_TO_CM * 0.5;
    out.push_str(&format!("p30 : [{:.6},0.0,40.0]\n", half_len)); // blankTailPos
    out.push_str(&format!("p31 : [{:.6},0.0,34.0]\n", half_len)); // boardStartPos

    // Curve sections open with `pNN : (` and are closed by the `)` that
    // format_aku_curve appends.
    let p32 = format_aku_curve(&model.outline, false, &table, scale_factor);
    if !p32.is_empty() {
        out.push_str(&format!("p32 : (\n{}", p32));
    }

    let p33 = format_aku_curve(&model.rocker_bottom, true, &table, scale_factor);
    if !p33.is_empty() {
        out.push_str(&format!("p33 : (\n{}", p33));
    }

    let p34 = format_aku_curve(&model.rocker_top, true, &table, scale_factor);
    if !p34.is_empty() {
        out.push_str(&format!("p34 : (\n{}", p34));
    }

    // Cross-section slices (p35). AkuShaper builds its 3D surface by lofting
    // between the explicit slices in the file — it does NOT blend a single
    // template across the board the way our mesh does. A board whose model has
    // only one (or zero) rail cross-sections therefore renders as just the
    // stringer. So instead of dumping model.cross_sections, sample the lofted
    // board profile at several stations and emit each as a p36 slice, giving
    // AkuShaper enough rings to reconstruct the shape we display.
    if model.outline.is_some()
        && model.rocker_bottom.is_some()
        && model.rocker_top.is_some()
        && EXPORT_SLICE_STATIONS >= 2
    {
        let bounds = crate::geometry::get_board_bounds(model);
        out.push_str("p35 : (\n");
        for i in 0..EXPORT_SLICE_STATIONS {
            let f = i as f32 / (EXPORT_SLICE_STATIONS - 1) as f32;
            let z = bounds.nose_z + f * (bounds.tip_z - bounds.nose_z);

            // Position along the rocker arc from the tail (AkuShaper's px space).
            let px = if scale_factor > 0.0 {
                (table.map_z_to_s(z) / scale_factor).max(0.0)
            } else {
                0.0
            };

            // The extreme nose/tail stations are caps: a near-zero-width ring
            // lofts into a spike, so emit a single stringer-center point with the
            // -1 "undefined ratio" sentinel, exactly as real Aku fixtures do.
            if i == 0 || i == EXPORT_SLICE_STATIONS - 1 {
                out.push_str(&format!("(p36 {:.6} -1.000000 -1.000000\n", px * IN_TO_CM));
                out.push_str("(cp [0.000000,0.000000,0.000000,0.000000,0.000000,0.000000] false false)\n");
                out.push_str(")\n");
                continue;
            }

            let pts = sample_rail_points(model, z, f);
            // apex is the 3rd of 5 points (~0.5), tuck the 2nd (~0.25).
            out.push_str(&format!("(p36 {:.6} 0.500000 0.250000\n", px * IN_TO_CM));

            // Catmull-Rom tangent handles for a smooth rail through the points.
            let n = pts.len();
            for j in 0..n {
                let p = pts[j];
                let prev = pts[j.saturating_sub(1)];
                let next = pts[(j + 1).min(n - 1)];
                let tx = (next.0 - prev.0) / 6.0;
                let ty = (next.1 - prev.1) / 6.0;
                let (h1x, h1y) = (p.0 - tx, p.1 - ty); // incoming handle
                let (h2x, h2y) = (p.0 + tx, p.1 + ty); // outgoing handle
                out.push_str(&format!(
                    "(cp [{:.6},{:.6},{:.6},{:.6},{:.6},{:.6}] false false)\n",
                    p.0 * IN_TO_CM,
                    p.1 * IN_TO_CM,
                    h1x * IN_TO_CM,
                    h1y * IN_TO_CM,
                    h2x * IN_TO_CM,
                    h2y * IN_TO_CM
                ));
            }
            out.push_str(")\n");
        }
        out.push_str(")\n");
    }

    out
}

pub fn encrypt_aku_shaper(text: &str) -> Result<Vec<u8>, String> {
    let password = "deltaXTaildeltaXMiddle";
    let salt: [u8; 8] = [0xC7, 0x73, 0x21, 0x8C, 0x7E, 0xC8, 0xEE, 0x99];

    let mut hasher = Md5::new();
    hasher.update(password.as_bytes());
    hasher.update(salt);
    let mut hash = hasher.finalize();

    for _ in 1..20 {
        let mut next_hasher = Md5::new();
        next_hasher.update(hash);
        hash = next_hasher.finalize();
    }

    let key = &hash[0..8];
    let iv = &hash[8..16];

    let cipher = DesCbcEnc::new(key.into(), iv.into());
    let msg_len = text.len();
    let mut buffer = vec![0u8; msg_len + 8];
    buffer[..msg_len].copy_from_slice(text.as_bytes());

    let ciphertext = cipher
        .encrypt_padded_mut::<Pkcs7>(&mut buffer, msg_len)
        .map_err(|e| format!("Encryption failed: {:?}", e))?;

    let mut final_data = b"%BRD-1.02s00".to_vec();
    final_data.extend_from_slice(ciphertext);

    Ok(final_data)
}

pub fn export_aku_brd(model: &BoardModel) -> Result<Vec<u8>, String> {
    let text = serialize_aku_shaper(model);
    encrypt_aku_shaper(&text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn test_aku_brd_round_trip() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd");

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");

        // 1. Parse into model_a
        let mut model_a =
            crate::brd_parser::parse_brd(&bytes).expect("Failed to parse initial BRD");

        // 2. Export into newly encrypted bytes
        let exported_bytes = export_aku_brd(&model_a).expect("Failed to export BRD");

        // 3. Re-parse into model_b
        let model_b =
            crate::brd_parser::parse_brd(&exported_bytes).expect("Failed to parse exported BRD");

        // Normalize default fields (apex_ratio, tuck_ratio) which get populated on export/import
        for (cs_a, cs_b) in model_a
            .cross_sections
            .iter_mut()
            .zip(model_b.cross_sections.iter())
        {
            if cs_a.apex_ratio.is_none() {
                cs_a.apex_ratio = cs_b.apex_ratio;
            }
            if cs_a.tuck_ratio.is_none() {
                cs_a.tuck_ratio = cs_b.tuck_ratio;
            }
        }

        // 4. Assert Equivalence of primary dimensions with high robustness
        approx::assert_relative_eq!(model_a.length, model_b.length, epsilon = 0.1);
        approx::assert_relative_eq!(model_a.width, model_b.width, epsilon = 0.1);
        approx::assert_relative_eq!(model_a.thickness, model_b.thickness, epsilon = 0.1);
    }
}
