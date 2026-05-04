use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardModel {
    pub length: f32,
    pub width: f32,
    pub thickness: f32,
    pub volume: f32,
    pub fin_setup: String,
}

impl Default for BoardModel {
    fn default() -> Self {
        Self {
            length: 70.0,
            width: 18.75,
            thickness: 2.5,
            volume: 30.5,
            fin_setup: "quad".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BoardAction {
    #[serde(rename = "UPDATE_NUMBER")]
    UpdateNumber { param: String, value: f32 },
    #[serde(rename = "UPDATE_STRING")]
    UpdateString { param: String, value: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Effect {
    #[serde(rename = "LOG_INFO")]
    LogInfo { message: String },
}
