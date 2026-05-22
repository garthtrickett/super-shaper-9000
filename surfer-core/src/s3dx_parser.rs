use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Shape3dDesign {
    #[serde(rename = "Board")]
    pub board: S3dxBoard,
}

#[derive(Debug, Deserialize)]
pub struct S3dxBoard {
    #[serde(rename = "Length")]
    pub length: f32,
    #[serde(rename = "Width")]
    pub width: f32,
    #[serde(rename = "Thickness")]
    pub thickness: f32,
    #[serde(rename = "Volume")]
    pub volume: Option<f32>,

    #[serde(rename = "VConcaveTail")]
    pub v_concave_tail: Option<f32>,
    #[serde(rename = "VConcaveNose")]
    pub v_concave_nose: Option<f32>,
    #[serde(rename = "RailCoefficientTail")]
    pub rail_coefficient_tail: Option<f32>,
    #[serde(rename = "RailCoefficientNose")]
    pub rail_coefficient_nose: Option<f32>,
    #[serde(rename = "ThicknessZStretch")]
    pub thickness_z_stretch: Option<f32>,
    #[serde(rename = "TailType")]
    pub tail_type: Option<String>,
    #[serde(rename = "SwallowDepth")]
    pub swallow_depth: Option<f32>,

    #[serde(rename = "DeckComputed")]
    pub deck_computed: Option<u32>,
    #[serde(rename = "ThicknessCurve")]
    pub thickness_curve: Option<S3dxCurveContainer>,
    #[serde(rename = "Otl")]
    pub otl: Option<S3dxCurveContainer>,
    #[serde(rename = "StrBot")]
    pub str_bot: Option<S3dxCurveContainer>,
    #[serde(rename = "StrDeck")]
    pub str_deck: Option<S3dxCurveContainer>,

    #[serde(rename = "curveDefTop1")]
    pub curve_def_top1: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefTop2")]
    pub curve_def_top2: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefTop3")]
    pub curve_def_top3: Option<S3dxBezierDefContainer>,

    #[serde(rename = "curveDefSide0")]
    pub curve_def_side0: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefSide2")]
    pub curve_def_side2: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefSide4")]
    pub curve_def_side4: Option<S3dxBezierDefContainer>,

    #[serde(rename = "ProfilTopDef")]
    pub profil_top_def: Option<S3dxBezierDefContainer>,
    #[serde(rename = "ProfilBotDef")]
    pub profil_bot_def: Option<S3dxBezierDefContainer>,

    #[serde(rename = "Number_of_slices")]
    pub number_of_slices: Option<usize>,

    #[serde(rename = "Couple")]
    pub couples: Option<Vec<S3dxCouplesContainer>>,

