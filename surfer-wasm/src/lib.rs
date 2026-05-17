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
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = canvas;
            return Err(JsValue::from_str("WGPU rendering is only supported on the wasm32 target"));
        }

        #[cfg(target_arch = "wasm32")]
        {
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

            let config = surface.get_default_config(&adapter, 800, 600)
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
use js_sys::{Float32Array, Object, Reflect, Uint32Array};
use serde::Serialize;
use surfer_core::model::BoardAction;
use surfer_core::SurferEngine;
use wasm_bindgen::prelude::*;
pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::OffscreenCanvas;
use surfer_core::model::RawGeometryData;

#[derive(Serialize)]
pub struct WasmUpdateResult<'a> {
    pub state: &'a surfer_core::model::BoardModel,
    pub effects: &'a [surfer_core::model::Effect],
}

fn as_u8_slice<T>(data: &[T]) -> &[u8] {
    unsafe {
        std::slice::from_raw_parts(
            data.as_ptr() as *const u8,
            data.len() * std::mem::size_of::<T>(),
        )
    }
}

pub struct RenderState {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    normal_buffer: wgpu::Buffer,
    color_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    depth_texture: wgpu::TextureView,
}

impl RenderState {
    fn update_mesh_buffers(&mut self, mesh: &RawGeometryData) {
        if mesh.indices.is_empty() { return; }
        
        let vertex_bytes = as_u8_slice(&mesh.vertices);
        let normal_bytes = as_u8_slice(&mesh.normals);
        let color_bytes = as_u8_slice(&mesh.colors);
        let index_bytes = as_u8_slice(&mesh.indices);
        
        self.vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: vertex_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.normal_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: normal_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.color_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: color_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.index_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: index_bytes.len() as u64,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        self.queue.write_buffer(&self.vertex_buffer, 0, vertex_bytes);
        self.queue.write_buffer(&self.normal_buffer, 0, normal_bytes);
        self.queue.write_buffer(&self.color_buffer, 0, color_bytes);
        self.queue.write_buffer(&self.index_buffer, 0, index_bytes);
        self.num_indices = mesh.indices.len() as u32;
    }
}

struct CameraController {
    is_dragging: bool,
    last_mouse: (f32, f32),
    yaw: f32,
    pitch: f32,
    distance: f32,
    target: glam::Vec3,
}

impl Default for CameraController {
    fn default() -> Self {
        Self {
            is_dragging: false,
            last_mouse: (0.0, 0.0),
            yaw: std::f32::consts::PI / 4.0,
            pitch: std::f32::consts::PI / 6.0,
            distance: 20.0,
            target: glam::Vec3::ZERO,
        }
    }
}

impl CameraController {
    fn build_view_projection_matrix(&self, aspect: f32) -> glam::Mat4 {
        let x = self.distance * self.pitch.cos() * self.yaw.sin();
        let y = self.distance * self.pitch.sin();
        let z = self.distance * self.pitch.cos() * self.yaw.cos();
        let pos = self.target + glam::Vec3::new(x, y, z);
        
        let view = glam::Mat4::look_at_rh(pos, self.target, glam::Vec3::Y);
        let proj = glam::Mat4::perspective_rh(45.0_f32.to_radians(), aspect, 0.1, 1000.0);
        proj * view
    }
    
    fn process_pointer_down(&mut self, x: f32, y: f32) {
        self.is_dragging = true;
        self.last_mouse = (x, y);
    }
    fn process_pointer_move(&mut self, x: f32, y: f32) {
        if self.is_dragging {
            let dx = x - self.last_mouse.0;
            let dy = y - self.last_mouse.1;
            self.yaw -= dx * 0.01;
            self.pitch += dy * 0.01;
            self.pitch = self.pitch.clamp(-1.5, 1.5);
            self.last_mouse = (x, y);
        }
    }
    fn process_pointer_up(&mut self) {
        self.is_dragging = false;
    }
    fn process_wheel(&mut self, dy: f32) {
        self.distance += dy * 0.01;
        self.distance = self.distance.clamp(1.0, 100.0);
    }
}

#[derive(Clone, Copy, Default)]
struct MeshStats {
    volume_liters: f32,
    vertex_count: usize,
    triangle_count: usize,
}

