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

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        // Route standard Rust logs to the browser console
        let _ = console_log::init_with_level(log::Level::Info);
        Self {
            engine: SurferEngine::new(),
        }
    }

    #[wasm_bindgen]
    pub fn propose(&mut self, action_js: JsValue) -> Result<JsValue, JsValue> {
                // Deserialize the JS action into our core Rust BoardAction
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        if !matches!(action, BoardAction::LoadDesign { .. }) {
            log::info!("[Rust FFI] Processing action: {:?}", action);
        }

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

        let vertex_count = mesh.vertices.len() / 3;
        let triangle_count = mesh.indices.len() / 3;

        Reflect::set(
            &obj,
            &JsValue::from_str("vertices"),
            &Float32Array::from(mesh.vertices.as_slice()),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("indices"),
            &Uint32Array::from(mesh.indices.as_slice()),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("uvs"),
            &Float32Array::from(mesh.uvs.as_slice()),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("colors"),
            &Float32Array::from(mesh.colors.as_slice()),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("normals"),
            &Float32Array::from(mesh.normals.as_slice()),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("volumeLiters"),
            &JsValue::from_f64(mesh.volume_liters as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("vertexCount"),
            &JsValue::from_f64(vertex_count as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("triangleCount"),
            &JsValue::from_f64(triangle_count as f64),
        )?;

        Ok(obj.into())
    }

    #[wasm_bindgen]
    pub fn get_curvature_combs(&self) -> Result<JsValue, JsValue> {
        let combs = self.engine.compute_curvature_combs();
        Ok(Float32Array::from(combs.as_slice()).into())
    }

    #[wasm_bindgen]
    pub fn get_slice_profile(&self, z: f32) -> Result<JsValue, JsValue> {
        let profile = self.engine.compute_slice_profile(z);
        Ok(Float32Array::from(profile.as_slice()).into())
    }

    #[wasm_bindgen]
    pub fn get_foil_stats(&self) -> Result<JsValue, JsValue> {
        let stats = self.engine.compute_foil_stats();
        Ok(Float32Array::from(stats.as_slice()).into())
    }

    #[wasm_bindgen]
    pub fn sample_curve(&self, curve_js: JsValue, steps: usize) -> Result<JsValue, JsValue> {
        let curve: surfer_core::model::BezierCurveData =
            serde_wasm_bindgen::from_value(curve_js)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let pts = surfer_core::bezier::sample_curve(&curve, steps);
        let mut flat = Vec::with_capacity(pts.len() * 3);
        for p in pts {
            flat.push(p.x);
            flat.push(p.y);
            flat.push(p.z);
        }
        Ok(Float32Array::from(flat.as_slice()).into())
    }

    #[wasm_bindgen]
    pub fn get_profile_at_z(&self, z: f32) -> Result<JsValue, JsValue> {
        let model = self.engine.get_model();
        let bounds = surfer_core::geometry::get_board_bounds(model);
        let outline = match &model.outline {
            Some(o) => o,
            None => {
                let obj = Object::new();
                let _ = Reflect::set(&obj, &JsValue::from_str("topY"), &JsValue::from_f64(1.0));
                let _ = Reflect::set(&obj, &JsValue::from_str("botY"), &JsValue::from_f64(-1.0));
                let _ = Reflect::set(&obj, &JsValue::from_str("apexX"), &JsValue::from_f64(5.0));
                let _ = Reflect::set(&obj, &JsValue::from_str("apexY"), &JsValue::from_f64(0.0));
                let _ = Reflect::set(&obj, &JsValue::from_str("tuckX"), &JsValue::from_f64(4.5));
                let _ = Reflect::set(&obj, &JsValue::from_str("tuckY"), &JsValue::from_f64(-1.0));
                let _ = Reflect::set(
                    &obj,
                    &JsValue::from_str("shoulderX"),
                    &JsValue::from_f64(4.0),
                );
                let _ = Reflect::set(
                    &obj,
                    &JsValue::from_str("shoulderY"),
                    &JsValue::from_f64(0.8),
                );
                let _ = Reflect::set(
                    &obj,
                    &JsValue::from_str("halfWidth"),
                    &JsValue::from_f64(5.0),
                );
                return Ok(obj.into());
            }
        };
        let v_outer = surfer_core::geometry::find_v_at_z(outline, z, 0.0, bounds.tip_t);
        let profile = surfer_core::geometry::get_board_profile_at_z(model, z, v_outer);

        let obj = Object::new();
        Reflect::set(
            &obj,
            &JsValue::from_str("topY"),
            &JsValue::from_f64(profile.top_y as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("botY"),
            &JsValue::from_f64(profile.bot_y as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("apexX"),
            &JsValue::from_f64(profile.apex_x as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("apexY"),
            &JsValue::from_f64(profile.apex_y as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("tuckX"),
            &JsValue::from_f64(profile.tuck_x as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("tuckY"),
            &JsValue::from_f64(profile.tuck_y as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("shoulderX"),
            &JsValue::from_f64(profile.shoulder_x as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("shoulderY"),
            &JsValue::from_f64(profile.shoulder_y as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("halfWidth"),
            &JsValue::from_f64(profile.half_width as f64),
        )?;
        Ok(obj.into())
    }

    #[wasm_bindgen]
    pub fn get_bottom_y_at(&self, z: f32, x: f32) -> f32 {
        let model = self.engine.get_model();
        let bounds = surfer_core::geometry::get_board_bounds(model);
        let outline = match &model.outline {
            Some(o) => o,
            None => return 0.0,
        };
        let v_outer = surfer_core::geometry::find_v_at_z(outline, z, 0.0, bounds.tip_t);
        let profile = surfer_core::geometry::get_board_profile_at_z(model, z, v_outer);

        let inner_x = if z > bounds.notch_z {
            surfer_core::geometry::evaluate_notch_inner_x(outline, bounds.tip_t, z)
        } else {
            0.0
        };

        let side = if x < 0.0 { -1.0 } else { 1.0 };
        let abs_x = x.abs();

        let u = if profile.half_width > 1e-4 {
            (abs_x / profile.half_width).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let pt = surfer_core::geometry::get_point_at_uv(model, u, v_outer, z, inner_x, side);
        pt.y
    }

    #[wasm_bindgen]
    pub fn export_s3dx(&self) -> Result<String, JsValue> {
        Ok(surfer_core::s3dx_exporter::export_s3dx(
            self.engine.get_model(),
        ))
    }

    #[wasm_bindgen]
    pub fn export_obj(&self) -> Result<String, JsValue> {
        let mesh = self.engine.compute_mesh();
        Ok(surfer_core::obj_exporter::export_obj(
            self.engine.get_model(),
            &mesh,
        ))
    }
}
