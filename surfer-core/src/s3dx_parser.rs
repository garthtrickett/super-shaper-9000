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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn can_deserialize_s3dx_to_structs() {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../src/assets/fixtures/s3dx/rounded-pin-6-1.s3dx");

        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Should be able to read the golden S3DX file from {:?}", path));

        let design: Shape3dDesign = quick_xml::de::from_str(&content)
            .unwrap_or_else(|e| panic!("Failed to deserialize S3DX XML: {:?}", e));

        assert_eq!(design.board.length, 185.420);
        assert_eq!(design.board.width, 53.790);
        assert_eq!(design.board.thickness, 6.858);
        
        assert!(design.board.otl.is_some());
        assert!(design.board.str_bot.is_some());
        assert!(design.board.str_deck.is_some());
    }
}
