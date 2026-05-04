
use js_sys::{Float32Array, Object, Reflect, Uint32Array};
use serde::Serialize;
use surfer_core::model::BoardAction;
use surfer_core::SurferEngine;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
pub struct WasmUpdateResult<'a> {
    pub state: &'a surfer_core::model::BoardModel,
    pub effects: &'a [surfer_core::model::Effect],
}

#[wasm_bindgen]
pub struct WasmEngine {
    engine: SurferEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            engine: SurferEngine::new(),
        }
    }

    #[wasm_bindgen]
    pub fn propose(&mut self, action_js: JsValue) -> Result<JsValue, JsValue> {
        // Deserialize the JS action into our core Rust BoardAction
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
            
        // Step the SAM state machine
        let (new_state, effects) = self.engine.update(action);
        
        let res = WasmUpdateResult {
            state: &new_state,
            effects: &effects,
        };
        
        // Return the tuple as serialized JS objects
        Ok(serde_wasm_bindgen::to_value(&res)?)
    }

    #[wasm_bindgen]
    pub fn get_state(&self) -> Result<JsValue, JsValue> {
        let state = self.engine.get_model();
        Ok(serde_wasm_bindgen::to_value(state)?)
    }

        #[wasm_bindgen]
    pub fn get_mesh(&self) -> Result<JsValue, JsValue> {
        let mesh = self.engine.compute_mesh();
        let obj = Object::new();
        
        Reflect::set(&obj, &JsValue::from_str("vertices"), &Float32Array::from(mesh.vertices.as_slice()))?;
        Reflect::set(&obj, &JsValue::from_str("indices"), &Uint32Array::from(mesh.indices.as_slice()))?;
        Reflect::set(&obj, &JsValue::from_str("uvs"), &Float32Array::from(mesh.uvs.as_slice()))?;
        Reflect::set(&obj, &JsValue::from_str("colors"), &Float32Array::from(mesh.colors.as_slice()))?;
        Reflect::set(&obj, &JsValue::from_str("normals"), &Float32Array::from(mesh.normals.as_slice()))?;
        Reflect::set(&obj, &JsValue::from_str("volumeLiters"), &JsValue::from_f64(mesh.volume_liters as f64))?;
        
        Ok(obj.into())
    }
}

