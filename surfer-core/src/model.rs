use glam::Vec3;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLayer {
    pub name: String,
    pub otl_ext: BezierCurveData,
    pub otl_int: BezierCurveData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelLayer {
    pub name: String,
    #[serde(default)]
    pub is_symmetric: bool,
    pub left_outline: BezierCurveData,
    pub right_outline: BezierCurveData,
    pub left_depth: BezierCurveData,
    pub right_depth: BezierCurveData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedNode {
    pub curve: String,
    pub index: usize,
    #[serde(rename = "type")]
    pub node_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualSnapshot {
    pub outline: Option<BezierCurveData>,
    pub outline_layers: Option<Vec<OutlineLayer>>,
    pub bottom_channels: Option<Vec<ChannelLayer>>,
    pub rail_outline: Option<BezierCurveData>,
    pub apex_outline: Option<BezierCurveData>,
    pub rocker_top: Option<BezierCurveData>,
    pub rocker_bottom: Option<BezierCurveData>,
    pub apex_rocker: Option<BezierCurveData>,
    pub cross_sections: Vec<BezierCurveData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardModel {
    pub length: f32,
    pub width: f32,
    pub thickness: f32,
    pub volume: f32,
    pub fin_setup: String,
    #[serde(default)] pub front_fin_z: f32,
    #[serde(default)] pub front_fin_x: f32,
    #[serde(default)] pub rear_fin_z: f32,
    #[serde(default)] pub rear_fin_x: f32,
    #[serde(default)] pub toe_angle: f32,
    #[serde(default)] pub cant_angle: f32,
        #[serde(default)] pub core_material: String,
    #[serde(default)] pub glassing_schedule: String,
    #[serde(default)] pub tail_type: String,
    #[serde(default)] pub swallow_depth: f32,
    pub show_gizmos: Option<bool>,
    pub show_heatmap: Option<bool>,
    pub show_zebra: Option<bool>,
    pub show_apex_line: Option<bool>,
    pub show_outline: Option<bool>,
    pub show_rocker_top: Option<bool>,
    pub show_rocker_bottom: Option<bool>,
    pub show_apex_outline: Option<bool>,
    pub show_rail_outline: Option<bool>,
    pub show_apex_rocker: Option<bool>,
        pub show_cross_sections: Option<bool>,
    pub show_curvature: Option<bool>,
    pub show_mri_view: Option<bool>,
    pub mri_slice_position: Option<f32>,
    pub selected_node: Option<SelectedNode>,
    pub history: Option<Vec<ManualSnapshot>>,
    pub history_index: Option<usize>,
    
        pub outline: Option<BezierCurveData>,
    pub outline_layers: Option<Vec<OutlineLayer>>,
    pub bottom_channels: Option<Vec<ChannelLayer>>,
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
    #[serde(rename = "UPDATE_VOLUME")]
    UpdateVolume { volume: f32 },
    #[serde(rename = "LOAD_DESIGN")]
    LoadDesign { state: BoardModel },
    #[serde(rename = "SET_CURVES")]
    #[serde(rename_all = "camelCase")]
    SetCurves { 
        outline: Option<BezierCurveData>,
        rail_outline: Option<BezierCurveData>,
        apex_outline: Option<BezierCurveData>,
        rocker_top: Option<BezierCurveData>,
        rocker_bottom: Option<BezierCurveData>,
        apex_rocker: Option<BezierCurveData>,
        cross_sections: Option<Vec<BezierCurveData>>
    },
    #[serde(rename = "UPDATE_NODE_POSITION")]
    #[serde(rename_all = "camelCase")]
    UpdateNodePosition { curve: String, index: usize, node_type: String, position: [f32; 3] },
    #[serde(rename = "SELECT_NODE")]
    SelectNode { node: Option<SelectedNode> },
    #[serde(rename = "UPDATE_NODE_EXACT")]
    #[serde(rename_all = "camelCase")]
    UpdateNodeExact { curve: String, index: usize, anchor: Option<[f32; 3]>, tangent1: Option<[f32; 3]>, tangent2: Option<[f32; 3]>, weight: Option<f32> },
    #[serde(rename = "APPLY_CONTINUITY")]
    #[serde(rename_all = "camelCase")]
    ApplyContinuity { 
        curve: String, 
        index: usize, 
        level: String,
        #[serde(default)]
        master: Option<String>
    },
    #[serde(rename = "SAVE_HISTORY_SNAPSHOT")]
    SaveHistorySnapshot,
    #[serde(rename = "UNDO")]
    Undo,
    #[serde(rename = "REDO")]
    Redo,
    #[serde(rename = "SCALE_WIDTH")]
    ScaleWidth { factor: f32 },
    #[serde(rename = "SCALE_THICKNESS")]
    ScaleThickness { factor: f32 },
    #[serde(rename = "ADD_OUTLINE_LAYER")]
    AddOutlineLayer,
    #[serde(rename = "REMOVE_OUTLINE_LAYER")]
    RemoveOutlineLayer { index: usize },
    #[serde(rename = "ADD_BOTTOM_CHANNEL")]
    AddBottomChannel,
    #[serde(rename = "REMOVE_BOTTOM_CHANNEL")]
    RemoveBottomChannel { index: usize },
    #[serde(rename = "TOGGLE_CHANNEL_SYMMETRY")]
    ToggleChannelSymmetry { index: usize },
        #[serde(rename = "IMPORT_S3DX")]
    #[serde(rename_all = "camelCase")]
    ImportS3dx { xml: String }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Effect {
    #[serde(rename = "LOG_INFO")]
    LogInfo { message: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BezierCurveData {
    #[serde(with = "serde_vec3_as_array")]
    pub control_points: Vec<Vec3>,
    #[serde(with = "serde_vec3_as_array")]
    pub tangents1: Vec<Vec3>,
    #[serde(with = "serde_vec3_as_array")]
    pub tangents2: Vec<Vec3>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<Vec<f32>>,
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

mod serde_vec3_as_array {
    use glam::Vec3;
    use serde::{Serialize, Deserialize, Serializer, Deserializer};

    pub fn serialize<S>(vecs: &Vec<Vec3>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let arrays: Vec<[f32; 3]> = vecs.iter().map(|v| [v.x, v.y, v.z]).collect();
        arrays.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<Vec3>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let arrays: Vec<[f32; 3]> = Vec::deserialize(deserializer)?;
        Ok(arrays.iter().map(|a| Vec3::new(a[0], a[1], a[2])).collect())
    }
}
