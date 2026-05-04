pub mod bezier;
pub mod model;
pub mod geometry;
pub mod mesh;

use model::{BoardAction, BoardModel, Effect, RawGeometryData};

pub struct SurferEngine {
    model: BoardModel,
}

impl Default for SurferEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl SurferEngine {
    pub fn new() -> Self {
        Self {
            model: BoardModel::default(),
        }
    }

    pub fn get_model(&self) -> &BoardModel {
        &self.model
    }

    pub fn update(&mut self, action: BoardAction) -> (BoardModel, Vec<Effect>) {
        let mut effects = Vec::new();

        match action {
            BoardAction::LoadDesign { state } => {
                self.model = state;
                effects.push(Effect::LogInfo { message: "Rust Engine: LOAD_DESIGN caught. Internal state synced.".to_string() });
            }
            BoardAction::UpdateNumber { param, value } => {
                match param.as_str() {
                    "length" => self.model.length = value,
                    "width" => self.model.width = value,
                    "thickness" => self.model.thickness = value,
                    _ => {}
                }
            }
            BoardAction::UpdateString { param, value } => {
                if param == "finSetup" {
                    self.model.fin_setup = value.clone();
                }
            }
            BoardAction::UpdateBoolean { param: _, value: _ } => {
                // Future toggle handling
            }
        }

        (self.model.clone(), effects)
    }

    /// Prove the pipeline works by generating the real mesh!
    pub fn compute_mesh(&self) -> RawGeometryData {
        mesh::generate_mesh(&self.model)
    }
}
