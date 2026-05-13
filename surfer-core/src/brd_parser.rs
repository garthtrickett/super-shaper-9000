use crate::model::{BezierCurveData, BoardModel};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use glam::Vec3;
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

    // The text header is usually small (e.g. `%BRD-1.02s00` = 12 bytes).
    // We scan the first 128 bytes to gracefully bypass any padding or header structures.
    let max_offset = bytes.len().min(128);

    for offset in 0..max_offset {
        let compressed_data = &bytes[offset..];

        // 1. Try ZLIB (Standard Java DeflaterOutputStream)
        let mut z_decoder = ZlibDecoder::new(compressed_data);
        let mut out = Vec::new();
        if z_decoder.read_to_end(&mut out).is_ok() {
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
        if raw_decoder.read_to_end(&mut out).is_ok() {
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
        if gz_decoder.read_to_end(&mut out).is_ok() {
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
pub fn parse_brd(bytes: &[u8]) -> Result<BoardModel, String> {
    log::info!("[Rust Engine] parse_brd: Beginning BRD parsing pipeline");
    let xml = decompress_brd(bytes)?;

    // Like S3DX, strip out incompatible unescaped characters before AST serialization
    let sanitized = xml
        .replace("<Ref. point>", "<Ref_point>")
        .replace("</Ref. point>", "</Ref_point>");

    let brd: BrdBoard =
        quick_xml::de::from_str(&sanitized).map_err(|e| format!("XML parsing error: {}", e))?;

    let mut model = BoardModel::default();
    let bl = brd.length.unwrap_or(0.0);

    // Auto-detect unit metric via heuristic (over 130 means they're likely using Centimeters)
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

        let xml = decompress_brd(&bytes).expect("Failed to decompress BRD");

        // Grug-brain debug: see the actual XML content
        println!(
            "--- XML HEAD ---\n{}\n---------------",
            &xml[..xml.len().min(500)]
        );

        assert!(xml.to_lowercase().contains("<board>"));
        assert!(xml.contains("<length>"));

        let model = parse_brd(&bytes).expect("Failed to parse BRD");

        // A 6'4\" board should be exactly 76.0 inches
        assert_relative_eq!(model.length, 76.0, epsilon = 0.1);

        assert!(model.outline.is_some());
        assert!(model.rocker_bottom.is_some());
        assert!(model.rocker_top.is_some());

        let outline = model.outline.unwrap();
        assert!(outline.control_points.len() > 5);
    }
}
