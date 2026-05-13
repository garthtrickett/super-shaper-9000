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

    Some(BezierCurveData {
        control_points,
        tangents1,
        tangents2,
        weights: None,
    })
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
    hasher.update(&salt);
    let mut hash = hasher.finalize();

    for _ in 1..20 {
        let mut next_hasher = Md5::new();
        next_hasher.update(&hash);
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

fn parse_aku_slice_curve(lines: &mut std::str::Lines, slice_z: f32, scale: f32) -> Option<BezierCurveData> {
    let mut control_points = Vec::new();
    let mut tangents1 = Vec::new();
    let mut tangents2 = Vec::new();

    while let Some(line) = lines.next() {
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
            let floats: Vec<f32> = content.split(|c| c == ',' || c == ' ')
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().parse::<f32>().unwrap_or(0.0))
                .collect();
            
            if floats.len() >= 6 {
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
        })
    }
}

fn parse_aku_slices(lines: &mut std::str::Lines, board_length: f32, scale: f32) -> Vec<BezierCurveData> {
    let mut slices = Vec::new();
    
    while let Some(line) = lines.next() {
        let line = line.trim();
        if line == ")" {
            break;
        }
        if line.starts_with("(p36") || line.starts_with("p36") {
            let clean = line.replace('(', "").replace(')', "");
            let parts: Vec<&str> = clean.split(|c| c == ' ' || c == '\t').filter(|s| !s.is_empty()).collect();
            if parts.len() >= 2 {
                let px = parts[1].parse::<f32>().unwrap_or(0.0);
                let slice_z = (board_length / 2.0 - px) * scale;
                
                if let Some(curve) = parse_aku_slice_curve(lines, slice_z, scale) {
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

    while let Some(line) = lines.next() {
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
                .split(|c| c == ',' || c == ' ')
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

                Some(BezierCurveData {
            control_points,
            tangents1,
            tangents2,
            weights: None,
        })
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

    Ok(model)
}

pub fn parse_brd(bytes: &[u8]) -> Result<BoardModel, String> {
    log::info!("[Rust Engine] parse_brd: Beginning BRD parsing pipeline");

    // 1. Is it an AkuShaper proprietary encrypted format?
    if bytes.starts_with(b"%BRD") {
        log::info!(
            "[Rust Engine] Detected AkuShaper encrypted format. Beginning PKCS#5 decryption..."
        );
        let decrypted_text = decrypt_aku_shaper(bytes)?;
        log::debug!("[Rust Engine] AkuShaper decrypted successfully.");
        return parse_aku_shaper(&decrypted_text);
    }

    // 2. Otherwise, fall back to BoardCAD ZLIB/XML format
    let xml = decompress_brd(bytes)?;
    let start_idx = xml.find('<').unwrap_or(0);
    let xml_slice = &xml[start_idx..];
    let sanitized = xml_slice
        .replace("<Ref. point>", "<Ref_point>")
        .replace("</Ref. point>", "</Ref_point>");

    let brd: BrdBoard =
        quick_xml::de::from_str(&sanitized).map_err(|e| format!("XML parsing error: {}", e))?;

    let mut model = BoardModel::default();
    let bl = brd.length.unwrap_or(0.0);
    let scale = if bl > 130.0 { 1.0 / 2.54 } else { 1.0 };

    model.length = bl * scale;
    model.width = brd.width.unwrap_or(0.0) * scale;
    model.thickness = brd.thickness.unwrap_or(0.0) * scale;

    model.outline = convert_brd_curve(&brd.outline, bl, scale, false, true);
    model.rocker_bottom = convert_brd_curve(&brd.bottom, bl, scale, true, true);
    model.rocker_top = convert_brd_curve(&brd.deck, bl, scale, true, true);

    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use std::fs;
    use std::path::PathBuf;

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
        assert!(outline.control_points.len() > 5);
    }
}
