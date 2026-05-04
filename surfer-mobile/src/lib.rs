uniffi::setup_scaffolding!();

// Future native mobile bindings (iOS/Android) will go here,
// wrapping the `surfer_core` logic just like the WASM hat does.
uniffi::setup_scaffolding!();

use std::sync::{Arc, Mutex};
use surfer_core::model::BoardAction;
use surfer_core::SurferEngine;

#[derive(uniffi::Object)]
pub struct MobileSurferEngine {
    engine: Mutex<SurferEngine>,
}

#[uniffi::export]
impl MobileSurferEngine {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            engine: Mutex::new(SurferEngine::new()),
        })
    }

    /// Proposes an action encoded as a JSON string.
    /// Returns the updated BoardModel state, also encoded as a JSON string.
    pub fn propose_action(&self, action_json: String) -> Result<String, String> {
        let action: BoardAction = serde_json::from_str(&action_json)
            .map_err(|e| format!("Failed to parse action: {}", e))?;
            
        let mut engine = self.engine.lock().unwrap();
        let (new_state, _effects) = engine.update(action);
        
        let result = serde_json::to_string(&new_state)
            .map_err(|e| format!("Failed to serialize state: {}", e))?;
            
        Ok(result)
    }

    /// Retrieves the current state as a JSON string
    pub fn get_state_json(&self) -> String {
        let engine = self.engine.lock().unwrap();
        serde_json::to_string(engine.get_model()).unwrap_or_else(|_| "{}".to_string())
    }

    /// Calculates and returns the raw 3D mesh buffers needed to render the board natively.
    pub fn get_mesh(&self) -> MobileGeometryData {
        let engine = self.engine.lock().unwrap();
        let mesh = engine.compute_mesh();
        
        MobileGeometryData {
            vertices: mesh.vertices,
            indices: mesh.indices,
            uvs: mesh.uvs,
            colors: mesh.colors,
            normals: mesh.normals,
            volume_liters: mesh.volume_liters,
        }
    }
}

#[derive(uniffi::Record)]
pub struct MobileGeometryData {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub uvs: Vec<f32>,
    pub colors: Vec<f32>,
    pub normals: Vec<f32>,
    pub volume_liters: f32,
}