    #[serde(rename = "Calque")]
    pub calques: Option<Vec<S3dxCalqueContainer>>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxCurveContainer {
    #[serde(rename = "Bezier3d")]
    pub bezier3d: Option<S3dxBezier3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxBezierDefContainer {
    #[serde(rename = "BezierDef")]
    pub bezier_def: Option<S3dxBezierDef>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxCouplesContainer {
    #[serde(rename = "Bezier3d")]
    pub bezier3d: Option<S3dxBezier3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxCalqueContainer {
    #[serde(rename = "Calque3D")]
    pub calque3d: Option<S3dxCalque3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxCalque3d {
    #[serde(rename = "Nom")]
    pub nom: Option<String>,
    #[serde(rename = "TypeCalque")]
    pub type_calque: Option<u32>,
    #[serde(rename = "Actif")]
    pub actif: Option<u32>,
    #[serde(rename = "XMax")]
    pub x_max: Option<f32>,
    #[serde(rename = "OtlExt")]
    pub otl_ext: Option<S3dxCurveContainer>,
    #[serde(rename = "OtlInt")]
    pub otl_int: Option<S3dxCurveContainer>,
    #[serde(rename = "Depth")]
    pub depth: Option<f32>,
    #[serde(rename = "DeckBot")]
    pub deck_bot: Option<u32>,
    #[serde(rename = "Couple")]
    pub couples: Option<Vec<S3dxCouplesContainer>>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxBezierDef {
    #[serde(rename = "Bezier3d")]
    pub bezier3d: Option<S3dxBezier3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxBezier3d {
    #[serde(rename = "Name")]
    pub name: Option<String>,
    #[serde(rename = "Plan")]
    pub plan: Option<u8>,
    #[serde(rename = "Control_points")]
    pub control_points: Option<S3dxPolygonContainer>,
    #[serde(rename = "Tangents_1")]
    pub tangents_1: Option<S3dxPolygonContainer>,
    #[serde(rename = "Tangents_2")]
    pub tangents_2: Option<S3dxPolygonContainer>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxPolygonContainer {
    #[serde(rename = "Polygone3d")]
    pub polygone3d: Option<S3dxPolygon3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxPolygon3d {
    #[serde(rename = "Point3d")]
    pub point3d: Option<Vec<S3dxPoint3d>>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxPoint3d {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub u: Option<f32>,
}

use crate::model::{BezierCurveData, BoardModel};
use glam::Vec3;

fn convert_s3dx_bezier3d(
    bezier3d: &S3dxBezier3d,
    board_length: f32,
    scale: f32,
) -> Option<BezierCurveData> {
    let mut control_points = Vec::new();
    let mut weights = Vec::new();
    if let Some(poly) = &bezier3d.control_points {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                control_points.push(Vec3::new(
                    p.y * scale,
                    p.z * scale,
                    (board_length / 2.0 - p.x) * scale,
                ));
                let u_val = p.u.unwrap_or(-1.0);
                // Map S3DX default of -1.0 to our engine's baseline of 1.0
                weights.push(if (u_val - (-1.0)).abs() < 1e-5 {
                    1.0
                } else {
                    u_val
                });
            }
        }
    }

    let mut tangents1 = Vec::new();
    if let Some(poly) = &bezier3d.tangents_1 {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                tangents1.push(Vec3::new(
                    p.y * scale,
                    p.z * scale,
                    (board_length / 2.0 - p.x) * scale,
                ));
            }
        }
    }

    let mut tangents2 = Vec::new();
    if let Some(poly) = &bezier3d.tangents_2 {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                tangents2.push(Vec3::new(
                    p.y * scale,
                    p.z * scale,
                    (board_length / 2.0 - p.x) * scale,
                ));
            }
        }
    }

    if control_points.is_empty() {
        return None;
    }

    let is_longitudinal = bezier3d.plan.unwrap_or(1) != 3;

    // S3DX conventionally maps from Tail to Nose. We reverse this to match our
    // internal engine logic where t=0 evaluates to the Nose.
    if is_longitudinal {
        control_points.reverse();
        weights.reverse();
        let old_t1 = tangents1;
        let old_t2 = tangents2;
        tangents1 = old_t2.into_iter().rev().collect();
        tangents2 = old_t1.into_iter().rev().collect();
    }

    let all_ones = weights.iter().all(|&w| (w - 1.0).abs() < 1e-5);
    let final_weights = if weights.is_empty() || all_ones {
        None
    } else {
        Some(weights)
    };

    Some(BezierCurveData {
        control_points,
        tangents1,
        tangents2,
        weights: final_weights,
        apex_ratio: None,
        tuck_ratio: None,
    })
}

fn convert_s3dx_curve(
    s3dx_curve: &Option<S3dxCurveContainer>,
    board_length: f32,
    scale: f32,
) -> Option<BezierCurveData> {
    let bezier3d = s3dx_curve.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d, board_length, scale)
}

fn convert_s3dx_bezier_def(
    s3dx_def: &Option<S3dxBezierDefContainer>,
    board_length: f32,
    scale: f32,
) -> Option<BezierCurveData> {
    let bezier3d = s3dx_def.as_ref()?.bezier_def.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d, board_length, scale)
}

fn convert_s3dx_couples(
    s3dx_couples: &Option<S3dxCouplesContainer>,
    board_length: f32,
    scale: f32,
) -> Option<BezierCurveData> {
    let bezier3d = s3dx_couples.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d, board_length, scale)
}

fn preprocess_xml_thickness(xml: &str) -> String {
    let mut result = xml.to_string();
    let mut search_start = 0;
    while let Some(thick_idx) = result[search_start..]
        .find("<Thickness>")
        .map(|idx| search_start + idx)
    {
        let after_thick = &result[thick_idx + "<Thickness>".len()..];
        if let Some(non_ws_idx) = after_thick.find(|c: char| !c.is_whitespace()) {
            if after_thick[non_ws_idx..].starts_with("<Bezier3d>") {
                // This <Thickness> tag encloses a curve, rename it to prevent Serde conflict with the float scalar
                result.replace_range(
                    thick_idx..thick_idx + "<Thickness>".len(),
                    "<ThicknessCurve>",
                );

                // Find the matching closing tag after the enclosed Bezier3d
                if let Some(bezier_close_idx) = result[thick_idx..].find("</Bezier3d>") {
                    let abs_bezier_close_idx = thick_idx + bezier_close_idx;
                    if let Some(thick_close_idx) =
                        result[abs_bezier_close_idx..].find("</Thickness>")
                    {
                        let abs_thick_close_idx = abs_bezier_close_idx + thick_close_idx;
                        result.replace_range(
                            abs_thick_close_idx..abs_thick_close_idx + "</Thickness>".len(),
                            "</ThicknessCurve>",
                        );
                    }
                }
                search_start = thick_idx + "<ThicknessCurve>".len();
                continue;
            }
        }
        search_start = thick_idx + "<Thickness>".len();
    }
    result
}

pub fn parse_s3dx(xml: &str) -> Result<BoardModel, String> {
    // S3DX files often contain unescaped ampersands in text fields which breaks standard XML parsers.
    let mut sanitized = String::with_capacity(xml.len() + 100);
    let mut chars = xml.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '&' {
            let peek: String = chars.clone().take(6).collect();
            if peek.starts_with("amp;")
                || peek.starts_with("lt;")
                || peek.starts_with("gt;")
                || peek.starts_with("quot;")
                || peek.starts_with("apos;")
                || peek.starts_with("#")
            {
                sanitized.push('&');
            } else {
                sanitized.push_str("&amp;");
            }
        } else {
            sanitized.push(c);
        }
    }

    sanitized = sanitized
        .replace("<Ref. point>", "<Ref_point>")
        .replace("</Ref. point>", "</Ref_point>");

    // Dynamically replace all <Couples_X> with <Couple> so Serde can parse them into a Vec.
    // We scan a reasonably high number of potential slices (e.g. 100) which far exceeds realistic CAD limits.
    for i in 0..100 {
        let start_tag = format!("<Couples_{}>", i);
        let end_tag = format!("</Couples_{}>", i);
        if sanitized.contains(&start_tag) {
            sanitized = sanitized
                .replace(&start_tag, "<Couple>")
                .replace(&end_tag, "</Couple>");
        }

        let start_tag_calque = format!("<Calque_{}>", i);
        let end_tag_calque = format!("</Calque_{}>", i);
        if sanitized.contains(&start_tag_calque) {
            sanitized = sanitized
                .replace(&start_tag_calque, "<Calque>")
                .replace(&end_tag_calque, "</Calque>");
        }
    }

    // Preprocess the XML to safely isolate the thickness Bezier curve from the float scalar
    sanitized = preprocess_xml_thickness(&sanitized);

