pub mod model;

use model::{BoardAction, BoardModel, Effect};

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
            BoardAction::UpdateNumber { param, value } => {
                match param.as_str() {
                    "length" => self.model.length = value,
                    "width" => self.model.width = value,
                    "thickness" => self.model.thickness = value,
                    _ => {
                        effects.push(Effect::LogInfo { 
                            message: format!("Unknown number param: {}", param) 
                        });
                    }
                }
                effects.push(Effect::LogInfo { 
                    message: format!("Updated {} to {}", param, value) 
                });
            }
            BoardAction::UpdateString { param, value } => {
                if param == "finSetup" {
                    self.model.fin_setup = value.clone();
                }
                effects.push(Effect::LogInfo { 
                    message: format!("Updated {} to {}", param, value) 
                });
            }
        }

        (self.model.clone(), effects)
    }

    /// Prove the pipeline works by generating a dummy mesh (a simple triangle)
    pub fn compute_dummy_mesh(&self) -> Vec<f32> {
        // A simple raw array of floats representing a triangle's vertices (x, y, z)
                vec![
            0.0, 0.0, 0.0,
            10.0, 0.0, 0.0,
            0.0, 10.0, 0.0,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BoardAction;

    #[test]
    fn test_engine_update_number() {
        let mut engine = SurferEngine::new();
        let action = BoardAction::UpdateNumber {
            param: "length".to_string(),
            value: 80.0,
        };
        
        let (new_model, effects) = engine.update(action);

        assert_eq!(new_model.length, 80.0);
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::LogInfo { message } => assert!(message.contains("length")),
        }
    }
}
