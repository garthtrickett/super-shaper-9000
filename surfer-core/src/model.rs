use approx::AbsDiffEq;
use glam::Vec3;
use serde::{Deserialize, Serialize};

fn default_one() -> f32 {
    1.0
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutlineLayer {
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    pub otl_ext: BezierCurveData,
    pub otl_int: BezierCurveData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
pub struct ImportedFinBox {
    pub name: String,
    pub style: i32,
    pub length: f32,
    pub width: f32,
    pub height: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub angle_oz: f32,
    pub even: bool,
    pub central: bool,
    pub tilt: Option<f32>,
    pub cant: Option<f32>,
    pub pt_convergence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StringerConfig {
    pub name: String,
    pub width: f32,
    pub shift: f32,
    pub tilt: f32,
    pub color_d3d: u32,
    pub mapping_d3d: u32,
    pub image_mapped_d3d: String,
    pub display_d3d: bool,
    pub superposition_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecalConfig {
    pub file: String,
    pub file_rel: String,
    pub name: String,
    pub length: f32,
    pub width: f32,
    pub reverse_left_right: bool,
    pub keep_prop: bool,
    pub tilt: f32,
    pub centre_x: f32,
    pub centre_y: f32,
    pub centre_color: u32,
    pub display_d3d: bool,
    pub deck: bool,
    pub bottom: bool,
    pub projected_mapping: bool,
    pub limit_rail: bool,
    pub limit_apex: bool,
    pub limit_opposite_rail: bool,
    pub superposition_order: u32,
    pub reflexion_coef: f32,
    pub opacity: f32,
    pub resize_with_board: bool,
    pub replace_with_board: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedNode {
    pub curve: String,
    pub index: usize,
    #[serde(rename = "type")]
    pub node_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub deck_shoulder: Option<BezierCurveData>,
    pub cross_sections: Vec<BezierCurveData>,
    pub imported_fin_boxes: Option<Vec<ImportedFinBox>>,
    pub stringers: Option<Vec<StringerConfig>>,
    pub decals: Option<Vec<DecalConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardModel {
    pub length: f32,
    pub width: f32,
    pub thickness: f32,
    pub fin_setup: String,
    #[serde(default)]
    pub front_fin_z: f32,
    #[serde(default)]
    pub front_fin_x: f32,
    #[serde(default)]
    pub rear_fin_z: f32,
    #[serde(default)]
    pub rear_fin_x: f32,
    #[serde(default)]
    pub toe_angle: f32,
    #[serde(default)]
    pub cant_angle: f32,
    #[serde(default)]
    pub core_material: String,
    #[serde(default)]
    pub glassing_schedule: String,
    #[serde(default)]
    pub tail_type: String,
    #[serde(default)]
    pub swallow_depth: f32,
    #[serde(default)]
    pub v_concave_tail: f32,
    #[serde(default)]
    pub v_concave_nose: f32,
    #[serde(default = "default_one")]
    pub rail_coefficient_tail: f32,
    #[serde(default = "default_one")]
    pub rail_coefficient_nose: f32,
    #[serde(default = "default_one")]
    pub thickness_z_stretch: f32,
    pub show_heatmap: Option<bool>,
    pub show_topography: Option<bool>,
    pub show_zebra: Option<bool>,
    pub show_outline: Option<bool>,
    pub show_rocker_top: Option<bool>,
    pub show_rocker_bottom: Option<bool>,
    pub show_apex_outline: Option<bool>,
    pub show_rail_outline: Option<bool>,
    pub show_apex_rocker: Option<bool>,
    pub show_deck_shoulder: Option<bool>,
    pub show_cross_sections: Option<bool>,
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
    pub deck_shoulder: Option<BezierCurveData>,
    #[serde(default)]
    pub cross_sections: Vec<BezierCurveData>,
    pub imported_fin_boxes: Option<Vec<ImportedFinBox>>,
    pub stringers: Option<Vec<StringerConfig>>,
    pub decals: Option<Vec<DecalConfig>>,
}

impl approx::AbsDiffEq for BezierCurveData {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        if self.control_points.len() != other.control_points.len()
            || self.tangents1.len() != other.tangents1.len()
            || self.tangents2.len() != other.tangents2.len()
        {
            return false;
        }
        for (a, b) in self.control_points.iter().zip(other.control_points.iter()) {
            if a.distance(*b) > epsilon {
                return false;
            }
        }
        for (a, b) in self.tangents1.iter().zip(other.tangents1.iter()) {
            if a.distance(*b) > epsilon {
                return false;
            }
        }
        for (a, b) in self.tangents2.iter().zip(other.tangents2.iter()) {
            if a.distance(*b) > epsilon {
                return false;
            }
        }
        match (&self.weights, &other.weights) {
            (Some(wa), Some(wb)) => {
                if wa.len() != wb.len() {
                    return false;
                }
                for (a, b) in wa.iter().zip(wb.iter()) {
                    if (a - b).abs() > epsilon {
                        return false;
                    }
                }
            }
            (None, None) => {}
            _ => return false,
        }
        match (self.apex_ratio, other.apex_ratio) {
            (Some(a), Some(b)) => {
                if (a - b).abs() > epsilon {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        match (self.tuck_ratio, other.tuck_ratio) {
            (Some(a), Some(b)) => {
                if (a - b).abs() > epsilon {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        true
    }
}
impl approx::RelativeEq for BezierCurveData {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for OutlineLayer {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        self.name == other.name
            && self.active == other.active
            && self.otl_ext.abs_diff_eq(&other.otl_ext, epsilon)
            && self.otl_int.abs_diff_eq(&other.otl_int, epsilon)
    }
}
impl approx::RelativeEq for OutlineLayer {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for ChannelLayer {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        self.name == other.name
            && self.is_symmetric == other.is_symmetric
            && self.left_outline.abs_diff_eq(&other.left_outline, epsilon)
            && self
                .right_outline
                .abs_diff_eq(&other.right_outline, epsilon)
            && self.left_depth.abs_diff_eq(&other.left_depth, epsilon)
            && self.right_depth.abs_diff_eq(&other.right_depth, epsilon)
    }
}
impl approx::RelativeEq for ChannelLayer {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for ImportedFinBox {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        self.name == other.name
            && self.style == other.style
            && f32::abs_diff_eq(&self.length, &other.length, epsilon)
            && f32::abs_diff_eq(&self.width, &other.width, epsilon)
            && f32::abs_diff_eq(&self.height, &other.height, epsilon)
            && f32::abs_diff_eq(&self.x, &other.x, epsilon)
            && f32::abs_diff_eq(&self.y, &other.y, epsilon)
            && f32::abs_diff_eq(&self.z, &other.z, epsilon)
            && f32::abs_diff_eq(&self.angle_oz, &other.angle_oz, epsilon)
            && self.even == other.even
            && self.central == other.central
            && (match (self.tilt, other.tilt) {
                (Some(a), Some(b)) => f32::abs_diff_eq(&a, &b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (self.cant, other.cant) {
                (Some(a), Some(b)) => f32::abs_diff_eq(&a, &b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (self.pt_convergence, other.pt_convergence) {
                (Some(a), Some(b)) => f32::abs_diff_eq(&a, &b, epsilon),
                (None, None) => true,
                _ => false,
            })
    }
}
impl approx::RelativeEq for ImportedFinBox {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for StringerConfig {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        self.name == other.name
            && f32::abs_diff_eq(&self.width, &other.width, epsilon)
            && f32::abs_diff_eq(&self.shift, &other.shift, epsilon)
            && f32::abs_diff_eq(&self.tilt, &other.tilt, epsilon)
            && self.color_d3d == other.color_d3d
            && self.mapping_d3d == other.mapping_d3d
            && self.image_mapped_d3d == other.image_mapped_d3d
            && self.display_d3d == other.display_d3d
            && self.superposition_order == other.superposition_order
    }
}
impl approx::RelativeEq for StringerConfig {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for DecalConfig {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        self.file == other.file
            && self.file_rel == other.file_rel
            && self.name == other.name
            && f32::abs_diff_eq(&self.length, &other.length, epsilon)
            && f32::abs_diff_eq(&self.width, &other.width, epsilon)
            && self.reverse_left_right == other.reverse_left_right
            && self.keep_prop == other.keep_prop
            && f32::abs_diff_eq(&self.tilt, &other.tilt, epsilon)
            && f32::abs_diff_eq(&self.centre_x, &other.centre_x, epsilon)
            && f32::abs_diff_eq(&self.centre_y, &other.centre_y, epsilon)
            && self.centre_color == other.centre_color
            && self.display_d3d == other.display_d3d
            && self.deck == other.deck
            && self.bottom == other.bottom
            && self.projected_mapping == other.projected_mapping
            && self.limit_rail == other.limit_rail
            && self.limit_apex == other.limit_apex
            && self.limit_opposite_rail == other.limit_opposite_rail
            && self.superposition_order == other.superposition_order
            && f32::abs_diff_eq(&self.reflexion_coef, &other.reflexion_coef, epsilon)
            && f32::abs_diff_eq(&self.opacity, &other.opacity, epsilon)
            && self.resize_with_board == other.resize_with_board
            && self.replace_with_board == other.replace_with_board
    }
}
impl approx::RelativeEq for DecalConfig {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl approx::AbsDiffEq for BoardModel {
    type Epsilon = f32;
    fn default_epsilon() -> f32 {
        f32::EPSILON
    }
    fn abs_diff_eq(&self, other: &Self, epsilon: f32) -> bool {
        f32::abs_diff_eq(&self.length, &other.length, epsilon)
            && f32::abs_diff_eq(&self.width, &other.width, epsilon)
            && f32::abs_diff_eq(&self.thickness, &other.thickness, epsilon)
            && self.fin_setup == other.fin_setup
            && f32::abs_diff_eq(&self.front_fin_z, &other.front_fin_z, epsilon)
            && f32::abs_diff_eq(&self.front_fin_x, &other.front_fin_x, epsilon)
            && f32::abs_diff_eq(&self.rear_fin_z, &other.rear_fin_z, epsilon)
            && f32::abs_diff_eq(&self.rear_fin_x, &other.rear_fin_x, epsilon)
            && f32::abs_diff_eq(&self.toe_angle, &other.toe_angle, epsilon)
            && f32::abs_diff_eq(&self.cant_angle, &other.cant_angle, epsilon)
            && self.core_material == other.core_material
            && self.glassing_schedule == other.glassing_schedule
            && self.tail_type == other.tail_type
            && f32::abs_diff_eq(&self.swallow_depth, &other.swallow_depth, epsilon)
            && f32::abs_diff_eq(&self.v_concave_tail, &other.v_concave_tail, epsilon)
            && f32::abs_diff_eq(&self.v_concave_nose, &other.v_concave_nose, epsilon)
            && f32::abs_diff_eq(
                &self.rail_coefficient_tail,
                &other.rail_coefficient_tail,
                epsilon,
            )
            && f32::abs_diff_eq(
                &self.rail_coefficient_nose,
                &other.rail_coefficient_nose,
                epsilon,
            )
            && f32::abs_diff_eq(
                &self.thickness_z_stretch,
                &other.thickness_z_stretch,
                epsilon,
            )
            && (match (&self.outline, &other.outline) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.rail_outline, &other.rail_outline) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.apex_outline, &other.apex_outline) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.rocker_top, &other.rocker_top) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.rocker_bottom, &other.rocker_bottom) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.apex_rocker, &other.apex_rocker) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && (match (&self.deck_shoulder, &other.deck_shoulder) {
                (Some(a), Some(b)) => a.abs_diff_eq(b, epsilon),
                (None, None) => true,
                _ => false,
            })
            && self.cross_sections.len() == other.cross_sections.len()
            && self
                .cross_sections
                .iter()
                .zip(other.cross_sections.iter())
                .all(|(a, b)| a.abs_diff_eq(b, epsilon))
            && (match (&self.outline_layers, &other.outline_layers) {
                (Some(la), Some(lb)) => {
                    la.len() == lb.len()
                        && la
                            .iter()
                            .zip(lb.iter())
                            .all(|(a, b)| a.abs_diff_eq(b, epsilon))
                }
                (None, None) => true,
                _ => false,
            })
            && (match (&self.bottom_channels, &other.bottom_channels) {
                (Some(ca), Some(cb)) => {
                    ca.len() == cb.len()
                        && ca
                            .iter()
                            .zip(cb.iter())
                            .all(|(a, b)| a.abs_diff_eq(b, epsilon))
                }
                (None, None) => true,
                _ => false,
            })
            && (match (&self.imported_fin_boxes, &other.imported_fin_boxes) {
                (Some(fa), Some(fb)) => {
                    fa.len() == fb.len()
                        && fa
                            .iter()
                            .zip(fb.iter())
                            .all(|(a, b)| a.abs_diff_eq(b, epsilon))
                }
                (None, None) => true,
                _ => false,
            })
            && (match (&self.stringers, &other.stringers) {
                (Some(sa), Some(sb)) => {
                    sa.len() == sb.len()
                        && sa
                            .iter()
                            .zip(sb.iter())
                            .all(|(a, b)| a.abs_diff_eq(b, epsilon))
                }
                (None, None) => true,
                _ => false,
            })
            && (match (&self.decals, &other.decals) {
                (Some(da), Some(db)) => {
                    da.len() == db.len()
                        && da
                            .iter()
                            .zip(db.iter())
                            .all(|(a, b)| a.abs_diff_eq(b, epsilon))
                }
                (None, None) => true,
                _ => false,
            })
    }
}
impl approx::RelativeEq for BoardModel {
    fn default_max_relative() -> f32 {
        f32::EPSILON
    }
    fn relative_eq(&self, other: &Self, epsilon: f32, _max_relative: f32) -> bool {
        self.abs_diff_eq(other, epsilon)
    }
}

impl Default for BoardModel {
    fn default() -> Self {
        Self {
            length: 0.0,
            width: 0.0,
            thickness: 0.0,
            fin_setup: String::new(),
            front_fin_z: 0.0,
            front_fin_x: 0.0,
            rear_fin_z: 0.0,
            rear_fin_x: 0.0,
            toe_angle: 0.0,
            cant_angle: 0.0,
            core_material: String::new(),
            glassing_schedule: String::new(),
            tail_type: String::new(),
            swallow_depth: 0.0,
            v_concave_tail: 0.0,
            v_concave_nose: 0.0,
            rail_coefficient_tail: 1.0,
            rail_coefficient_nose: 1.0,
            thickness_z_stretch: 1.0,
            show_heatmap: None,
            show_topography: None,
            show_zebra: None,
            show_outline: None,
            show_rocker_top: None,
            show_rocker_bottom: None,
            show_apex_outline: None,
            show_rail_outline: None,
            show_apex_rocker: None,
            show_deck_shoulder: None,
            show_cross_sections: None,
            show_mri_view: None,
            mri_slice_position: None,
            selected_node: None,
            history: None,
            history_index: None,
            outline: None,
            outline_layers: None,
            bottom_channels: None,
            rail_outline: None,
            apex_outline: None,
            rocker_top: None,
            rocker_bottom: None,
            apex_rocker: None,
            deck_shoulder: None,
            cross_sections: Vec::new(),
            imported_fin_boxes: None,
            stringers: None,
            decals: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ComponentType {
    Outline,
    Rocker,
    Slices,
    Channels,
    Fins,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ComponentPayload {
    Outline {
        outline: BezierCurveData,
        #[serde(rename = "outlineLayers")]
        outline_layers: Option<Vec<OutlineLayer>>,
    },
    Rocker {
        #[serde(rename = "rockerTop")]
        rocker_top: BezierCurveData,
        #[serde(rename = "rockerBottom")]
        rocker_bottom: BezierCurveData,
        #[serde(rename = "apexRocker")]
        apex_rocker: Option<BezierCurveData>,
    },
    Slices {
        #[serde(rename = "crossSections")]
        cross_sections: Vec<BezierCurveData>,
    },
    Channels {
        #[serde(rename = "bottomChannels")]
        bottom_channels: Vec<ChannelLayer>,
    },
    Fins {
        #[serde(rename = "finSetup")]
        fin_setup: String,
        #[serde(rename = "frontFinZ")]
        front_fin_z: f32,
        #[serde(rename = "frontFinX")]
        front_fin_x: f32,
        #[serde(rename = "rearFinZ")]
        rear_fin_z: f32,
        #[serde(rename = "rearFinX")]
        rear_fin_x: f32,
        #[serde(rename = "toeAngle")]
        toe_angle: f32,
        #[serde(rename = "cantAngle")]
        cant_angle: f32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum BoardAction {
    #[serde(rename = "UPDATE_NUMBER")]
    UpdateNumber { param: String, value: f32 },
    #[serde(rename = "UPDATE_STRING")]
    UpdateString { param: String, value: String },
    #[serde(rename = "UPDATE_BOOLEAN")]
    UpdateBoolean { param: String, value: bool },
    #[serde(rename = "LOAD_DESIGN")]
    LoadDesign { state: Box<BoardModel> },
    #[serde(rename = "SET_CURVES")]
    #[serde(rename_all = "camelCase")]
    SetCurves {
        outline: Option<BezierCurveData>,
        rail_outline: Option<BezierCurveData>,
        apex_outline: Option<BezierCurveData>,
        rocker_top: Option<BezierCurveData>,
        rocker_bottom: Option<BezierCurveData>,
        apex_rocker: Option<BezierCurveData>,
        deck_shoulder: Option<BezierCurveData>,
        cross_sections: Option<Vec<BezierCurveData>>,
    },
    #[serde(rename = "UPDATE_NODE_POSITION")]
    #[serde(rename_all = "camelCase")]
    UpdateNodePosition {
        curve: String,
        index: usize,
        node_type: String,
        position: [f32; 3],
    },
    #[serde(rename = "SELECT_NODE")]
    SelectNode { node: Option<SelectedNode> },
    #[serde(rename = "UPDATE_NODE_EXACT")]
    #[serde(rename_all = "camelCase")]
    UpdateNodeExact {
        curve: String,
        index: usize,
        anchor: Option<[f32; 3]>,
        tangent1: Option<[f32; 3]>,
        tangent2: Option<[f32; 3]>,
        weight: Option<f32>,
    },
    #[serde(rename = "INSERT_NODE")]
    #[serde(rename_all = "camelCase")]
    InsertNode { curve: String, t: f32 },
    #[serde(rename = "APPLY_CONTINUITY")]
    #[serde(rename_all = "camelCase")]
    ApplyContinuity {
        curve: String,
        index: usize,
        level: String,
        #[serde(default)]
        master: Option<String>,
    },
    #[serde(rename = "REMOVE_NODE")]
    #[serde(rename_all = "camelCase")]
    RemoveNode { curve: String, index: usize },
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
    #[serde(rename = "TOGGLE_OUTLINE_LAYER")]
    ToggleOutlineLayer { index: usize },
    #[serde(rename = "ADD_BOTTOM_CHANNEL")]
    AddBottomChannel,
    #[serde(rename = "REMOVE_BOTTOM_CHANNEL")]
    RemoveBottomChannel { index: usize },
    #[serde(rename = "TOGGLE_CHANNEL_SYMMETRY")]
    ToggleChannelSymmetry { index: usize },
    #[serde(rename = "IMPORT_S3DX")]
    #[serde(rename_all = "camelCase")]
    ImportS3dx { xml: String },
    #[serde(rename = "IMPORT_BRD")]
    #[serde(rename_all = "camelCase")]
    ImportBrd { bytes: Vec<u8> },
    #[serde(rename = "ADD_CROSS_SECTION")]
    #[serde(rename_all = "camelCase")]
    AddCrossSection { z: f32 },
    #[serde(rename = "ADD_STRINGER")]
    AddStringer,
    #[serde(rename = "UPDATE_STRINGER")]
    #[serde(rename_all = "camelCase")]
    UpdateStringer {
        index: usize,
        width: f32,
        shift: f32,
        tilt: f32,
    },
    #[serde(rename = "REMOVE_STRINGER")]
    RemoveStringer { index: usize },
    #[serde(rename = "ADD_DECAL")]
    AddDecal,
    #[serde(rename = "UPDATE_DECAL")]
    #[serde(rename_all = "camelCase")]
    UpdateDecal {
        index: usize,
        centre_x: f32,
        centre_y: f32,
        length: f32,
        width: f32,
        deck: bool,
    },
    #[serde(rename = "REMOVE_DECAL")]
    RemoveDecal { index: usize },
    #[serde(rename = "APPLY_COMPONENT")]
    ApplyComponent {
        #[serde(rename = "componentType")]
        component_type: ComponentType,
        payload: ComponentPayload,
    },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apex_ratio: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tuck_ratio: Option<f32>,
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

#[derive(Debug, Clone, PartialEq)]
pub struct DirtyState {
    pub global_rebuild: bool,
    pub dirty_z_ranges: Vec<(f32, f32)>,
}

impl Default for DirtyState {
    fn default() -> Self {
        Self {
            global_rebuild: true,
            dirty_z_ranges: Vec::new(),
        }
    }
}

mod serde_vec3_as_array {
    use glam::Vec3;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    #[allow(clippy::ptr_arg)]
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

impl BoardAction {
    pub fn is_geometry_altering(&self) -> bool {
        match self {
            BoardAction::SelectNode { .. } => false,
            BoardAction::SaveHistorySnapshot => false,
            BoardAction::UpdateBoolean { .. } => false,
            BoardAction::UpdateNumber { param, .. } if param == "mriSlicePosition" => false,
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests_board_action {
    use super::*;

    #[test]
    fn test_imported_fin_box_abs_diff_eq() {
        let f1 = ImportedFinBox {
            name: "Fin 1".to_string(),
            style: 5,
            length: 10.0,
            width: 0.5,
            height: 4.5,
            x: 12.0,
            y: 1.25,
            z: 2.0,
            angle_oz: 3.0,
            even: true,
            central: false,
            tilt: Some(6.0),
            cant: Some(4.0),
            pt_convergence: Some(250.0),
        };
        let mut f2 = f1.clone();
        assert!(f1.abs_diff_eq(&f2, f32::EPSILON));

        f2.x += 0.00001;
        assert!(f1.abs_diff_eq(&f2, 0.001));

        f2.x += 1.0;
        assert!(!f1.abs_diff_eq(&f2, 0.001));
    }

    #[test]
    fn test_is_geometry_altering() {
        let act_select = BoardAction::SelectNode { node: None };
        assert!(!act_select.is_geometry_altering());

        let act_snapshot = BoardAction::SaveHistorySnapshot;
        assert!(!act_snapshot.is_geometry_altering());

        let act_bool = BoardAction::UpdateBoolean {
            param: "showHeatmap".to_string(),
            value: true,
        };
        assert!(!act_bool.is_geometry_altering());

        let act_mri = BoardAction::UpdateNumber {
            param: "mriSlicePosition".to_string(),
            value: 45.0,
        };
        assert!(!act_mri.is_geometry_altering());

        let act_len = BoardAction::UpdateNumber {
            param: "length".to_string(),
            value: 72.0,
        };
        assert!(act_len.is_geometry_altering());

        let act_node = BoardAction::UpdateNodePosition {
            curve: "outline".to_string(),
            index: 0,
            node_type: "anchor".to_string(),
            position: [1.0, 2.0, 3.0],
        };
        assert!(act_node.is_geometry_altering());
    }
}