    let design: Shape3dDesign =
        quick_xml::de::from_str(&sanitized).map_err(|e| format!("XML parsing error: {}", e))?;

    let mut model: BoardModel = design.board.into();
    crate::geometry::calibrate_model_coordinates(&mut model);
    crate::geometry::sanitize_imported_model(&mut model);

    Ok(model)
}

impl From<S3dxBoard> for BoardModel {
    fn from(s3dx: S3dxBoard) -> Self {
        let mut model = BoardModel::default();
        let bl = s3dx.length;
        // Safely infer CM to Inches if the board is unreasonably long (> 130 units)
        let scale = if bl > 130.0 { 1.0 / 2.54 } else { 1.0 };

        model.length = bl * scale;
        model.width = s3dx.width * scale;
        model.thickness = s3dx.thickness * scale;

        model.v_concave_tail = s3dx.v_concave_tail.unwrap_or(0.0) * scale;
        model.v_concave_nose = s3dx.v_concave_nose.unwrap_or(0.0) * scale;
        model.rail_coefficient_tail = s3dx.rail_coefficient_tail.unwrap_or(1.0);
        model.rail_coefficient_nose = s3dx.rail_coefficient_nose.unwrap_or(1.0);
        model.thickness_z_stretch = s3dx.thickness_z_stretch.unwrap_or(1.0);
        model.tail_type = s3dx.tail_type.unwrap_or_else(|| "squash".to_string());
        model.swallow_depth = s3dx.swallow_depth.unwrap_or(0.0) * scale;

        model.outline = convert_s3dx_curve(&s3dx.otl, bl, scale);

        let rocker_bottom = convert_s3dx_curve(&s3dx.str_bot, bl, scale);
        model.rocker_bottom = rocker_bottom.clone();

        // If the S3DX design computes the deck profile relative to the bottom rocker + thickness spline
        if s3dx.deck_computed.unwrap_or(0) != 0 && s3dx.thickness_curve.is_some() {
            let thickness_curve =
                convert_s3dx_curve(&s3dx.thickness_curve, bl, scale).unwrap_or_default();
            if let Some(bot_curve) = &rocker_bottom {
                let mut control_points = Vec::new();
                let mut tangents1 = Vec::new();
                let mut tangents2 = Vec::new();

                let steps = 50;
                let bounds_nose_z = -model.length / 2.0;
                let bounds_tip_z = model.length / 2.0;

                for i in 0..=steps {
                    let f = i as f32 / steps as f32;
                    let z = bounds_nose_z + (bounds_tip_z - bounds_nose_z) * f;

                    let bot_y = crate::geometry::evaluate_bezier_at_z(bot_curve, z, f).y;
                    let thick_y = crate::geometry::evaluate_bezier_at_z(&thickness_curve, z, f).y;

                    let new_p = Vec3::new(0.0, bot_y + thick_y, z);
                    control_points.push(new_p);
                    tangents1.push(new_p);
                    tangents2.push(new_p);
                }

                model.rocker_top = Some(BezierCurveData {
                    control_points,
                    tangents1,
                    tangents2,
                    weights: Some(vec![1.0; steps + 1]),
                    ..Default::default()
                });
            } else {
                model.rocker_top = convert_s3dx_curve(&s3dx.str_deck, bl, scale);
            }
        } else {
            model.rocker_top = convert_s3dx_curve(&s3dx.str_deck, bl, scale);
        }

        model.rail_outline = convert_s3dx_bezier_def(&s3dx.curve_def_top1, bl, scale);
        model.apex_outline = convert_s3dx_bezier_def(&s3dx.curve_def_top2, bl, scale);
        model.deck_shoulder = convert_s3dx_bezier_def(&s3dx.curve_def_top3, bl, scale);

        log::info!("[S3DX Parser] Assigning Apex Rocker...");
        model.apex_rocker = convert_s3dx_bezier_def(&s3dx.curve_def_side2, bl, scale)
            .or_else(|| convert_s3dx_bezier_def(&s3dx.profil_top_def, bl, scale));

        let mut cross_sections = Vec::new();
        if let Some(couples) = s3dx.couples {
            for c in couples {
                if let Some(cs) = convert_s3dx_couples(&Some(c), bl, scale) {
                    cross_sections.push(cs);
                }
            }
        }

        cross_sections.sort_by(|a, b| {
            let za = a.control_points.first().map(|p| p.z).unwrap_or(0.0);
            let zb = b.control_points.first().map(|p| p.z).unwrap_or(0.0);
            za.partial_cmp(&zb).unwrap()
        });

        model.cross_sections = cross_sections;

        let mut outline_layers = Vec::new();
        let mut bottom_channels = Vec::new();

        if let Some(calques) = s3dx.calques {
            for c in calques {
                if let Some(calque) = c.calque3d {
                    let name = calque.nom.clone().unwrap_or_else(|| "Layer".to_string());
                    let type_calque = calque.type_calque.unwrap_or(0);
                    let x_max = calque.x_max.unwrap_or(0.0);

                    if type_calque == 8 || type_calque == 4 {
                        log::info!(
                            "[S3DX Parser] Ignoring non-structural Calque (Type {}): {}",
                            type_calque,
                            name
                        );
                        continue;
                    }

                    let otl_ext =
                        convert_s3dx_curve(&calque.otl_ext, bl, scale).unwrap_or_default();
                    let otl_int =
                        convert_s3dx_curve(&calque.otl_int, bl, scale).unwrap_or_default();

                    let mut is_swallow_geom = false;
                    let mut swallow_depth_calc = 0.0;
                    if !otl_ext.control_points.is_empty() {
                        let tail_z = bl / 2.0 * scale;
                        let has_prong = otl_ext
                            .control_points
                            .iter()
                            .any(|p| (p.z - tail_z).abs() < 1e-2 && p.x > 1e-2);
                        let notch_point = otl_ext.control_points.iter().find(|p| p.x < 1e-2);
                        if has_prong {
                            if let Some(np) = notch_point {
                                is_swallow_geom = true;
                                swallow_depth_calc = tail_z - np.z;
                            }
                        }
                    }

                    // Intercept messy Shape3D Swallow Tail hacks and promote them to clean semantic native properties
                    if type_calque == 32
                        || name.to_uppercase().contains("SWALLOW")
                        || is_swallow_geom
                    {
                        model.tail_type = "swallow".to_string();
                        let mut depth_s3dx = x_max * scale;
                        if depth_s3dx == 0.0 {
                            depth_s3dx = swallow_depth_calc;
                        }
                        if depth_s3dx == 0.0 {
                            if let Some(ext) = &calque.otl_ext {
                                if let Some(b) = &ext.bezier3d {
                                    if let Some(cp) = &b.control_points {
                                        if let Some(poly) = &cp.polygone3d {
                                            if let Some(pts) = &poly.point3d {
                                                for p in pts {
                                                    if p.x * scale > depth_s3dx {
                                                        depth_s3dx = p.x * scale;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        model.swallow_depth = depth_s3dx;
                        continue;
                    }

                    let deck_bot = calque.deck_bot.unwrap_or(512);
                    let depth_val = calque.depth.unwrap_or(0.0) * scale;

                    if deck_bot == 256 || name.to_lowercase().contains("channel") {
                        let mut depth_curve = BezierCurveData::default();
                        if depth_curve.control_points.is_empty()
                            && !otl_ext.control_points.is_empty()
                        {
                            let z_start = otl_ext
                                .control_points
                                .first()
                                .map(|p| p.z)
                                .unwrap_or(-bl / 2.0);
                            let z_end = otl_ext
                                .control_points
                                .last()
                                .map(|p| p.z)
                                .unwrap_or(bl / 2.0);

                            depth_curve = BezierCurveData {
                                control_points: vec![
                                    Vec3::new(0.0, depth_val, z_start),
                                    Vec3::new(0.0, depth_val, z_end),
                                ],
                                tangents1: vec![
                                    Vec3::new(0.0, depth_val, z_start),
                                    Vec3::new(0.0, depth_val, z_end),
                                ],
                                tangents2: vec![
                                    Vec3::new(0.0, depth_val, z_start),
                                    Vec3::new(0.0, depth_val, z_end),
                                ],
                                weights: None,
                                apex_ratio: None,
                                tuck_ratio: None,
                            };
                        }

                        let mut left_outline = otl_ext.clone();
                        for p in &mut left_outline.control_points {
                            p.x = -p.x;
                        }
                        for p in &mut left_outline.tangents1 {
                            p.x = -p.x;
                        }
                        for p in &mut left_outline.tangents2 {
                            p.x = -p.x;
                        }

                        bottom_channels.push(crate::model::ChannelLayer {
                            name: name.clone(),
                            is_symmetric: true,
                            left_outline,
                            right_outline: otl_ext.clone(),
                            left_depth: depth_curve.clone(),
                            right_depth: depth_curve.clone(),
                        });
                    } else {
                        let is_active = calque.actif.unwrap_or(1) != 0;
                        outline_layers.push(crate::model::OutlineLayer {
                            name,
                            active: is_active,
                            otl_ext,
                            otl_int,
                        });
                    }
                }
            }
        }

        if !outline_layers.is_empty() {
            model.outline_layers = Some(outline_layers);
        }
        if !bottom_channels.is_empty() {
            model.bottom_channels = Some(bottom_channels);
        }

        let bounds_tip_z = bl / 2.0 * scale;
        let bounds_nose_z = -bl / 2.0 * scale;

        if model.v_concave_tail.abs() < 1e-4 {
            model.v_concave_tail =
                extract_concave_from_slices(&model.cross_sections, bounds_tip_z - 12.0);
        }
        if model.v_concave_nose.abs() < 1e-4 {
            model.v_concave_nose =
                extract_concave_from_slices(&model.cross_sections, bounds_nose_z + 12.0);
        }

        model
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    use approx::assert_relative_eq;

    #[test]
    fn test_akushaper_plank_parity() {
        // Golden plank: 100" length, 10" width, 10" thickness, rectangular.
        let xml = r#"<?xml version="1.0" encoding="iso-8859-1"?>
<Shape3d_design>
	<Board>
		<Length>100.0</Length>
		<Width>10.0</Width>
		<Thickness>10.0</Thickness>
		<Otl>
			<Bezier3d>
				<Control_points>
					<Polygone3d>
						<Point3d><x>0.0</x><y>5.0</y><z>0.0</z></Point3d>
						<Point3d><x>100.0</x><y>5.0</y><z>0.0</z></Point3d>
					</Polygone3d>
				</Control_points>
			</Bezier3d>
		</Otl>
		<StrBot>
			<Bezier3d>
				<Control_points>
					<Polygone3d>
						<Point3d><x>0.0</x><y>0.0</y><z>0.0</z></Point3d>
						<Point3d><x>100.0</x><y>0.0</y><z>0.0</z></Point3d>
					</Polygone3d>
				</Control_points>
			</Bezier3d>
		</StrBot>
		<StrDeck>
			<Bezier3d>
				<Control_points>
					<Polygone3d>
						<Point3d><x>0.0</x><y>10.0</y><z>0.0</z></Point3d>
						<Point3d><x>100.0</x><y>10.0</y><z>0.0</z></Point3d>
					</Polygone3d>
				</Control_points>
			</Bezier3d>
		</StrDeck>
	</Board>
</Shape3d_design>"#;
        let model = parse_s3dx(xml).expect("Failed to parse plank S3DX");
        assert_relative_eq!(model.length, 100.0, epsilon = 1e-4);
        assert_relative_eq!(model.width, 10.0, epsilon = 1e-4);
        assert_relative_eq!(model.thickness, 10.0, epsilon = 1e-4);

        let profile = crate::geometry::get_board_profile_at_z(&model, 50.0, 0.5);
        assert_relative_eq!(profile.half_width * 2.0, 10.0, epsilon = 1e-4);
    }

    #[test]
    fn can_convert_s3dx_to_board_model() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = fs::read(&path).unwrap_or_else(|_| {
            panic!(
                "Should be able to read the golden S3DX file from {:?}",
                path
            )
        });
        let content = String::from_utf8_lossy(&bytes).into_owned();

        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        assert!((model.length - 73.0).abs() < 0.1);
        assert!((model.width - 21.177).abs() < 0.1);
        assert!((model.thickness - 2.7).abs() < 0.1);

        assert!((model.v_concave_tail - (-0.061)).abs() < 0.01);
        assert!((model.v_concave_nose - (-0.072)).abs() < 0.01);
        assert_eq!(model.rail_coefficient_tail, 0.882);
        assert_eq!(model.rail_coefficient_nose, 0.876);
        assert_eq!(model.thickness_z_stretch, 1.0);

        assert!(model.outline.is_some(), "Outline should be converted");
        assert!(
            model.rocker_bottom.is_some(),
            "Rocker bottom should be converted"
        );
        assert!(model.rocker_top.is_some(), "Rocker top should be converted");

        assert_eq!(
            model.cross_sections.len(),
            4,
            "Should have exactly 4 cross sections (already capped in design)"
        );

        let outline = model.outline.unwrap();
        assert_eq!(outline.control_points.len(), 4);
        assert!((outline.control_points[0].z - (-73.0 / 2.0)).abs() < 0.1); // Nose Z (Negative)
        assert!((outline.control_points[3].z - (73.0 / 2.0)).abs() < 0.1); // Tail Z (Positive)
        assert!((outline.control_points[0].x).abs() < 1.0); // Nose Width should be close to 0
    }

    #[test]
    fn test_imported_fish_tail_mesh_integrity() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/FISH.s3dx");
        if !path.exists() {
            println!("FISH.s3dx not found, skipping tail integrity test");
            return;
        }
        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_start_z = bounds.tip_z - 20.0;

        let mut last_apex_x: Option<f32> = None;
        let steps = 200; // High resolution to catch sudden cliffs

        for i in 0..=steps {
            let z = tail_start_z + (20.0 * (i as f32 / steps as f32));
            let profile = crate::geometry::get_board_profile_at_z(&model, z, 0.5);

            let inner_x = if z > bounds.notch_z {
                crate::geometry::evaluate_notch_inner_x(
                    model.outline.as_ref().unwrap(),
                    bounds.tip_t,
                    z,
                )
            } else {
                0.0
            };

            // BUG 1: Prong collapse/inversion
            // If inner_x > apex_x, the inner stringer crosses the outer rail, creating a black hole/gap!
            assert!(
                profile.apex_x >= inner_x,
                "Prong collapsed/inverted at z={:.2}! apex_x ({:.2}) < inner_x ({:.2})",
                z,
                profile.apex_x,
                inner_x
            );

            // BUG 2: Massive mesh cliffs (Tears)
            // The layer abruptly overrides the outline with incompatible absolute coordinates
            if let Some(last_x) = last_apex_x {
                let diff = (profile.apex_x - last_x).abs();
                assert!(
                    diff < 2.0,
                    "Massive cliff/tear detected in mesh outline at z={:.2}! Width jumped by {:.2} inches instantly.", 
                    z, diff
                );
            }
            last_apex_x = Some(profile.apex_x);
        }
    }

    #[test]
    fn test_fish_nose_rail_spikes() {
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/FISH.s3dx");
        if !path.exists() {
            println!("FISH.s3dx not found, skipping rail spike test");
            return;
        }
        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = crate::s3dx_parser::parse_s3dx(&content).expect("Failed to parse S3DX");
        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);

        // We look for massive explosions in the X coordinate near the nose.
        let start_z = bounds.nose_z * scale;
        let end_z = (bounds.nose_z + 10.0) * scale; // First 10 inches

        let mut max_spike = 0.0_f32;
        let mut spike_z = 0.0;

        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];

            if z >= start_z && z <= end_z {
                let z_inches = z / scale;
                let v_outer = crate::geometry::find_v_at_z(
                    model.outline.as_ref().unwrap(),
                    z_inches,
                    0.0,
                    bounds.tip_t,
                );
                let profile = crate::geometry::get_board_profile_at_z(&model, z_inches, v_outer);

                // Allow up to 2 inches of "puff" over the apex.
                // The bug causes spikes of 100+ inches, so 2 inches is a safe tolerance.
                let theoretical_max_x = profile.apex_x * scale;
                let overage = x.abs() - theoretical_max_x;
                if overage > max_spike {
                    max_spike = overage;
                    spike_z = z_inches;
                }
            }
        }

        let tolerance = 2.0 * scale;
        assert!(
            max_spike < tolerance,
            "BUG: Severe mesh spikes detected at the nose! Rail geometry puffed out by {:.2} inches past the outline at Z={:.2}",
            max_spike / scale, spike_z
        );
    }

    #[test]
    fn test_imported_fish_nose_mesh_integrity() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/FISH.s3dx");
        if !path.exists() {
            println!("FISH.s3dx not found, skipping nose integrity test");
            return;
        }
        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        let bounds = crate::geometry::get_board_bounds(&model);

        let z_nose = bounds.nose_z;
        let z_plus_half = bounds.nose_z + 0.5;

        let profile_at_nose = crate::geometry::get_board_profile_at_z(&model, z_nose, 0.0);
        let profile_after_nose = crate::geometry::get_board_profile_at_z(&model, z_plus_half, 0.05);

        // For a blunt, flaring nose like on the FISH model, the rail width (apex_x)
        // should be wider slightly back from the nose than AT the nose.
        // The visual bug is caused by the rail tucking INWARDS before it flares out.
        // This assertion will fail if that inversion occurs, proving the geometric bug.
        assert!(
            profile_after_nose.apex_x > profile_at_nose.apex_x,
            "BUG: Rail outline inverts at the nose! Width should increase, but it went from {:.3}\" at the nose to {:.3}\" at Z+0.5\"",
            profile_at_nose.apex_x,
            profile_after_nose.apex_x
        );
    }

    #[test]
    fn test_s3dx_promotes_swallow_tail_layer() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/FISH.s3dx");
        if !path.exists() {
            println!("FISH.s3dx not found, skipping tail promotion test");
            return;
        }
        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        // The SWALLOW TAIL layer should be intercepted and semantically promoted.
        assert_eq!(model.tail_type, "swallow");
        assert!(
            model.swallow_depth > 0.0,
            "Swallow depth should be populated from the layer's data"
        );

        // Since it was the only layer in FISH.s3dx, outline_layers should be consumed and left as None
        assert!(
            model.outline_layers.is_none(),
            "Swallow layer should have been consumed, leaving no leftover outline layers"
        );
    }

    #[test]
    fn test_s3dx_extracts_all_couples_and_weights() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");
        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        assert_eq!(
            model.cross_sections.len(),
            4,
            "Should dynamically parse exactly 4 cross sections (already capped)"
        );

        let z0 = model.cross_sections[0].control_points[0].z;
        let z3 = model.cross_sections[3].control_points[0].z;
        assert!(
            z0 < z3,
            "Cross sections should be ordered from nose to tail"
        );
        assert!(
            z0 < 0.0,
            "First cross section should be near the nose (negative Z)"
        );
        assert!(
            z3 > 0.0,
            "Last cross section should be near the tail (positive Z)"
        );

        let weights_opt = model.cross_sections[0].weights.as_ref();
        assert!(
            weights_opt.is_none() || weights_opt.unwrap()[0] == 1.0,
            "S3DX default u=-1.0 should map to weight=1.0 (or None if optimized)"
        );

        assert!(
            model.v_concave_tail.abs() > 0.0,
            "Rounded pin should have tail concave/vee extracted"
        );
        assert!(model.v_concave_nose.abs() >= 0.0);
    }

    #[test]
    fn test_s3dx_deck_computed_from_thickness() {
        let xml = r#"<?xml version="1.0" encoding="iso-8859-1"?>
<Shape3d_design>
<Board>
    <Length>100.0</Length>
    <Width>10.0</Width>
    <Thickness>10.0</Thickness>
    <DeckComputed>1</DeckComputed>
    <Number_of_slices>0</Number_of_slices>
    <Otl>
        <Bezier3d>
            <Plan>1</Plan>
            <Control_points>
                <Polygone3d>
                    <Point3d><x>0.0</x><y>5.0</y><z>0.0</z></Point3d>
                    <Point3d><x>100.0</x><y>5.0</y><z>0.0</z></Point3d>
                </Polygone3d>
            </Control_points>
        </Bezier3d>
    </Otl>
    <StrBot>
        <Bezier3d>
            <Plan>2</Plan>
            <Control_points>
                <Polygone3d>
                    <Point3d><x>0.0</x><y>0.0</y><z>0.0</z></Point3d>
                    <Point3d><x>100.0</x><y>0.0</y><z>0.0</z></Point3d>
                </Polygone3d>
            </Control_points>
        </Bezier3d>
    </StrBot>
    <Thickness>
        <Bezier3d>
            <Plan>2</Plan>
            <Control_points>
                <Polygone3d>
                    <Point3d><x>0.0</x><y>0.0</y><z>5.0</z></Point3d>
                    <Point3d><x>100.0</x><y>0.0</y><z>5.0</z></Point3d>
                </Polygone3d>
            </Control_points>
        </Bezier3d>
    </Thickness>
</Board>
</Shape3d_design>"#;

        let model = parse_s3dx(xml).expect("Failed to parse S3DX with relative thickness");

        // Verify basic properties
        assert_relative_eq!(model.length, 100.0);
        assert_relative_eq!(model.width, 10.0);
        assert_relative_eq!(model.thickness, 10.0);

        // Verify top rocker is successfully computed and synthesized
        assert!(model.rocker_top.is_some(), "Rocker top must be synthesized");
        let rocker_top = model.rocker_top.unwrap();

        // 50 steps = 51 control points
        assert_eq!(
            rocker_top.control_points.len(),
            51,
            "Should have been synthesized as a dense polyline of 51 points"
        );

        // Evaluate at the midpoint (Z=0.0)
        let mid_p = crate::geometry::evaluate_bezier_at_z(&rocker_top, 0.0, 0.5);
        assert_relative_eq!(mid_p.y, 5.0, epsilon = 1e-4);
    }

    #[test]
    fn test_mesh_intersects_spatial_splines() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");
        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);
        let scale = 1.0 / 12.0;

