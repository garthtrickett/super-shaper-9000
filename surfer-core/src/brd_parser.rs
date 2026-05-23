use crate::model::{BezierCurveData, BoardModel};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use glam::Vec3;
use md5::{Digest, Md5};

type DesCbcDec = cbc::Decryptor<des::Des>;
use serde::Deserialize;
use std::io::Read;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub struct BrdBoard {
    pub length: Option<f32>,
    pub width: Option<f32>,
    pub thickness: Option<f32>,
    pub outline: Option<BrdBezierContainer>,
    pub bottom: Option<BrdBezierContainer>,
    pub deck: Option<BrdBezierContainer>,
    pub profile: Option<BrdBezierContainer>,
}

#[derive(Debug, Deserialize)]
pub struct BrdBezierContainer {
    #[serde(rename = "bezier")]
    pub bezier: Option<BrdBezier>,
}

#[derive(Debug, Deserialize)]
pub struct BrdBezier {
    #[serde(rename = "controlPoints")]
    pub control_points: Option<BrdControlPoints>,
}

#[derive(Debug, Deserialize)]
pub struct BrdControlPoints {
    #[serde(rename = "point")]
    pub points: Option<Vec<BrdPoint>>,
}

#[derive(Debug, Deserialize)]
pub struct BrdPoint {
    #[serde(rename = "@x")]
    pub x: f32,
    #[serde(rename = "@y")]
    pub y: f32,
    #[serde(rename = "@t1x")]
    pub t1x: Option<f32>,
    #[serde(rename = "@t1y")]
    pub t1y: Option<f32>,
    #[serde(rename = "@t2x")]
    pub t2x: Option<f32>,
    #[serde(rename = "@t2y")]
    pub t2y: Option<f32>,
}

/// Strips the %BRD text header and decompresses the zlib binary payload.
/// Strips the %BRD text header and decompresses the binary payload.
pub fn decompress_brd(bytes: &[u8]) -> Result<String, String> {
    log::info!(
        "[Rust Engine] decompress_brd: Received {} bytes for decompression",
        bytes.len()
    );

    let text = String::from_utf8_lossy(bytes);
    if text.contains("<?xml") || text.to_lowercase().contains("<board") {
        log::info!("[Rust Engine] BRD file is already uncompressed text.");
        return Ok(text.to_string());
    }

    // The text header is usually small (e.g. `%BRD-1.02s00` = 12 bytes).
    // We scan the first 128 bytes to gracefully bypass any padding or header structures.
    let max_offset = bytes.len().min(128);

    for offset in 0..max_offset {
        let compressed_data = &bytes[offset..];

        // 1. Try ZLIB (Standard Java DeflaterOutputStream)
        let mut z_decoder = ZlibDecoder::new(compressed_data);
        let mut out = Vec::new();
        let _ = z_decoder.read_to_end(&mut out);
        if !out.is_empty() {
            let text = String::from_utf8_lossy(&out);
            if text.contains("<?xml") || text.to_lowercase().contains("<board") {
                log::info!(
                    "[Rust Engine] Successfully decoded ZLIB at offset {}",
                    offset
                );
                return Ok(text.to_string());
            }
        }

        // 2. Try RAW DEFLATE (No wrapper)
        let mut raw_decoder = DeflateDecoder::new(compressed_data);
        let mut out = Vec::new();
        let _ = raw_decoder.read_to_end(&mut out);
        if !out.is_empty() {
            let text = String::from_utf8_lossy(&out);
            if text.contains("<?xml") || text.to_lowercase().contains("<board") {
                log::info!(
                    "[Rust Engine] Successfully decoded RAW DEFLATE at offset {}",
                    offset
                );
                return Ok(text.to_string());
            }
        }

        // 3. Try GZIP
        let mut gz_decoder = GzDecoder::new(compressed_data);
        let mut out = Vec::new();
        let _ = gz_decoder.read_to_end(&mut out);
        if !out.is_empty() {
            let text = String::from_utf8_lossy(&out);
            if text.contains("<?xml") || text.to_lowercase().contains("<board") {
                log::info!(
                    "[Rust Engine] Successfully decoded GZIP at offset {}",
                    offset
                );
                return Ok(text.to_string());
            }
        }
    }

    Err("Could not find a valid Zlib, Gzip, or Raw Deflate stream in the first 128 bytes of the BRD file".into())
}

fn convert_brd_curve(
    container: &Option<BrdBezierContainer>,
    board_length: f32,
    scale: f32,
    is_thickness: bool,
    is_reversed: bool,
) -> Option<BezierCurveData> {
    let pts = container
        .as_ref()?
        .bezier
        .as_ref()?
        .control_points
        .as_ref()?
        .points
        .as_ref()?;
    if pts.is_empty() {
        return None;
    }

    let mut control_points = Vec::new();
    let mut tangents1 = Vec::new();
    let mut tangents2 = Vec::new();

    for p in pts {
        // BRD typically maps X as length. We map length to Z.
        let z = (board_length / 2.0 - p.x) * scale;
        let mut v3 = Vec3::new(0.0, 0.0, z);

        if is_thickness {
            v3.y = p.y * scale;
        } else {
            v3.x = p.y * scale;
        }
        control_points.push(v3);

        let mut t1 = v3;
        if let (Some(tx), Some(ty)) = (p.t1x, p.t1y) {
            t1.z = (board_length / 2.0 - tx) * scale;
            if is_thickness {
                t1.y = ty * scale;
            } else {
                t1.x = ty * scale;
            }
        }
        tangents1.push(t1);

        let mut t2 = v3;
        if let (Some(tx), Some(ty)) = (p.t2x, p.t2y) {
            t2.z = (board_length / 2.0 - tx) * scale;
            if is_thickness {
                t2.y = ty * scale;
            } else {
                t2.x = ty * scale;
            }
        }
        tangents2.push(t2);
    }

    // Enforce "Nose to Tail" traversal for parametric compatibility
    if is_reversed {
        control_points.reverse();
        let old_t1 = tangents1.clone();
        let old_t2 = tangents2.clone();
        tangents1 = old_t2.into_iter().rev().collect();
        tangents2 = old_t1.into_iter().rev().collect();
    }

    Some(crate::geometry::cleanup_vertical_ends(
        BezierCurveData {
            control_points,
            tangents1,
            tangents2,
            weights: None,
            apex_ratio: None,
            tuck_ratio: None,
        },
        is_thickness,
    ))
}

