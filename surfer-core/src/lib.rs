pub mod bezier;
pub mod model;
pub mod geometry;
pub mod mesh;
pub mod reducer;

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
        let effects = reducer::update(&mut self.model, action);
        (self.model.clone(), effects)
    }

    /// Prove the pipeline works by generating the real mesh!
    pub fn compute_mesh(&self) -> RawGeometryData {
        mesh::generate_mesh(&self.model)
    }
}