#[wasm_bindgen]
pub struct WasmEngine {
    engine: SurferEngine,
    renderer: Option<RenderState>,
    camera_ctrl: CameraController,
    stats: MeshStats,
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
        let _ = console_log::init_with_level(log::Level::Info);
        Self {
            engine: SurferEngine::new(),
            renderer: None,
            camera_ctrl: CameraController::default(),
            stats: MeshStats::default(),
        }
    }

    #[wasm_bindgen]
    pub async fn init_renderer(&mut self, canvas: OffscreenCanvas, width: u32, height: u32) -> Result<(), JsValue> {
        #[cfg(target_arch = "wasm32")]
        {
            let instance = wgpu::Instance::default();
            let surface = instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas)).unwrap();
            let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            }).await.unwrap();

            let (device, queue) = adapter.request_device(
                &wgpu::DeviceDescriptor {
                    label: None,
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                },
                None,
            ).await.unwrap();

            let config = surface.get_default_config(&adapter, width, height).unwrap();
            surface.configure(&device, &config);

            let shader_src = r#"
                struct CameraUniform {
                    view_proj: mat4x4<f32>,
                };
                @group(0) @binding(0)
                var<uniform> camera: CameraUniform;

                struct VertexOutput {
                    @builtin(position) clip_position: vec4<f32>,
                    @location(0) color: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                };

                @vertex
                fn vs_main(
                    @location(0) position: vec3<f32>,
                    @location(1) normal: vec3<f32>,
                    @location(2) color: vec3<f32>,
                ) -> VertexOutput {
                    var out: VertexOutput;
                    out.color = color;
                    out.normal = normal;
                    out.clip_position = camera.view_proj * vec4<f32>(position, 1.0);
                    return out;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                    let light_dir = normalize(vec3<f32>(1.0, 2.0, 3.0));
                    let ambient = 0.3;
                    let diffuse = max(dot(in.normal, light_dir), 0.0) * 0.7;
                    return vec4<f32>(in.color * (ambient + diffuse), 1.0);
                }
            "#;

            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Shader"),
                source: wgpu::ShaderSource::Wgsl(shader_src.into()),
            });

            let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Camera Buffer"),
                size: 64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });

            let camera_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
                label: Some("camera_bind_group_layout"),
            });

            let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                layout: &camera_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                }],
                label: Some("camera_bind_group"),
            });

            let render_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Render Pipeline Layout"),
                bind_group_layouts: &[&camera_bind_group_layout],
                push_constant_ranges: &[],
            });

            let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("Render Pipeline"),
                layout: Some(&render_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: "vs_main",
                    buffers: &[
                        wgpu::VertexBufferLayout {
                            array_stride: 12,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &wgpu::vertex_attr_array![0 => Float32x3],
                        },
                        wgpu::VertexBufferLayout {
                            array_stride: 12,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &wgpu::vertex_attr_array![1 => Float32x3],
                        },
                        wgpu::VertexBufferLayout {
                            array_stride: 12,
                            step_mode: wgpu::VertexStepMode::Vertex,
                            attributes: &wgpu::vertex_attr_array![2 => Float32x3],
                        },
                    ],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: "fs_main",
                    targets: &[Some(wgpu::ColorTargetState {
                        format: config.format,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    strip_index_format: None,
                    front_face: wgpu::FrontFace::Ccw,
                    cull_mode: None,
                    polygon_mode: wgpu::PolygonMode::Fill,
                    unclipped_depth: false,
                    conservative: false,
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth24Plus,
                    depth_write_enabled: true,
                    depth_compare: wgpu::CompareFunction::Less,
                    stencil: wgpu::StencilState::default(),
                    bias: wgpu::DepthBiasState::default(),
                }),
                multisample: wgpu::MultisampleState {
                    count: 1,
                    mask: !0,
                    alpha_to_coverage_enabled: false,
                },
                multiview: None,
            });

            let depth_texture = Self::create_depth_texture(&device, width, height);
            
            let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None, size: 4, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            });
            let normal_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None, size: 4, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            });
            let color_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None, size: 4, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            });
            let index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None, size: 4, usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            });

            self.renderer = Some(RenderState {
                surface,
                device,
                queue,
                config,
                pipeline: render_pipeline,
                vertex_buffer,
                normal_buffer,
                color_buffer,
                index_buffer,
                num_indices: 0,
                camera_buffer,
                camera_bind_group,
                depth_texture,
            });

            self.update_render_mesh();
        }
        Ok(())
    }

    fn create_depth_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
        let size = wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Depth Texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth24Plus,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }

    #[wasm_bindgen]
    pub fn resize_renderer(&mut self, width: u32, height: u32) {
        if let Some(renderer) = &mut self.renderer {
            renderer.config.width = width.max(1);
            renderer.config.height = height.max(1);
            renderer.surface.configure(&renderer.device, &renderer.config);
            renderer.depth_texture = Self::create_depth_texture(&renderer.device, width, height);
        }
    }

    #[wasm_bindgen]
    pub fn handle_pointer(&mut self, event_type: &str, x: f32, y: f32) {
        match event_type {
            "down" => self.camera_ctrl.process_pointer_down(x, y),
            "move" => self.camera_ctrl.process_pointer_move(x, y),
            "up" => self.camera_ctrl.process_pointer_up(),
            _ => {}
        }
    }

    #[wasm_bindgen]
    pub fn handle_wheel(&mut self, dy: f32) {
        self.camera_ctrl.process_wheel(dy);
    }

    #[wasm_bindgen]
    pub fn render(&mut self) -> Result<(), JsValue> {
        if let Some(renderer) = &mut self.renderer {
            let aspect = renderer.config.width as f32 / renderer.config.height as f32;
            let view_proj = self.camera_ctrl.build_view_projection_matrix(aspect);
            let view_proj_bytes = as_u8_slice(&view_proj.to_cols_array());
            renderer.queue.write_buffer(&renderer.camera_buffer, 0, view_proj_bytes);

            let frame = renderer.surface.get_current_texture()
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());

            let mut encoder = renderer.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            {
                let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.1,
                                g: 0.1,
                                b: 0.1,
                                a: 1.0,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &renderer.depth_texture,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Clear(1.0),
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                });

                if renderer.num_indices > 0 {
                    rpass.set_pipeline(&renderer.pipeline);
                    rpass.set_bind_group(0, &renderer.camera_bind_group, &[]);
                    rpass.set_vertex_buffer(0, renderer.vertex_buffer.slice(..));
                    rpass.set_vertex_buffer(1, renderer.normal_buffer.slice(..));
                    rpass.set_vertex_buffer(2, renderer.color_buffer.slice(..));
                    rpass.set_index_buffer(renderer.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                    rpass.draw_indexed(0..renderer.num_indices, 0, 0..1);
                }
            }

            renderer.queue.submit(Some(encoder.finish()));
            frame.present();
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub fn propose(&mut self, action_js: JsValue) -> Result<JsValue, JsValue> {
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let (new_state, effects) = self.engine.update(action);
        self.update_render_mesh();

        let res = WasmUpdateResult {
            state: &new_state,
            effects: &effects,
        };

        Ok(serde_wasm_bindgen::to_value(&res)?)
    }

    fn update_render_mesh(&mut self) {
        let mesh = self.engine.compute_mesh();
        self.stats.vertex_count = mesh.vertices.len() / 3;
        self.stats.triangle_count = mesh.indices.len() / 3;
        self.stats.volume_liters = mesh.volume_liters;

        if let Some(renderer) = &mut self.renderer {
            renderer.update_mesh_buffers(&mesh);
        }
    }

    #[wasm_bindgen]
    pub fn get_stats(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        Reflect::set(&obj, &JsValue::from_str("volumeLiters"), &JsValue::from_f64(self.stats.volume_liters as f64))?;
        Reflect::set(&obj, &JsValue::from_str("vertexCount"), &JsValue::from_f64(self.stats.vertex_count as f64))?;
        Reflect::set(&obj, &JsValue::from_str("triangleCount"), &JsValue::from_f64(self.stats.triangle_count as f64))?;
        Ok(obj.into())
    }

    #[wasm_bindgen]
    pub fn get_state(&self) -> Result<JsValue, JsValue> {
        let state = self.engine.get_model();
        Ok(serde_wasm_bindgen::to_value(state)?)
    }

    #[wasm_bindgen]
    pub fn get_mesh(&mut self) -> Result<JsValue, JsValue> {
        // Legacy shim for components that still call get_mesh, just return stats instead of massive buffers
        self.get_stats()
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
        Reflect::set(&obj, &JsValue::from_str("topY"), &JsValue::from_f64(profile.top_y as f64))?;
        Reflect::set(&obj, &JsValue::from_str("botY"), &JsValue::from_f64(profile.bot_y as f64))?;
        Reflect::set(&obj, &JsValue::from_str("apexX"), &JsValue::from_f64(profile.apex_x as f64))?;
        Reflect::set(&obj, &JsValue::from_str("apexY"), &JsValue::from_f64(profile.apex_y as f64))?;
        Reflect::set(&obj, &JsValue::from_str("tuckX"), &JsValue::from_f64(profile.tuck_x as f64))?;
        Reflect::set(&obj, &JsValue::from_str("tuckY"), &JsValue::from_f64(profile.tuck_y as f64))?;
        Reflect::set(&obj, &JsValue::from_str("shoulderX"), &JsValue::from_f64(profile.shoulder_x as f64))?;
        Reflect::set(&obj, &JsValue::from_str("shoulderY"), &JsValue::from_f64(profile.shoulder_y as f64))?;
        Reflect::set(&obj, &JsValue::from_str("halfWidth"), &JsValue::from_f64(profile.half_width as f64))?;
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