/// Deserializes the decompressed XML and translates the 2D coordinate space into our 3D parametric BoardModel.
fn decrypt_aku_shaper(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 12 {
        return Err("File too short to be AkuShaper format".into());
    }

    let header = String::from_utf8_lossy(&bytes[0..12]);
    let password = if header.starts_with("%BRD-1.01") {
        "deltaXTail"
    } else {
        "deltaXTaildeltaXMiddle"
    };

    // PBEWithMD5AndDES parameters explicitly coded in AkuShaper's Java Source
    let salt: [u8; 8] = [0xC7, 0x73, 0x21, 0x8C, 0x7E, 0xC8, 0xEE, 0x99];

    // 1. Derive key and IV via MD5 (PKCS#5 PBKDF1 with 20 iterations)
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

    // 2. Decrypt (DES-CBC with PKCS5 padding, which is mathematically identical to PKCS7)
    let cipher = DesCbcDec::new(key.into(), iv.into());
    let mut plaintext = bytes[12..].to_vec();

    let decrypted = cipher
        .decrypt_padded_mut::<Pkcs7>(&mut plaintext)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    Ok(String::from_utf8_lossy(decrypted).to_string())
}

fn parse_aku_slice_curve(
    lines: &mut std::str::Lines,
    slice_z: f32,
    scale: f32,
) -> Option<BezierCurveData> {
    let mut control_points = Vec::new();
    let mut tangents1 = Vec::new();
    let mut tangents2 = Vec::new();

    for line in lines.by_ref() {
        let line = line.trim();
        if line.starts_with(')') {
            break;
        }
        if line.starts_with("gps") {
            continue;
        }
        if line.contains('[') {
            let start = line.find('[').unwrap_or(0) + 1;
            let end = line.find(']').unwrap_or(line.len());
            let content = &line[start..end];
            let floats: Vec<f32> = content
                .split([',', ' '])
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().parse::<f32>().unwrap_or(0.0))
                .collect();

            if floats.len() >= 6 {
                // Slices are scaled in the same units (e.g. centimeters) as length and width
                let px = floats[0] * scale;
                let py = floats[1] * scale;
                let t1x = floats[2] * scale;
                let t1y = floats[3] * scale;
                let t2x = floats[4] * scale;
                let t2y = floats[5] * scale;

                control_points.push(Vec3::new(px, py, slice_z));
                tangents1.push(Vec3::new(t1x, t1y, slice_z));
                tangents2.push(Vec3::new(t2x, t2y, slice_z));
            }
        }
    }

    if control_points.is_empty() {
        None
    } else {
        Some(BezierCurveData {
            control_points,
            tangents1,
            tangents2,
            weights: None,
            apex_ratio: None,
            tuck_ratio: None,
        })
    }
}

fn parse_aku_slices(
    lines: &mut std::str::Lines,
    board_length: f32,
    scale: f32,
) -> Vec<BezierCurveData> {
    let mut slices = Vec::new();

    while let Some(line) = lines.next() {
        let line = line.trim();
        if line == ")" {
            break;
        }
        if line.starts_with("(p36") || line.starts_with("p36") {
            let clean = line.replace(['(', ')'], "");
            let parts: Vec<&str> = clean.split([' ', '\t']).filter(|s| !s.is_empty()).collect();
            if parts.len() >= 2 {
                let px = parts[1].parse::<f32>().unwrap_or(0.0);
                // px represents distance from Tail, so Tail is px = 0 (positive Z) and Nose is px = board_length (negative Z)
                let slice_z = (board_length / 2.0 - px) * scale;

                // Filter out negative sentinel values (-1.0), which signify undefined/default ratios
                let apex_ratio = if parts.len() >= 3 {
                    let val = parts[2].parse::<f32>().unwrap_or(-1.0);
                    if val >= 0.0 {
                        Some(val)
                    } else {
                        None
                    }
                } else {
                    None
                };
                let tuck_ratio = if parts.len() >= 4 {
                    let val = parts[3].parse::<f32>().unwrap_or(-1.0);
                    if val >= 0.0 {
                        Some(val)
                    } else {
                        None
                    }
                } else {
                    None
                };

                if let Some(mut curve) = parse_aku_slice_curve(lines, slice_z, scale) {
                    curve.apex_ratio = apex_ratio;
                    curve.tuck_ratio = tuck_ratio;
                    slices.push(curve);
                }
            }
        }
    }

    // Sort slices from nose (negative Z) to tail (positive Z)
    slices.sort_by(|a, b| {
        let za = a.control_points.first().map(|p| p.z).unwrap_or(0.0);
        let zb = b.control_points.first().map(|p| p.z).unwrap_or(0.0);
        za.partial_cmp(&zb).unwrap()
    });

    slices
}

fn parse_aku_curve(
    lines: &mut std::str::Lines,
    board_length: f32,
    scale: f32,
    is_thickness: bool,
) -> Option<BezierCurveData> {
    let mut control_points = Vec::new();
    let mut tangents1 = Vec::new();
    let mut tangents2 = Vec::new();

    for line in lines.by_ref() {
        let line = line.trim();
        if line.starts_with(')') {
            break;
        }
        if line.starts_with("gps") {
            continue;
        }
        if line.contains('[') {
            let start = line.find('[').unwrap_or(0) + 1;
            let end = line.find(']').unwrap_or(line.len());
            let content = &line[start..end];
            let floats: Vec<f32> = content
                .split([',', ' '])
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().parse::<f32>().unwrap_or(0.0))
                .collect();

            if floats.len() >= 6 {
                let px = floats[0];
                let py = floats[1];
                let t1x = floats[2];
                let t1y = floats[3];
                let t2x = floats[4];
                let t2y = floats[5];

                let z = (board_length / 2.0 - px) * scale;

                let mut cp = Vec3::new(0.0, 0.0, z);
                let mut t1 = Vec3::new(0.0, 0.0, (board_length / 2.0 - t1x) * scale);
                let mut t2 = Vec3::new(0.0, 0.0, (board_length / 2.0 - t2x) * scale);

                if is_thickness {
                    cp.y = py * scale;
                    t1.y = t1y * scale;
                    t2.y = t2y * scale;
                } else {
                    cp.x = py * scale;
                    t1.x = t1y * scale;
                    t2.x = t2y * scale;
                }

                control_points.push(cp);
                tangents1.push(t1);
                tangents2.push(t2);
            }
        }
    }

    if control_points.is_empty() {
        None
    } else {
        // AkuShaper often stores Tail -> Nose. Our engine requires Nose -> Tail.
        control_points.reverse();
        let old_t1 = tangents1.clone();
        let old_t2 = tangents2.clone();
        tangents1 = old_t2.into_iter().rev().collect();
        tangents2 = old_t1.into_iter().rev().collect();

        Some(crate::geometry::cleanup_vertical_ends(
            BezierCurveData {
                control_points,
                tangents1,
                tangents2,
                weights: None,
                apex_ratio: None,
                tuck_ratio: None,
            },
            is_thickness,
        ))
    }
}

