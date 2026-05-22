use crate::model::{BezierCurveData, BoardModel};
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use md5::{Digest, Md5};

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

        let injected = crate::geometry::inject_export_caps(c.clone(), is_thickness);
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

            out.push_str(&format!(
                "[{:.6} {:.6} {:.6} {:.6} {:.6} {:.6}]\n",
                px, py, t1x, t1y, t2x, t2y
            ));
        }
        out.push_str(")\n");
        out
    } else {
        String::new()
    }
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
    out.push_str(&format!("p01: {:.6}\n", model.length));
    out.push_str(&format!("p04: {:.6}\n", model.width));
    out.push_str(&format!("p03: {:.6}\n", model.thickness));

    let p32 = format_aku_curve(&model.outline, false, &table, scale_factor);
    if !p32.is_empty() {
        out.push_str(&format!("p32:\n{}", p32));
    }

    let p33 = format_aku_curve(&model.rocker_bottom, true, &table, scale_factor);
    if !p33.is_empty() {
        out.push_str(&format!("p33:\n{}", p33));
    }

    let p34 = format_aku_curve(&model.rocker_top, true, &table, scale_factor);
    if !p34.is_empty() {
        out.push_str(&format!("p34:\n{}", p34));
    }

    if !model.cross_sections.is_empty() {
        out.push_str("p35:\n");
        for cs in &model.cross_sections {
            if cs.control_points.is_empty() {
                continue;
            }
            let slice_z = cs.control_points[0].z;
            let s_slice_from_tail = table.map_z_to_s(slice_z);
            let px = if scale_factor > 0.0 {
                (s_slice_from_tail / scale_factor).max(0.0)
            } else {
                0.0
            };
            let apex_ratio = cs
                .apex_ratio
                .unwrap_or_else(|| crate::geometry::find_apex_t(cs));
            let tuck_ratio = cs
                .tuck_ratio
                .unwrap_or_else(|| 0.01_f32.max(apex_ratio * 0.5));
            out.push_str(&format!(
                "(p36 {:.6} {:.6} {:.6}\n",
                px, apex_ratio, tuck_ratio
            ));

            for i in 0..cs.control_points.len() {
                out.push_str(&format!(
                    "[{:.6} {:.6} {:.6} {:.6} {:.6} {:.6}]\n",
                    cs.control_points[i].x,
                    cs.control_points[i].y,
                    cs.tangents1[i].x,
                    cs.tangents1[i].y,
                    cs.tangents2[i].x,
                    cs.tangents2[i].y
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
        let mut model_a = crate::brd_parser::parse_brd(&bytes).expect("Failed to parse initial BRD");

        // 2. Export into newly encrypted bytes
        let exported_bytes = export_aku_brd(&model_a).expect("Failed to export BRD");

        // 3. Re-parse into model_b
        let model_b =
            crate::brd_parser::parse_brd(&exported_bytes).expect("Failed to parse exported BRD");

                        // Normalize default fields (apex_ratio, tuck_ratio) which get populated on export/import
        for (cs_a, cs_b) in model_a.cross_sections.iter_mut().zip(model_b.cross_sections.iter()) {
            if cs_a.apex_ratio.is_none() {
                cs_a.apex_ratio = cs_b.apex_ratio;
            }
            if cs_a.tuck_ratio.is_none() {
                cs_a.tuck_ratio = cs_b.tuck_ratio;
            }
        }

                // 4. Assert Equivalence with detailed diagnostics on failure
        let epsilon = 1.5;
        let ok = approx::relative_eq!(model_a, model_b, epsilon = epsilon);
        if !ok {
            println!("\n=== BRD ROUND-TRIP DIAGNOSTIC COMPARISON ===");
            if (model_a.length - model_b.length).abs() > epsilon {
                println!("Length mismatch: {} vs {}", model_a.length, model_b.length);
            }
            if (model_a.width - model_b.width).abs() > epsilon {
                println!("Width mismatch: {} vs {}", model_a.width, model_b.width);
            }
            if (model_a.thickness - model_b.thickness).abs() > epsilon {
                println!("Thickness mismatch: {} vs {}", model_a.thickness, model_b.thickness);
            }
            if (model_a.v_concave_tail - model_b.v_concave_tail).abs() > epsilon {
                println!("VConcaveTail mismatch: {} vs {}", model_a.v_concave_tail, model_b.v_concave_tail);
            }
            if (model_a.v_concave_nose - model_b.v_concave_nose).abs() > epsilon {
                println!("VConcaveNose mismatch: {} vs {}", model_a.v_concave_nose, model_b.v_concave_nose);
            }
            
            println!("\nSlices comparison:");
            println!("Model A Slices: {}", model_a.cross_sections.len());
            for (i, cs) in model_a.cross_sections.iter().enumerate() {
                if let Some(cp) = cs.control_points.first() {
                    println!("  Slice A[{}] Z = {:.6}", i, cp.z);
                }
            }
            println!("Model B Slices: {}", model_b.cross_sections.len());
            for (i, cs) in model_b.cross_sections.iter().enumerate() {
                if let Some(cp) = cs.control_points.first() {
                    println!("  Slice B[{}] Z = {:.6}", i, cp.z);
                }
            }
            println!("============================================\n");
        }
                approx::assert_relative_eq!(model_a, model_b, epsilon = epsilon);
    }
}
