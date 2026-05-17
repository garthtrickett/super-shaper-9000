use js_sys::{Float32Array, Object, Reflect, Uint32Array};
use serde::Serialize;
use surfer_core::model::BoardAction;
use surfer_core::SurferEngine;
use wasm_bindgen::prelude::*;
pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::OffscreenCanvas;

#[derive(Serialize)]
pub struct WasmUpdateResult<'a> {
    pub state: &'a surfer_core::model::BoardModel,
    pub effects: &'a [surfer_core::model::Effect],
}

pub struct RenderState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
}

#[wasm_bindgen]
pub struct WasmEngine {
    engine: SurferEngine,
    renderer: Option<RenderState>,
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
            renderer: None,
        }
    }

    #[wasm_bindgen]
    pub async fn init_renderer(&mut self, canvas: OffscreenCanvas) -> Result<(), JsValue> {
        let instance = wgpu::Instance::default();
        
        let surface = instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.ok_or_else(|| JsValue::from_str("Failed to request WGPU adapter"))?;

        let (device, queue) = adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: None,
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
            },
            None,
        ).await.map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut config = surface.get_default_config(&adapter, 800, 600)
            .ok_or_else(|| JsValue::from_str("Failed to get default surface config"))?;
            
        surface.configure(&device, &config);

        self.renderer = Some(RenderState {
            surface,
            device,
            queue,
            config,
        });

        Ok(())
    }

    #[wasm_bindgen]
    pub fn resize_renderer(&mut self, width: u32, height: u32) {
        if let Some(renderer) = &mut self.renderer {
            renderer.config.width = width.max(1);
            renderer.config.height = height.max(1);
            renderer.surface.configure(&renderer.device, &renderer.config);
        }
    }

    #[wasm_bindgen]
    pub fn render(&mut self) -> Result<(), JsValue> {
        if let Some(renderer) = &mut self.renderer {
            let frame = renderer.surface.get_current_texture()
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());

            let mut encoder = renderer.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let _rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.945, // Slate 100
                                g: 0.960,
                                b: 0.976,
                                a: 1.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });
            }

            renderer.queue.submit(Some(encoder.finish()));
            frame.present();
        }
        Ok(())
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
    pub fn get_mesh(&mut self) -> Result<JsValue, JsValue> {
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

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
    pub fn find_closest_t(
        &self,
        curve_name: &str,
        rx: f32,
        ry: f32,
        rz: f32,
        dx: f32,
        dy: f32,
        dz: f32,
    ) -> f32 {
        self.engine
            .find_closest_t(curve_name, [rx, ry, rz], [dx, dy, dz])
            .unwrap_or(-1.0)
    }

    #[wasm_bindgen]
    pub fn get_point_on_curve(&self, curve_name: &str, t: f32) -> js_sys::Float32Array {
        if let Some(pt) = self.engine.get_point_on_curve(curve_name, t) {
            js_sys::Float32Array::from(&pt[..])
        } else {
            js_sys::Float32Array::from(&[0.0, 0.0, 0.0][..])
        }
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
        let ctx = surfer_core::geometry::ZRingContext::new(model, z);

        let side = if x < 0.0 { -1.0 } else { 1.0 };
        let abs_x = x.abs();

        let u = if ctx.profile.half_width > 1e-4 {
            (abs_x / ctx.profile.half_width).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let pt = ctx.get_point_at_uv(u, side);
        pt.y
    }

    #[wasm_bindgen]
    pub fn export_s3dx(&self) -> Result<String, JsValue> {
        Ok(surfer_core::s3dx_exporter::export_s3dx(
            self.engine.get_model(),
        ))
    }

    #[wasm_bindgen]
    pub fn export_obj(&mut self) -> Result<String, JsValue> {
        let mesh = self.engine.compute_mesh();
        Ok(surfer_core::obj_exporter::export_obj(
            self.engine.get_model(),
            &mesh,
        ))
    }

    #[wasm_bindgen]
    pub fn export_brd(&self) -> Result<Vec<u8>, JsValue> {
        surfer_core::brd_exporter::export_aku_brd(self.engine.get_model())
            .map_err(|e| JsValue::from_str(&e))
    }
}