        // Evaluate at multiple specific Z intervals
        let test_zs = vec![-20.0, 20.0];

        for target_z in test_zs {
            let target_z_scaled = target_z * scale;

            let mut best_z_diff = f32::INFINITY;
            let mut best_z = 0.0;
            for i in 0..(mesh.vertices.len() / 3) {
                let z = mesh.vertices[i * 3 + 2];
                let diff = (z - target_z_scaled).abs();
                if diff < best_z_diff {
                    best_z_diff = diff;
                    best_z = z;
                }
            }

            // Relaxed assertion: The adaptive mesher optimizes flat areas, so rings might be ~1-2 inches apart.
            assert!(
                best_z_diff < 2.0 * scale,
                "Mesh should have a Z ring reasonably close to {}",
                target_z
            );

            let mut mesh_apex_x = 0.0;
            let mut mesh_apex_y = 0.0;
            let mut found_apex = false;

            for i in 0..(mesh.vertices.len() / 3) {
                let x = mesh.vertices[i * 3];
                let y = mesh.vertices[i * 3 + 1];
                let z = mesh.vertices[i * 3 + 2];

                if (z - best_z).abs() < 1e-4 {
                    if x > mesh_apex_x {
                        mesh_apex_x = x;
                        mesh_apex_y = y;
                        found_apex = true;
                    }
                }
            }

            assert!(
                found_apex,
                "Should have found an apex point in the mesh ring"
            );

            let eval_z = best_z / scale;
            let outline = model.outline.as_ref().unwrap();
            let bounds = crate::geometry::get_board_bounds(&model);
            let v_outer = crate::geometry::find_v_at_z(outline, eval_z, 0.0, bounds.tip_t);

            let expected_profile = crate::geometry::get_board_profile_at_z(&model, eval_z, v_outer);

            let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
            let dist = eval_z - mid_z;
            let rail_coeff = if dist > 0.0 {
                let t = (dist / (bounds.tip_z - mid_z)).clamp(0.0, 1.0);
                let ease_t = t * t * (3.0 - 2.0 * t);
                1.0 + (model.rail_coefficient_tail - 1.0) * ease_t
            } else {
                let t = ((-dist) / (mid_z - bounds.nose_z)).clamp(0.0, 1.0);
                let ease_t = t * t * (3.0 - 2.0 * t);
                1.0 + (model.rail_coefficient_nose - 1.0) * ease_t
            };

            let expected_y = expected_profile.bot_y
                + (expected_profile.apex_y - expected_profile.bot_y) * rail_coeff;

            let x_err = (mesh_apex_x - expected_profile.apex_x * scale).abs();
            let y_err = (mesh_apex_y - expected_y * scale).abs();

            assert!(
                x_err <= 1.5e-2,
                "Mesh Apex X ({}) does not intersect Analytical Apex X ({}) at actual Z={}! Error: {}",
                mesh_apex_x, expected_profile.apex_x * scale, eval_z, x_err
            );
            assert!(
                y_err <= 1.5e-2,
                "Mesh Apex Y ({}) does not intersect Analytical Apex Y ({}) at actual Z={}! Error: {}",
                mesh_apex_y, expected_y * scale, eval_z, y_err
            );
        }
    }

    #[test]
    fn test_golden_file_rounded_pin_mesh_generation() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let bytes = fs::read(&path).unwrap_or_else(|_| {
            panic!(
                "Should be able to read the golden S3DX file from {:?}",
                path
            )
        });
        let content = String::from_utf8_lossy(&bytes).into_owned();

        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        let mut dirty = crate::model::DirtyState::default();
        let mut cache = crate::mesh::MeshCache::default();
        let mesh = crate::mesh::generate_mesh(&model, &mut dirty, &mut cache);

        assert!(mesh.vertices.len() > 0, "Mesh should have vertices");
        assert!(mesh.indices.len() > 0, "Mesh should have indices");

        let scale = 1.0 / 12.0;
        let tail_z = model.length / 2.0;

        for i in 0..(mesh.vertices.len() / 3) {
            let y = mesh.vertices[i * 3 + 1];
            let z = mesh.vertices[i * 3 + 2];
            // Check for the \"up triangle\" - geometry sticking up past the rocker deck height
            if (z - tail_z * scale).abs() < 0.1 {
                assert!(
                    y < 10.0 * scale,
                    "GEOMETRY SPIKE DETECTED AT TAIL: y={} is way too high",
                    y / scale
                );
            }
        }

        // Check rail mid-point collapse near the tail
        let z_test = tail_z - 1.0;
        let blend =
            crate::geometry::get_cross_section_blend_at_z(&model.cross_sections, z_test).unwrap();
        let t_apex = blend.t_apex;
        let t_shoulder = t_apex + (1.0 - t_apex) * 0.5;

        let ctx = crate::geometry::ZRingContext::new(&model, z_test);
        let pt_apex = ctx.get_point_at_uv(t_apex, 1.0);
        let t_mid_rail = t_apex + (t_shoulder - t_apex) * 0.5;
        let pt_mid_rail = ctx.get_point_at_uv(t_mid_rail, 1.0);

        assert!(
            pt_mid_rail.x > 0.0,
            "Mid-rail collapsed to the stringer! Bug present."
        );
        assert!(
            pt_mid_rail.x <= pt_apex.x + 1e-4,
            "Mid-rail is outside the apex!"
        );
        let pt_bot = ctx.get_point_at_uv(0.0, 1.0);
        let pt_top = ctx.get_point_at_uv(1.0, 1.0);

        assert!(
            pt_top.y - pt_bot.y > 0.0,
            "Tail thickness should not collapse to zero"
        );

        // Verify the nose is completely watertight
        use std::collections::HashMap;
        let mut edge_counts = HashMap::new();

        let get_vertex = |idx: u32| -> Vec3 {
            let i = idx as usize * 3;
            Vec3::new(mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2])
        };

        for i in (0..mesh.indices.len()).step_by(3) {
            let i1 = mesh.indices[i];
            let i2 = mesh.indices[i + 1];
            let i3 = mesh.indices[i + 2];

            let hash_pt = |v: Vec3| -> (i32, i32, i32) {
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

        let mut nose_holes = 0;
        let nose_z = -model.length / 2.0 * scale;

        for (edge, count) in &edge_counts {
            if *count == 1 {
                let z1 = (edge.0).2 as f32 / 10000.0;
                let z2 = (edge.1).2 as f32 / 10000.0;

                if (z1 - nose_z).abs() < 1.0 && (z2 - nose_z).abs() < 1.0 {
                    nose_holes += 1;
                    let v1 = Vec3::new(
                        (edge.0).0 as f32 / 10000.0,
                        (edge.0).1 as f32 / 10000.0,
                        (edge.0).2 as f32 / 10000.0,
                    );
                    let v2 = Vec3::new(
                        (edge.1).0 as f32 / 10000.0,
                        (edge.1).1 as f32 / 10000.0,
                        (edge.1).2 as f32 / 10000.0,
                    );
                    log::error!("Hole at edge from {:?} to {:?}", v1, v2);
                }
            }
        }

        assert_eq!(
            nose_holes, 0,
            "Found {} boundary edges at the nose!",
            nose_holes
        );
    }

    #[test]
    fn test_gh60_winged_swallow_tail_mesh_integrity() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx");
        if !path.exists() {
            println!("gh-60-winged-swallow.s3dx not found, skipping tail integrity test");
            return;
        }
        let bytes = fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");

        let bounds = crate::geometry::get_board_bounds(&model);
        let tail_start_z = bounds.tip_z - 30.0;

        let mut last_apex_x: Option<f32> = None;
        let steps = 300;

        for i in 0..=steps {
            let z = tail_start_z + (30.0 * (i as f32 / steps as f32));
            let profile = crate::geometry::get_board_profile_at_z(&model, z, 0.5);

            let inner_x = if z > bounds.notch_z {
                crate::geometry::evaluate_notch_inner_x(
                    model.outline.as_ref().unwrap(),
                    bounds.tip_t,
                    z,
                )
            } else {
                0.0
            };

            // BUG 1: Prong collapse/inversion
            assert!(
                profile.apex_x >= inner_x,
                "Prong collapsed/inverted at z={:.2}! apex_x ({:.2}) < inner_x ({:.2})",
                z,
                profile.apex_x,
                inner_x
            );

            // BUG 2: Massive mesh cliffs (Tears)
            // Note: This board has a physical wing (flyer) that drops ~3.6 inches.
            if let Some(last_x) = last_apex_x {
                let diff = (profile.apex_x - last_x).abs();
                assert!(
                    diff < 5.0,
                    "Massive cliff/tear detected in mesh outline at z={:.2}! Width jumped by {:.2} inches instantly.", 
                    z, diff
                );
            }
            last_apex_x = Some(profile.apex_x);
        }
    }

    #[test]
    fn test_tomolike_mesh_integrity() {
        let mut path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/TomoLike.s3dx");
        if !path.exists() {
            println!("TomoLike.s3dx not found, skipping integrity test");
            return;
        }
        let bytes = std::fs::read(&path).unwrap();
        let content = String::from_utf8_lossy(&bytes).into_owned();
        let model = parse_s3dx(&content).expect("Failed to parse S3DX");
        let mesh = crate::mesh::generate_mesh(
            &model,
            &mut crate::model::DirtyState::default(),
            &mut crate::mesh::MeshCache::default(),
        );

        let scale = 1.0 / 12.0;
        let bounds = crate::geometry::get_board_bounds(&model);

        // BUG 1: Tail Cap Normals (Slerped instead of Flat)
        let tail_z = bounds.tip_z * scale;
        let mut flat_cap_found = false;
        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            if (z - tail_z).abs() < 1e-4 {
                let nx = mesh.normals[i * 3];
                let ny = mesh.normals[i * 3 + 1];
                let nz = mesh.normals[i * 3 + 2];

                // Tail cap on a blunt board should point exactly in +Z
                if nx.abs() < 1e-2 && ny.abs() < 1e-2 && (nz - 1.0).abs() < 1e-2 {
                    flat_cap_found = true;
                    break;
                }
            }
        }
        assert!(
            flat_cap_found,
            "BUG: TomoLike blunt tail cap is missing its flat (+Z) normals! It might have been slerped."
        );

        // BUG 2: Mesh inside outline
        let mid_z = (bounds.nose_z + bounds.tip_z) / 2.0;
        let mid_z_scaled = mid_z * scale;

        // Find mesh apex at mid_z
        let mut max_x_at_mid = 0.0_f32;
        let mut best_z_diff = f32::INFINITY;
        let mut best_z = 0.0;

        for i in 0..(mesh.vertices.len() / 3) {
            let z = mesh.vertices[i * 3 + 2];
            let diff = (z - mid_z_scaled).abs();
            if diff < best_z_diff {
                best_z_diff = diff;
                best_z = z;
            }
        }

        for i in 0..(mesh.vertices.len() / 3) {
            let x = mesh.vertices[i * 3];
            let z = mesh.vertices[i * 3 + 2];
            if (z - best_z).abs() < 1e-4 {
                if x > max_x_at_mid {
                    max_x_at_mid = x;
                }
            }
        }

        // Evaluate outline at the exact Z of the mesh ring
        let outline_x =
            crate::geometry::evaluate_composite_outline_at_z(&model, best_z / scale, 0.5).x * scale;

        assert!(
            (max_x_at_mid - outline_x).abs() < 5e-3,
            "BUG: Mesh is inside the outline! Mesh Apex X: {}, Outline X: {}",
            max_x_at_mid,
            outline_x
        );
    }
}
