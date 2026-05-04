use glam::Vec3;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLayer {
    pub name: String,
    pub otl_ext: BezierCurveData,
    pub otl_int: BezierCurveData,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardModel {
    pub length: f32,
    pub width: f32,
    pub thickness: f32,
    pub volume: f32,
    pub fin_setup: String,
    
    pub outline: Option<BezierCurveData>,
    pub outline_layers: Option<Vec<OutlineLayer>>,
    pub rail_outline: Option<BezierCurveData>,
    pub apex_outline: Option<BezierCurveData>,
    pub rocker_top: Option<BezierCurveData>,
    pub rocker_bottom: Option<BezierCurveData>,
    pub apex_rocker: Option<BezierCurveData>,
    #[serde(default)]
    pub cross_sections: Vec<BezierCurveData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BoardAction {
    #[serde(rename = "UPDATE_NUMBER")]
    UpdateNumber { param: String, value: f32 },
    #[serde(rename = "UPDATE_STRING")]
    UpdateString { param: String, value: String },
    #[serde(rename = "UPDATE_BOOLEAN")]
    UpdateBoolean { param: String, value: bool },
    #[serde(rename = "LOAD_DESIGN")]
    LoadDesign { state: BoardModel },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Effect {
    #[serde(rename = "LOG_INFO")]
    LogInfo { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BezierCurveData {
    pub control_points: Vec<Vec3>,
    pub tangents1: Vec<Vec3>,
    pub tangents2: Vec<Vec3>,
}

#[derive(Debug, Clone, Default)]
pub struct RawGeometryData {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub uvs: Vec<f32>,
    pub colors: Vec<f32>,
    pub normals: Vec<f32>,
    pub volume_liters: f32,
}
