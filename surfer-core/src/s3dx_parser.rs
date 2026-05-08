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
    
    #[serde(rename = "curveDefSide0")]
    pub curve_def_side0: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefSide2")]
    pub curve_def_side2: Option<S3dxBezierDefContainer>,
    #[serde(rename = "curveDefSide4")]
    pub curve_def_side4: Option<S3dxBezierDefContainer>,

    #[serde(rename = "Couples_0")]
    pub couples_0: Option<S3dxCouplesContainer>,
    #[serde(rename = "Couples_1")]
    pub couples_1: Option<S3dxCouplesContainer>,
    #[serde(rename = "Couples_2")]
    pub couples_2: Option<S3dxCouplesContainer>,
    #[serde(rename = "Couples_3")]
    pub couples_3: Option<S3dxCouplesContainer>,
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
pub struct S3dxBezierDef {
    #[serde(rename = "Bezier3d")]
    pub bezier3d: Option<S3dxBezier3d>,
}

#[derive(Debug, Deserialize)]
pub struct S3dxBezier3d {
    #[serde(rename = "Name")]
    pub name: Option<String>,
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
}

use crate::model::{BoardModel, BezierCurveData};
use glam::Vec3;

fn convert_s3dx_bezier3d(bezier3d: &S3dxBezier3d) -> Option<BezierCurveData> {
    let mut control_points = Vec::new();
    if let Some(poly) = &bezier3d.control_points {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                control_points.push(Vec3::new(p.y, p.z, p.x));
            }
        }
    }
    
    let mut tangents1 = Vec::new();
    if let Some(poly) = &bezier3d.tangents_1 {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                tangents1.push(Vec3::new(p.y, p.z, p.x));
            }
        }
    }
    
    let mut tangents2 = Vec::new();
    if let Some(poly) = &bezier3d.tangents_2 {
        if let Some(pts) = poly.polygone3d.as_ref().and_then(|p| p.point3d.as_ref()) {
            for p in pts {
                tangents2.push(Vec3::new(p.y, p.z, p.x));
            }
        }
    }
    
    if control_points.is_empty() {
        return None;
    }

    Some(BezierCurveData {
        control_points,
        tangents1,
        tangents2,
        weights: None,
    })
}

fn convert_s3dx_curve(s3dx_curve: &Option<S3dxCurveContainer>) -> Option<BezierCurveData> {
    let bezier3d = s3dx_curve.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d)
}

fn convert_s3dx_bezier_def(s3dx_def: &Option<S3dxBezierDefContainer>) -> Option<BezierCurveData> {
    let bezier3d = s3dx_def.as_ref()?.bezier_def.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d)
}

fn convert_s3dx_couples(s3dx_couples: &Option<S3dxCouplesContainer>) -> Option<BezierCurveData> {
    let bezier3d = s3dx_couples.as_ref()?.bezier3d.as_ref()?;
    convert_s3dx_bezier3d(bezier3d)
}

pub fn parse_s3dx(xml: &str) -> Result<BoardModel, String> {
    let sanitized = xml.replace("<Ref. point>", "<Ref_point>").replace("</Ref. point>", "</Ref_point>");
    let design: Shape3dDesign = quick_xml::de::from_str(&sanitized)
        .map_err(|e| format!("XML parsing error: {}", e))?;
    Ok(design.board.into())
}