fn parse_aku_shaper(text: &str) -> Result<BoardModel, String> {
    let mut model = BoardModel::default();
    let mut lines = text.lines();
    let mut unscaled_length = 0.0;
    let mut scale = 1.0;

    while let Some(line) = lines.next() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim();
            let value = value.trim();

            match key {
                "p01" => {
                    unscaled_length = value.parse().unwrap_or(0.0);
                    scale = if unscaled_length > 130.0 {
                        1.0 / 2.54
                    } else {
                        1.0
                    };
                    model.length = unscaled_length * scale;
                }
                "p04" => {
                    model.width = value.parse::<f32>().unwrap_or(0.0) * scale;
                }
                "p03" => {
                    model.thickness = value.parse::<f32>().unwrap_or(0.0) * scale;
                }
                "p32" => {
                    model.outline = parse_aku_curve(&mut lines, unscaled_length, scale, false);
                }
                "p33" => {
                    model.rocker_bottom = parse_aku_curve(&mut lines, unscaled_length, scale, true);
                }
                "p34" => {
                    model.rocker_top = parse_aku_curve(&mut lines, unscaled_length, scale, true);
                }
                "p35" => {
                    model.cross_sections = parse_aku_slices(&mut lines, unscaled_length, scale);
                }
                _ => {}
            }
        }
    }

    let bounds_tip_z = model.length / 2.0;
    let bounds_nose_z = -model.length / 2.0;
    model.v_concave_tail = extract_concave_from_slices(&model.cross_sections, bounds_tip_z - 12.0);
    model.v_concave_nose = extract_concave_from_slices(&model.cross_sections, bounds_nose_z + 12.0);

    Ok(model)
}

fn extract_concave_from_slices(slices: &[BezierCurveData], target_z: f32) -> f32 {
    if slices.is_empty() {
        return 0.0;
    }

    let mut closest_slice = slices.first().unwrap();
    let mut min_dist = f32::INFINITY;

    for cs in slices {
        if let Some(first_cp) = cs.control_points.first() {
            let dist = (first_cp.z - target_z).abs();
            if dist < min_dist {
                min_dist = dist;
                closest_slice = cs;
            }
        }
    }

    let t_apex = crate::geometry::find_apex_t(closest_slice);
    let center_y = crate::geometry::evaluate_curve(closest_slice, 0.0).y;
    let mut min_y = center_y;

    let steps = 50;
    for i in 0..=steps {
        let t = i as f32 / steps as f32 * t_apex;
        let p = crate::geometry::evaluate_curve(closest_slice, t);
        if p.y < min_y {
            min_y = p.y;
        }
    }

    (center_y - min_y).max(0.0)
}