impl From<S3dxBoard> for BoardModel {
    fn from(s3dx: S3dxBoard) -> Self {
        let mut model = BoardModel::default();
        model.length = s3dx.length;
        model.width = s3dx.width;
        model.thickness = s3dx.thickness;
        
        model.outline = convert_s3dx_curve(&s3dx.otl);
        model.rocker_bottom = convert_s3dx_curve(&s3dx.str_bot);
        model.rocker_top = convert_s3dx_curve(&s3dx.str_deck);
        
        model.rail_outline = convert_s3dx_bezier_def(&s3dx.curve_def_top1);
        model.apex_outline = convert_s3dx_bezier_def(&s3dx.curve_def_top2);
        model.apex_rocker = convert_s3dx_bezier_def(&s3dx.curve_def_side2);
        
        let mut cross_sections = Vec::new();
        if let Some(c) = convert_s3dx_couples(&s3dx.couples_0) { cross_sections.push(c); }
        if let Some(c) = convert_s3dx_couples(&s3dx.couples_1) { cross_sections.push(c); }
        if let Some(c) = convert_s3dx_couples(&s3dx.couples_2) { cross_sections.push(c); }
        if let Some(c) = convert_s3dx_couples(&s3dx.couples_3) { cross_sections.push(c); }
        
        model.cross_sections = cross_sections;
        
        model
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
        #[test]
    fn can_convert_s3dx_to_board_model() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Should be able to read the golden S3DX file from {:?}", path));

        let sanitized = content.replace("<Ref. point>", "<Ref_point>").replace("</Ref. point>", "</Ref_point>");
        let design: Shape3dDesign = quick_xml::de::from_str(&sanitized)
            .unwrap_or_else(|e| panic!("Failed to deserialize S3DX XML: {:?}", e));

        assert_eq!(design.board.length, 185.420);
        assert_eq!(design.board.width, 53.790);
        assert_eq!(design.board.thickness, 6.858);
        
        let model: BoardModel = design.board.into();

        assert_eq!(model.length, 185.420);
        assert_eq!(model.width, 53.790);
        assert_eq!(model.thickness, 6.858);
        
        assert!(model.outline.is_some(), "Outline should be converted");
        assert!(model.rocker_bottom.is_some(), "Rocker bottom should be converted");
        assert!(model.rocker_top.is_some(), "Rocker top should be converted");
        
        assert_eq!(model.cross_sections.len(), 4, "Should have exactly 4 cross sections");
        
        let outline = model.outline.unwrap();
        assert_eq!(outline.control_points.len(), 4);
        assert_eq!(outline.control_points[3].z, 185.420); // Length
        assert_eq!(outline.control_points[3].x, 0.201257); // Width
    }

    #[test]
        #[test]
    fn test_golden_file_rounded_pin_mesh_generation() {
        let _ = env_logger::builder().is_test(true).try_init();
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Should be able to read the golden S3DX file from {:?}", path));

        let model = parse_s3dx(&content).expect("Failed to parse S3DX");
        
        let mesh = crate::mesh::generate_mesh(&model);
        
        assert!(mesh.vertices.len() > 0, "Mesh should have vertices");
        assert!(mesh.indices.len() > 0, "Mesh should have indices");
        
        let scale = 1.0 / 12.0;
        for i in 0..(mesh.vertices.len() / 3) {
            let y = mesh.vertices[i * 3 + 1];
            let z = mesh.vertices[i * 3 + 2];
            // Check for the \"up triangle\" - geometry sticking up past the rocker deck height
            if (z - model.length * scale).abs() < 0.1 {
                assert!(y < 10.0 * scale, "GEOMETRY SPIKE DETECTED AT TAIL: y={} is way too high", y / scale);
            }
        }

        // Check rail mid-point collapse near the tail
        let z_test = model.length - 1.0; 
        let blend = crate::geometry::get_cross_section_blend_at_z(&model.cross_sections, z_test).unwrap();
        let t_apex = blend.t_apex;
        let t_shoulder = t_apex + (1.0 - t_apex) * 0.5;

        let pt_apex = crate::geometry::get_point_at_uv(&model, t_apex, 1.0, z_test, 0.0, 1.0);
        let t_mid_rail = t_apex + (t_shoulder - t_apex) * 0.5;
        let pt_mid_rail = crate::geometry::get_point_at_uv(&model, t_mid_rail, 1.0, z_test, 0.0, 1.0);

        assert!(pt_mid_rail.x > 0.0, "Mid-rail collapsed to the stringer! Bug present.");
        assert!(pt_mid_rail.x <= pt_apex.x + 1e-4, "Mid-rail is outside the apex!");
    }
}