pub fn parse_brd(bytes: &[u8]) -> Result<BoardModel, String> {
    log::info!("[Rust Engine] parse_brd: Beginning BRD parsing pipeline");

    let mut model = if bytes.starts_with(b"%BRD") {
        log::info!(
            "[Rust Engine] Detected AkuShaper encrypted format. Beginning PKCS#5 decryption..."
        );
        let decrypted_text = decrypt_aku_shaper(bytes)?;
        log::debug!("[Rust Engine] AkuShaper decrypted successfully.");
        parse_aku_shaper(&decrypted_text)?
    } else {
        // 2. Otherwise, fall back to BoardCAD ZLIB/XML format
        let xml = decompress_brd(bytes)?;
        let start_idx = xml.find('<').unwrap_or(0);
        let xml_slice = &xml[start_idx..];
        let sanitized = xml_slice
            .replace("<Ref. point>", "<Ref_point>")
            .replace("</Ref. point>", "</Ref_point>");

        let brd: BrdBoard =
            quick_xml::de::from_str(&sanitized).map_err(|e| format!("XML parsing error: {}", e))?;

        let mut m = BoardModel::default();
        let bl = brd.length.unwrap_or(0.0);
        let scale = if bl > 130.0 { 1.0 / 2.54 } else { 1.0 };

        m.length = bl * scale;
        m.width = brd.width.unwrap_or(0.0) * scale;
        m.thickness = brd.thickness.unwrap_or(0.0) * scale;

        m.outline = convert_brd_curve(&brd.outline, bl, scale, false, true);
        m.rocker_bottom = convert_brd_curve(&brd.bottom, bl, scale, true, true);
        m.rocker_top = convert_brd_curve(&brd.deck, bl, scale, true, true);

        m
    };

    crate::geometry::sanitize_imported_model(&mut model);
    crate::geometry::calibrate_model_coordinates(&mut model);

    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn test_mini_simmons_bottom_smoothness() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let mut model = parse_brd(&bytes).expect("Failed to parse BRD");

        // Emulate the frontend's behavior of preserving the active cross section
        let basic_cs = crate::model::BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
            ..Default::default()
        };
        model.cross_sections = vec![basic_cs];

        let bounds = crate::geometry::get_board_bounds(&model);

        // Sweep longitudinally at a constant X = 3.0 inches (inside the concave belly of the board)
        let target_x = 3.0;
        let start_z = bounds.nose_z + 10.0; // avoid nose pointy end distortion
        let end_z = bounds.tip_z - 10.0; // avoid tail cap distortion

        let steps = 400;
        let mut elevations = Vec::new();

        for i in 0..=steps {
            let f = i as f32 / steps as f32;
            let z = start_z + (end_z - start_z) * f;
            let ctx = crate::geometry::ZRingContext::new(&model, z);

            let t_apex = ctx.blend.as_ref().map(|b| b.t_apex).unwrap_or(0.5);

            // Search for the exact U parameter corresponding to target_x within [0.0, t_apex]
            let mut best_u = t_apex * 0.5;
            let mut min_diff = f32::INFINITY;
            for step_u in 0..=200 {
                let u = (step_u as f32 / 200.0) * t_apex;
                let pt = ctx.get_point_at_uv(u, 1.0);
                let diff = (pt.x - target_x).abs();
                if diff < min_diff {
                    min_diff = diff;
                    best_u = u;
                }
            }

            let mut u_search = best_u;
            let mut search_step = t_apex / 200.0;
            for _ in 0..10 {
                search_step *= 0.5;
                let u_l = (u_search - search_step).max(0.0);
                let u_r = (u_search + search_step).min(t_apex);
                let pt_l = ctx.get_point_at_uv(u_l, 1.0);
                let pt_r = ctx.get_point_at_uv(u_r, 1.0);
                let diff_l = (pt_l.x - target_x).abs();
                let diff_r = (pt_r.x - target_x).abs();
                if diff_l < min_diff {
                    min_diff = diff_l;
                    u_search = u_l;
                } else if diff_r < min_diff {
                    min_diff = diff_r;
                    u_search = u_r;
                }
            }

            let final_pt = ctx.get_point_at_uv(u_search, 1.0);
            elevations.push((z, final_pt.y));
        }

        // Compute first and second derivatives
        let mut first_derivatives = Vec::new();
        let mut second_derivatives = Vec::new();

        for i in 0..elevations.len() - 1 {
            let (z0, y0) = elevations[i];
            let (z1, y1) = elevations[i + 1];
            let dz = z1 - z0;
            let dy = y1 - y0;
            first_derivatives.push(dy / dz);
        }

        for i in 0..first_derivatives.len() - 1 {
            let dy_dz0 = first_derivatives[i];
            let dy_dz1 = first_derivatives[i + 1];
            let z0 = elevations[i].0;
            let z1 = elevations[i + 1].0;
            let dz = z1 - z0;
            second_derivatives.push((dy_dz1 - dy_dz0) / dz);
        }

        let mut max_second_dev = 0.0_f32;
        for &d2 in &second_derivatives {
            if d2.abs() > max_second_dev {
                max_second_dev = d2.abs();
            }
        }

        println!("\n=== MINI SIMMONS SURFACE SMOOTHNESS ANALYSIS ===");
        println!("Max second derivative along Z: {}", max_second_dev);

        for i in (0..second_derivatives.len()).step_by(40) {
            println!(
                "Z = {:.2}\": Y = {:.5}\", dY/dZ = {:.5}, d2Y/dZ2 = {:.5}",
                elevations[i].0, elevations[i].1, first_derivatives[i], second_derivatives[i]
            );
        }
        println!("=================================================\n");

        // Assert that the surface does not have high-frequency ripples or sharp ridges.
        // A beautifully blended bottom rocker should have a tiny second derivative (e.g. < 0.05).
        assert!(
            max_second_dev < 0.02,
            "Surface is wavy or has sharp creases! Max second derivative is {}",
            max_second_dev
        );
    }

    #[test]
    fn test_generate_decrypted_brd_fixtures() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/");
        if !path.exists() {
            return;
        }

        let entries = fs::read_dir(&path).expect("Failed to read brd directory");
        for entry in entries {
            let entry = entry.expect("Failed to read directory entry");
            let file_path = entry.path();
            if file_path.extension().is_some_and(|ext| ext == "brd") {
                let bytes = fs::read(&file_path).expect("Failed to read BRD file");

                let decrypted_text = if bytes.starts_with(b"%BRD") {
                    decrypt_aku_shaper(&bytes)
                } else {
                    decompress_brd(&bytes)
                };

                if let Ok(text) = decrypted_text {
                    let mut txt_path = file_path.clone();
                    txt_path.set_extension("brd.txt");
                    fs::write(&txt_path, text).expect("Failed to write decrypted BRD text");
                }
            }
        }
    }

    #[test]
    fn test_egg_brd_tessellation_integrity() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/7'0-Egg.brd");

        if !path.exists() {
            println!("7'0-Egg.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        // Verify that there are no duplicate slice positions (stacked slices)
        let mut seen_zs: Vec<f32> = Vec::new();
        for cs in &model.cross_sections {
            if cs.control_points.is_empty() {
                continue;
            }
            let z = cs.control_points[0].z;
            for &prev_z in &seen_zs {
                assert!(
                    (z - prev_z).abs() > 1e-4,
                    "Stacked slice detected! Multiple cross-sections are mapped to the same Z-coordinate: {}",
                    z
                );
            }
            seen_zs.push(z);
        }

        // Generate the mesh to make sure it doesn't crash or flare out into NaN/extreme values
        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        assert!(mesh.vertices.len() > 0);
        let mut found_non_finite = false;
        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let y = mesh.vertices[i * 3 + 1];
            let z = mesh.vertices[i * 3 + 2];

            if !x.is_finite() || !y.is_finite() || !z.is_finite() {
                println!("\n=== DIAGNOSTIC: NON-FINITE VERTEX FOUND ===");
                println!("Vertex Index: {}", i);
                println!("Coordinates: [X={}, Y={}, Z={}]", x, y, z);

                let z_inches = z * 12.0;
                println!("Z-Coordinate in Inches: {}", z_inches);

                let bounds = crate::geometry::get_board_bounds(&model);
                println!(
                    "Board Bounds: nose_z={}, tip_z={}, notch_z={}, tip_t={}",
                    bounds.nose_z, bounds.tip_z, bounds.notch_z, bounds.tip_t
                );

                if let Some(outline) = &model.outline {
                    println!(
                        "Outline endpoints Z: nose={}, tail={}",
                        outline.control_points.first().unwrap().z,
                        outline.control_points.last().unwrap().z
                    );
                    let v_outer =
                        crate::geometry::find_v_at_z(outline, z_inches, 0.0, bounds.tip_t);
                    println!("Calculated v_outer at Z-ring: {}", v_outer);

                    let profile =
                        crate::geometry::get_board_profile_at_z(&model, z_inches, v_outer);
                    println!("Board Profile at Z-ring:\n  top_y={}\n  bot_y={}\n  apex_x={}\n  apex_y={}\n  tuck_x={}\n  tuck_y={}\n  shoulder_x={}\n  shoulder_y={}\n  half_width={}", 
                        profile.top_y, profile.bot_y, profile.apex_x, profile.apex_y, profile.tuck_x, profile.tuck_y, profile.shoulder_x, profile.shoulder_y, profile.half_width
                    );
                }
                println!("===========================================\n");
                found_non_finite = true;
                break;
            }
        }

        if found_non_finite {
            panic!("Test failed due to non-finite (NaN/Inf) vertices in the generated mesh.");
        }

        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];
            // Assert that the board width does not expand crazily beyond normal limits (e.g. 3 feet)
            assert!(
                x.abs() < 3.0,
                "Mesh flared out into extreme coordinate at Z={}: X={}",
                z,
                x
            );
        }
    }

    #[test]
    fn test_egg_brd_import() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/7'0-Egg.brd");

        if !path.exists() {
            println!("7'0-Egg.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let bounds = crate::geometry::get_board_bounds(&model);
        let profile = crate::geometry::get_board_profile_at_z(&model, bounds.tip_z - 0.5, 0.5);

        println!(
            "Tail Profile: top_y={}, bot_y={}",
            profile.top_y, profile.bot_y
        );
        println!(
            "\n--- FULL IMPORTED MODEL ---\n{:#?}\n---------------------------\n",
            model
        );

        assert!(
            profile.top_y - profile.bot_y > 0.05,
            "Tail pinched to zero! top: {}, bot: {}",
            profile.top_y,
            profile.bot_y
        );
    }

    #[test]
    fn test_egg_mesh_thickness_at_tail() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/7'0-Egg.brd");

        if !path.exists() {
            println!("7'0-Egg.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        // Find the vertices at the tail (Z max)
        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_z = bounds.tip_z * scale;

        let mut min_y = f32::INFINITY;
        let mut max_y = f32::NEG_INFINITY;

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            let y = mesh.vertices[i * 3 + 1];
            if (z - tail_z).abs() < 1e-3 {
                min_y = min_y.min(y);
                max_y = max_y.max(y);
            }
        }

        let bounds = crate::geometry::get_board_bounds(&model);
        let profile_tip =
            crate::geometry::get_board_profile_at_z(&model, bounds.tip_z, bounds.tip_t);
        println!("Bounds tip_z: {}", bounds.tip_z);
        println!(
            "Profile at tip_z: top_y={}, bot_y={}, apex_x={}",
            profile_tip.top_y, profile_tip.bot_y, profile_tip.apex_x
        );
        if let Some(r_top) = &model.rocker_top {
            println!(
                "Rocker Top end points: {:?}",
                &r_top.control_points[r_top.control_points.len().saturating_sub(3)..]
            );
        }
        if let Some(r_bot) = &model.rocker_bottom {
            println!(
                "Rocker Bottom end points: {:?}",
                &r_bot.control_points[r_bot.control_points.len().saturating_sub(3)..]
            );
        }

        let thickness_at_tail = (max_y - min_y) / scale;
        println!("Mesh thickness at exact tail: {}", thickness_at_tail);

        assert!(
            thickness_at_tail > 0.05,
            "Mesh tail is infinitely thin! Thickness: {}",
            thickness_at_tail
        );
    }

    #[test]
    fn test_bump_squash_stringer_tail_alignment() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd");

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let outline = model.outline.as_ref().expect("Missing outline");
        let rocker_top = model.rocker_top.as_ref().expect("Missing rocker top");

        let outline_tail_z = outline.control_points.last().unwrap().z;
        let rtop_tail_z = rocker_top.control_points.last().unwrap().z;

        // With unified endpoint synchronization implemented, both the outline and the
        // rockers are aligned to terminate precisely at the stripped squash corner.
        // Therefore, the discrepancy (top_diff) is now exactly 0.0.
        let top_diff = (outline_tail_z - rtop_tail_z).abs();

        assert_relative_eq!(top_diff, 0.0, epsilon = 1e-4);
    }

    #[test]
    fn test_bump_squash_nose_card_artifact() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd");

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let outline = model.outline.as_ref().expect("Missing outline");

        let p0 = outline.control_points[0];
        let p1 = outline.control_points[1];

        println!("Nose P0: {:?}", p0);
        println!("Nose P1: {:?}", p1);

        let dz = (p1.z - p0.z).abs();
        let dx = (p1.x - p0.x).abs();

        println!("Delta Z: {}", dz);
        println!("Delta X: {}", dx);

        // A proper nose curve should gradually increase in X as Z increases.
        // If X jumps massively while Z barely moves, it's a CAD artifact (cap) that wasn't stripped.
        assert!(
            !(dx > 0.1 && dz < 0.01),
            "Nose card artifact detected! The outline has a horizontal cap at the nose. P0: {:?}, P1: {:?} (dx: {}, dz: {})",
            p0, p1, dx, dz
        );
    }

    #[test]
    fn test_brd_decompression_and_parsing() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd");

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");

        // This will now seamlessly decrypt the AkuShaper binary blob and parse it!
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        assert_relative_eq!(model.length, 76.0, epsilon = 0.1);

        assert!(model.outline.is_some());
        assert!(model.rocker_bottom.is_some());
        assert!(model.rocker_top.is_some());

        let outline = model.outline.unwrap();
        assert!(outline.control_points.len() > 2);
    }

    #[test]
    fn test_mini_simmons_brd_import() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        // The nominal name is 5'4", but the actual CAD file length is ~63.5 inches.
        assert_relative_eq!(model.length, 63.5, epsilon = 0.1);

        assert!(model.outline.is_some());
        assert!(model.rocker_bottom.is_some());
        assert!(model.rocker_top.is_some());

        let outline = model.outline.as_ref().unwrap();
        assert!(outline.control_points.len() > 2);

        assert!(
            model.v_concave_tail > 0.0,
            "Mini Simmons should have tail concave extracted"
        );
        assert!(model.v_concave_nose >= 0.0);

        let bounds = crate::geometry::get_board_bounds(&model);
        let profile = crate::geometry::get_board_profile_at_z(&model, bounds.tip_z - 0.5, 0.5);

        assert!(
            profile.top_y - profile.bot_y > 0.05,
            "Tail pinched to zero! top: {}, bot: {}",
            profile.top_y,
            profile.bot_y
        );
    }

    #[test]
    fn test_brd_mesh_width_vs_outline_egg() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/7'0-Egg.brd");

        if !path.exists() {
            println!("7'0-Egg.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let mut engine = crate::SurferEngine::new();
        engine.update(crate::model::BoardAction::LoadDesign {
            state: Box::new(model.clone()),
        });

        let mesh = engine.compute_mesh();
        let scale = 1.0 / 12.0;

        println!("\n=== BRD MESH WIDTH VS OUTLINE DIAGNOSTIC ANALYSIS ===");
        let bounds = crate::geometry::get_board_bounds(&model);
        println!(
            "Board bounds (inches): nose_z = {:.4}, tip_z = {:.4}",
            bounds.nose_z, bounds.tip_z
        );
        println!("Board width (inches): model.width = {:.4}", model.width);

        let mut failures = 0;
        let steps = 15;
        for i in 1..steps {
            let f = i as f32 / steps as f32;
            let z_inches = bounds.nose_z + (bounds.tip_z - bounds.nose_z) * f;
            let z_scaled = z_inches * scale;

            // Evaluate the expected outline width analytically
            let outline_pt = crate::geometry::evaluate_composite_outline_at_z(&model, z_inches, f);
            let expected_x = outline_pt.x * scale; // Convert to feet to match mesh coords

            // Search for the corresponding vertex in the generated mesh at this Z coordinate
            let mut max_mesh_x = 0.0_f32;
            let mut found_vertex = false;
            for j in 0..(mesh.vertices.len() / 3) {
                let vx = mesh.vertices[j * 3];
                let vz = mesh.vertices[j * 3 + 2];

                if (vz - z_scaled).abs() < 2e-3 {
                    if vx > max_mesh_x {
                        max_mesh_x = vx;
                        found_vertex = true;
                    }
                }
            }

            if found_vertex {
                let diff = expected_x - max_mesh_x;
                let diff_inches = diff / scale;
                println!(
                    "Z = {:.2}\" (scaled: {:.4}): Outline X = {:.4} (\"{:?}), Mesh Max X = {:.4} (\"{:?}), Diff = {:.4} (\"{:?})",
                    z_inches, z_scaled, expected_x, expected_x / scale, max_mesh_x, max_mesh_x / scale, diff, diff_inches
                );
                // Expect the 3D mesh width to match the analytical outline within a tiny margin (0.25 inches)
                if diff_inches.abs() > 0.25 {
                    failures += 1;
                }
            } else {
                println!(
                    "Z = {:.2}\" (scaled: {:.4}): No corresponding vertex found in 3D mesh!",
                    z_inches, z_scaled
                );
            }
        }
        println!("=====================================================\n");

        assert_eq!(
            failures, 0,
            "Failed: Mesh is thinner than the analytical outline in {} sample points!",
            failures
        );
    }

    #[test]
    fn test_brd_import_endpoint_synchronization() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd");

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        let outline = model.outline.as_ref().expect("Missing outline");
        let rocker_bottom = model.rocker_bottom.as_ref().expect("Missing rocker bottom");
        let rocker_top = model.rocker_top.as_ref().expect("Missing rocker top");

        let outline_nose_z = outline.control_points.first().unwrap().z;
        let rbot_nose_z = rocker_bottom.control_points.first().unwrap().z;
        let rtop_nose_z = rocker_top.control_points.first().unwrap().z;

        let outline_tail_z = outline.control_points.last().unwrap().z;
        let rbot_tail_z = rocker_bottom.control_points.last().unwrap().z;
        let rtop_tail_z = rocker_top.control_points.last().unwrap().z;

        // Rocker and outline endpoints must share identical nose and tail bounds
        assert_relative_eq!(outline_nose_z, rbot_nose_z, epsilon = 1e-4);
        assert_relative_eq!(outline_nose_z, rtop_nose_z, epsilon = 1e-4);
        assert_relative_eq!(outline_tail_z, rbot_tail_z, epsilon = 1e-4);
        assert_relative_eq!(outline_tail_z, rtop_tail_z, epsilon = 1e-4);
    }

    #[test]
    fn test_brd_mesh_width_vs_outline_mini_simmons() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/5'4-Mini-Simmons.brd");

        if !path.exists() {
            println!("5'4-Mini-Simmons.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let mut model = parse_brd(&bytes).expect("Failed to parse BRD");

        // Emulate the frontend's behavior of preserving the active cross section
        let basic_cs = crate::model::BezierCurveData {
            control_points: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(6.0, -1.25, 0.0),
                Vec3::new(9.375, 0.0, 0.0),
                Vec3::new(6.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            tangents1: vec![
                Vec3::new(0.0, -1.25, 0.0),
                Vec3::new(4.0, -1.25, 0.0),
                Vec3::new(9.375, -0.5, 0.0),
                Vec3::new(8.0, 1.25, 0.0),
                Vec3::new(2.0, 1.25, 0.0),
            ],
            tangents2: vec![
                Vec3::new(2.0, -1.25, 0.0),
                Vec3::new(8.0, -1.25, 0.0),
                Vec3::new(9.375, 0.5, 0.0),
                Vec3::new(4.0, 1.25, 0.0),
                Vec3::new(0.0, 1.25, 0.0),
            ],
            weights: Some(vec![1.0, 1.0, 1.0, 1.0, 1.0]),
            ..Default::default()
        };
        model.cross_sections = vec![basic_cs];

        let mut engine = crate::SurferEngine::new();
        engine.update(crate::model::BoardAction::LoadDesign {
            state: Box::new(model.clone()),
        });

        let mesh = engine.compute_mesh();
        let scale = 1.0 / 12.0;

        println!("\n=== BRD MESH WIDTH VS OUTLINE DIAGNOSTIC ANALYSIS ===");
        let bounds = crate::geometry::get_board_bounds(&model);
        println!(
            "Board bounds (inches): nose_z = {:.4}, tip_z = {:.4}",
            bounds.nose_z, bounds.tip_z
        );
        println!("Board width (inches): model.width = {:.4}", model.width);

        let mut failures = 0;
        let steps = 10;
        for i in 1..steps {
            let f = i as f32 / steps as f32;
            let z_inches = bounds.nose_z + (bounds.tip_z - bounds.nose_z) * f;
            let z_scaled = z_inches * scale;

            // Evaluate the expected outline width analytically
            let outline_pt = crate::geometry::evaluate_composite_outline_at_z(&model, z_inches, f);
            let expected_x = outline_pt.x * scale; // Convert to feet to match mesh coords

            // Search for the corresponding vertex in the generated mesh at this Z coordinate
            let mut max_mesh_x = 0.0_f32;
            let mut found_vertex = false;
            for j in 0..(mesh.vertices.len() / 3) {
                let vx = mesh.vertices[j * 3];
                let vz = mesh.vertices[j * 3 + 2];

                if (vz - z_scaled).abs() < 1e-3 {
                    if vx > max_mesh_x {
                        max_mesh_x = vx;
                        found_vertex = true;
                    }
                }
            }

            if found_vertex {
                let diff = expected_x - max_mesh_x;
                let diff_inches = diff / scale;
                println!(
                    "Z = {:.2}\" (scaled: {:.4}): Outline X = {:.4} (\"{:?}), Mesh Max X = {:.4} (\"{:?}), Diff = {:.4} (\"{:?})",
                    z_inches, z_scaled, expected_x, expected_x / scale, max_mesh_x, max_mesh_x / scale, diff, diff_inches
                );
                if diff > 1e-4 {
                    failures += 1;
                }
            } else {
                println!(
                    "Z = {:.2}\" (scaled: {:.4}): No corresponding vertex found in 3D mesh!",
                    z_inches, z_scaled
                );
            }
        }
        println!("=====================================================\n");

        assert_eq!(
            failures, 0,
            "Failed: Mesh is thinner than the analytical outline in {} sample points!",
            failures
        );
    }

    #[test]
    fn test_longboard_tail_block_integrity() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/brd/6'10-Mini-Longboard.brd");

        if !path.exists() {
            println!("6'10-Mini-Longboard.brd fixture not found, skipping test.");
            return;
        }

        let bytes = fs::read(&path).expect("Failed to read BRD fixture");
        let model = parse_brd(&bytes).expect("Failed to parse longboard BRD");

        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        assert!(mesh.vertices.len() > 0);

        // 1. Watertightness / Hole Detection at the Tail
        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_z = bounds.tip_z * scale;

        use std::collections::HashMap;
        let mut edge_counts = HashMap::new();

        let get_vertex = |idx: u32| -> glam::Vec3 {
            let i = idx as usize * 3;
            glam::Vec3::new(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2])
        };

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i];
            let i2 = mesh.indices[i + 1];
            let i3 = mesh.indices[i + 2];

            let hash_pt = |v: glam::Vec3| -> (i32, i32, i32) {
                (
                    (v.x * 10000.0).round() as i32,
                    (v.y * 10000.0).round() as i32,
                    (v.z * 10000.0).round() as i32,
                )
            };

            let v1 = hash_pt(get_vertex(i1));
            let v2 = hash_pt(get_vertex(i2));
            let v3 = hash_pt(get_vertex(i3));

            if v1 == v2 || v2 == v3 || v3 == v1 {
                continue;
            }

            let mut add_edge = |a: (i32, i32, i32), b: (i32, i32, i32)| {
                let key = if a < b { (a, b) } else { (b, a) };
                *edge_counts.entry(key).or_insert(0) += 1;
            };

            add_edge(v1, v2);
            add_edge(v2, v3);
            add_edge(v3, v1);
        }

        let mut tail_holes = 0;
        for (edge, count) in &edge_counts {
            if *count == 1 {
                let z1 = (edge.0).2 as f32 / 10000.0;
                let z2 = (edge.1).2 as f32 / 10000.0;

                if (z1 - tail_z).abs() < 1.0 && (z2 - tail_z).abs() < 1.0 {
                    tail_holes += 1;
                }
            }
        }

        // We expect the tail block to be perfectly watertight
        assert_eq!(
            tail_holes, 0,
            "Found {} boundary edges (holes) near the tail block!",
            tail_holes
        );

        // 2. Normal Vector Outward Orientation at the Tail Block Apex
        // On a blunt squash tail, the side forms a vertical rail wall where multiple vertices
        // share the same maximum X coordinate. We resolve this tie by selecting the vertex closest
        // to the mid-rail height, which corresponds to the true rail apex (u = t_apex).
                let profile = crate::geometry::get_board_profile_at_z(&model, bounds.tip_z, bounds.tip_t);
        let mid_y = profile.apex_y;
        let mid_y_scaled = mid_y * scale;

        let mut best_x = 0.0_f32;
        let mut best_y_diff = f32::INFINITY;
        let mut apex_idx = None;
        let hull_vertex_count = cache.vertices.len() / 3;

        for i in 0..hull_vertex_count {
            let x = mesh.vertices[i * 3];
            let y = mesh.vertices[i * 3 + 1];
            let z = mesh.vertices[i * 3 + 2];
            if (z - tail_z).abs() < 2e-3 {
                let x_diff = x - best_x;
                if x_diff > 1e-4 {
                    // Strictly better X
                    best_x = x;
                    best_y_diff = (y - mid_y_scaled).abs();
                    apex_idx = Some(i);
                } else if x_diff.abs() <= 1e-4 {
                    // Tie/near-tie on the vertical wall, prefer the one closest to mid-rail height
                    let y_diff = (y - mid_y_scaled).abs();
                    if y_diff < best_y_diff {
                        best_x = x;
                        best_y_diff = y_diff;
                        apex_idx = Some(i);
                    }
                }
            }
        }

        let idx = apex_idx.expect("No vertices found at the absolute tail Z ring!");
        let normal = glam::Vec3::new(
            mesh.normals[idx * 3],
            mesh.normals[idx * 3 + 1],
            mesh.normals[idx * 3 + 2],
        );

        println!("=== DIAGNOSTIC TAIL APEX NORMAL ===");
        println!("Apex Vertex Index: {}", idx);
        println!(
            "Apex Coordinates: [X={:.5}, Y={:.5}, Z={:.5}]",
            mesh.vertices[idx * 3] / scale,
            mesh.vertices[idx * 3 + 1] / scale,
            mesh.vertices[idx * 3 + 2] / scale
        );
        println!(
            "Apex Normal Vector: [{:.5}, {:.5}, {:.5}]",
            normal.x, normal.y, normal.z
        );
        println!("===================================");

        // Under correct projection, the normal at the rail apex MUST point outward (having a strong X component)
        // instead of collapsing/twisting straight down to [0, -1, 0] or straight back to [0, 0, 1].
        assert!(
            normal.x > 0.5,
            "Normal at tail block rail apex is collapsed/twisted! Expected X component > 0.5, got: {:?}",
            normal
        );
    }

    #[test]
    fn deleted_test_longboard_tail_block_integrity_old() {
        let _ = env_logger::builder().is_test(true).try_init();
        let brd_text = r#"p01: 209.55
p02: 210.89806848025611
p03: 6.984913328972571
p04: 57.0992
p32:
(
[0.0 0.0 0.0 0.0 0.0 1.265930]
[0.000000 8.534076 0.000000 6.821705 0.000000 9.579073]
[110.746779 28.500183 17.621581 27.570594 202.835824 29.419429]
[209.550000 0.000000 208.045616 17.424436 211.710609 -25.025125]
)
p33:
(
[0.0 5.667065 0.0 5.667065 17.592118 1.559067]
[106.697763 0.003041 60.522539 0.156619 188.016909 -0.168681]
[209.550000 9.820483 204.887319 6.978153 229.675960 22.089092]
)
p34:
(
[0.0 5.667065 0.0 5.667065 0.0 5.667065]
[0.000000 8.283940 0.000000 8.283940 14.699430 7.421540]
[105.340520 6.992051 42.257961 7.285992 166.495664 6.707091]
[209.550000 11.590853 197.161503 8.571049 209.550000 11.430290]
[209.550000 9.820483 209.550000 9.820483 209.550000 9.820483]
)
p35:
(
(p36 0.0 -1.0 -1.0
[0.0 0.0 0.0 0.0 0.0 0.0]
)
(p36 1.905000 -1.0 -1.0
[0.0 0.0 -4.006033 0.0 0.0 0.0]
[10.327575 0.365280 10.276205 0.238585 10.327575 0.365280]
[10.088197 1.992449 10.698638 1.262662 9.077190 3.201117]
[0.0 2.927339 7.111578 2.927339 -4.464456 2.927339]
)
(p36 22.875000 -1.0 -1.0
[0.0 0.0 -7.416961 0.0 0.0 0.0]
[19.120962 0.279578 8.088721 0.174996 19.120962 0.279578]
[17.813393 3.945744 19.862842 3.426332 15.991637 4.407450]
[0.0 4.984060 1.288280 4.984060 -8.265705 4.984060]
)
(p36 105.132188 -1.0 -1.0
[0.0 0.0 -10.749720 0.0 23.618125 0.0]
[27.316829 0.373041 26.422689 0.333860 28.027633 0.404188]
[28.377904 2.903213 28.586509 1.582857 27.719829 7.068477]
[0.0 6.984288 2.799506 6.984288 -11.979842 6.984288]
)
(p36 186.690000 -1.0 -1.0
[0.0 0.0 -9.022187 0.0 20.470479 0.0]
[22.753494 0.124706 22.318800 0.093490 22.993716 0.141957]
[23.408810 2.029629 23.609009 0.546736 23.072116 4.523559]
[0.0 4.936812 12.666112 4.936812 -10.054623 4.936812]
)
(p36 209.550000 -1.0 -1.0
[-0.0 0.0 -0.0 0.0 -0.0 0.0]
)
)
"#;

        let encrypted_bytes = crate::brd_exporter::encrypt_aku_shaper(brd_text).unwrap();
        let model = parse_brd(&encrypted_bytes).expect("Failed to parse longboard BRD");

        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        // Print core parameters
        println!("=== LONGBOARD INTEGRITY DIAGNOSTIC INFO ===");
        println!("Model length: {}", model.length);
        println!("Model width: {}", model.width);
        println!("Model thickness: {}", model.thickness);
        let bounds = crate::geometry::get_board_bounds(&model);
        println!(
            "Bounds: nose_z: {}, tip_z: {}, notch_z: {}",
            bounds.nose_z, bounds.tip_z, bounds.notch_z
        );

        // Count unique Z coordinates
        let scale = 1.0 / 12.0;
        let mut unique_zs: Vec<f32> = mesh
            .vertices
            .chunks_exact(3)
            .map(|v| v[2] / scale)
            .collect();
        unique_zs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        unique_zs.dedup_by(|a, b| (*a - *b).abs() < 1e-4);
        println!("Unique Z coordinates count in mesh: {}", unique_zs.len());
        if let Some(&last_z) = unique_zs.last() {
            println!(
                "Last Z in mesh: {} inches (tip_z is {} inches)",
                last_z, bounds.tip_z
            );
        }

        // Print vertices exactly at the tail
        let tail_z_scaled = bounds.tip_z * scale;
        println!("Vertices at absolute tail (Z = {}):", bounds.tip_z);
        let mut tail_vert_count = 0;
        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let y = mesh.vertices[i * 3 + 1];
            let z = mesh.vertices[i * 3 + 2];
            if (z - tail_z_scaled).abs() < 2e-3 {
                tail_vert_count += 1;
                if tail_vert_count <= 25 {
                    println!(
                        "  Vertex {}: [X={:.5}, Y={:.5}, Z={:.5}]",
                        i,
                        x / scale,
                        y / scale,
                        z / scale
                    );
                }
            }
        }
        println!("Total vertices at absolute tail: {}", tail_vert_count);

        // Check if there are any cap vertices (vertices with non-hull UV coordinates or different normals)
        // Cap vertices have custom UVs, let's see their coordinates
        println!("Checking for flat-facing normals near tail:");
        let mut cap_vert_count = 0;
        for i in 0..(mesh.vertices.len() / 3) {
            let nz = mesh.normals[i * 3 + 2];
            if nz > 0.95 {
                let x = mesh.vertices[i * 3];
                let y = mesh.vertices[i * 3 + 1];
                let z = mesh.vertices[i * 3 + 2];
                cap_vert_count += 1;
                if cap_vert_count <= 10 {
                    println!("  Cap Vertex {}: [X={:.5}, Y={:.5}, Z={:.5}] Normal: [{:.5}, {:.5}, {:.5}]", i, x / scale, y / scale, z / scale, mesh.normals[i * 3], mesh.normals[i * 3 + 1], nz);
                }
            }
        }
        println!(
            "Total cap vertices (flat-facing normals): {}",
            cap_vert_count
        );
        println!("===========================================");

        // 1. Watertightness / Hole Detection at the Tail
        let tail_z = bounds.tip_z * scale;

        use std::collections::HashMap;
        let mut edge_counts = HashMap::new();

        let get_vertex = |idx: u32| -> glam::Vec3 {
            let i = idx as usize * 3;
            glam::Vec3::new(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2])
        };

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i];
            let i2 = mesh.indices[i + 1];
            let i3 = mesh.indices[i + 2];

            let hash_pt = |v: glam::Vec3| -> (i32, i32, i32) {
                (
                    (v.x * 10000.0).round() as i32,
                    (v.y * 10000.0).round() as i32,
                    (v.z * 10000.0).round() as i32,
                )
            };

            let v1 = hash_pt(get_vertex(i1));
            let v2 = hash_pt(get_vertex(i2));
            let v3 = hash_pt(get_vertex(i3));

            if v1 == v2 || v2 == v3 || v3 == v1 {
                continue;
            }

            let mut add_edge = |a: (i32, i32, i32), b: (i32, i32, i32)| {
                let key = if a < b { (a, b) } else { (b, a) };
                *edge_counts.entry(key).or_insert(0) += 1;
            };

            add_edge(v1, v2);
            add_edge(v2, v3);
            add_edge(v3, v1);
        }

        let mut tail_holes = 0;
        println!("Boundary edges near tail:");
        for (edge, count) in &edge_counts {
            if *count == 1 {
                let z1 = (edge.0).2 as f32 / 10000.0;
                let z2 = (edge.1).2 as f32 / 10000.0;

                if (z1 - tail_z).abs() < 1.0 && (z2 - tail_z).abs() < 1.0 {
                    let v1_x = (edge.0).0 as f32 / 10000.0;
                    let v1_y = (edge.0).1 as f32 / 10000.0;
                    let v1_z = (edge.0).2 as f32 / 10000.0;
                    let v2_x = (edge.1).0 as f32 / 10000.0;
                    let v2_y = (edge.1).1 as f32 / 10000.0;
                    let v2_z = (edge.1).2 as f32 / 10000.0;
                    println!(
                        "  Edge: [X={:.5}, Y={:.5}, Z={:.5}] -> [X={:.5}, Y={:.5}, Z={:.5}]",
                        v1_x / scale,
                        v1_y / scale,
                        v1_z / scale,
                        v2_x / scale,
                        v2_y / scale,
                        v2_z / scale
                    );
                    tail_holes += 1;
                }
            }
        }

        // We expect the tail block to be perfectly watertight
        assert_eq!(
            tail_holes, 0,
            "Found {} boundary edges (holes) near the tail block!",
            tail_holes
        );
    }
}
