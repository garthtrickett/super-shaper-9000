use js_sys::{Float32Array, Object, Reflect};
use serde::Serialize;
use surfer_core::model::{BoardAction, RawGeometryData};
use surfer_core::SurferEngine;
use wasm_bindgen::prelude::*;
pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::OffscreenCanvas;

#[derive(Serialize)]
pub struct WasmUpdateResult<'a> {
    pub state: &'a surfer_core::model::BoardModel,
    pub effects: &'a [surfer_core::model::Effect],
}

fn as_u8_slice<T>(data: &[T]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u8, std::mem::size_of_val(data)) }
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
        camera_buffers: Vec<wgpu::Buffer>,
    camera_bind_groups: Vec<wgpu::BindGroup>,
    depth_texture: wgpu::TextureView,
    line_pipeline: wgpu::RenderPipeline,
    line_vertex_buffer: wgpu::Buffer,
    line_color_buffer: wgpu::Buffer,
    num_line_vertices: u32,
}

impl RenderState {
    pub fn create_depth_texture(
        device: &wgpu::Device,
        width: u32,
        height: u32,
    ) -> wgpu::TextureView {
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

    fn update_mesh_buffers(&mut self, mesh: &RawGeometryData) {
        if mesh.indices.is_empty() {
            return;
        }

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

        self.queue
            .write_buffer(&self.vertex_buffer, 0, vertex_bytes);
        self.queue
            .write_buffer(&self.normal_buffer, 0, normal_bytes);
        self.queue.write_buffer(&self.color_buffer, 0, color_bytes);
        self.queue.write_buffer(&self.index_buffer, 0, index_bytes);
        self.num_indices = mesh.indices.len() as u32;

        // Basic line/gizmo update (Mocked for testing)
        let line_verts: [f32; 6] = [0.0, 0.0, -10.0, 0.0, 0.0, 10.0];
        let line_colors: [f32; 6] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let lv_bytes = as_u8_slice(&line_verts);
        let lc_bytes = as_u8_slice(&line_colors);

        self.line_vertex_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: lv_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.line_color_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: lc_bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue
            .write_buffer(&self.line_vertex_buffer, 0, lv_bytes);
        self.queue
            .write_buffer(&self.line_color_buffer, 0, lc_bytes);
        self.num_line_vertices = 2;
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
    view_mode: String,
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
            view_mode: "quad".to_string(),
        }
    }

    #[wasm_bindgen]
    pub fn set_view_mode(&mut self, mode: &str) {
        self.view_mode = mode.to_string();
    }

    #[wasm_bindgen]
    pub fn set_renderer(&mut self, renderer: WgpuRenderer) {
        self.renderer = Some(renderer.0);
        self.update_render_mesh();
    }

    #[wasm_bindgen]
    pub fn resize_renderer(&mut self, width: u32, height: u32) {
        if let Some(renderer) = &mut self.renderer {
            renderer.config.width = width.max(1);
            renderer.config.height = height.max(1);
            renderer
                .surface
                .configure(&renderer.device, &renderer.config);
            renderer.depth_texture =
                RenderState::create_depth_texture(&renderer.device, width, height);
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
    pub fn handle_gizmo_drag(
        &mut self,
        curve_name: &str,
        index: usize,
        node_type: &str,
        x: f32,
        y: f32,
        z: f32,
    ) {
        let action = surfer_core::model::BoardAction::UpdateNodePosition {
            curve: curve_name.to_string(),
            index,
            node_type: node_type.to_string(),
            position: [x, y, z],
        };
        self.engine.update(action);
        self.update_render_mesh();
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn render(&mut self) -> Result<(), JsValue> {
        if let Some(renderer) = &mut self.renderer {
            let full_w = renderer.config.width as f32;
            let full_h = renderer.config.height as f32;

            let quadrants = if self.view_mode == "quad" || self.view_mode.is_empty() {
                vec!["top", "perspective", "side", "profile"]
            } else {
                vec![self.view_mode.as_str()]
            };

            for (i, &q) in quadrants.iter().enumerate() {
                let (vp_w, vp_h) = if quadrants.len() == 4 {
                    (full_w / 2.0, full_h / 2.0)
                } else {
                    (full_w, full_h)
                };
                let aspect = vp_w / vp_h;

                let view_proj = match q {
                    "top" => {
                        let view = glam::Mat4::look_at_rh(glam::Vec3::new(0.0, 10.0, 0.0), glam::Vec3::ZERO, glam::Vec3::new(0.0, 0.0, -1.0));
                        let proj = glam::Mat4::orthographic_rh(-5.0 * aspect, 5.0 * aspect, -5.0, 5.0, 0.1, 1000.0);
                        proj * view
                    },
                    "side" => {
                        let frustum_half = 5.0;
                        let stretch_y = 2.5;
                        let ortho_right = frustum_half * aspect;
                        let ortho_top = frustum_half / stretch_y;
                        let view = glam::Mat4::look_at_rh(glam::Vec3::new(-10.0, 0.0, 0.0), glam::Vec3::ZERO, glam::Vec3::Y);
                        let proj = glam::Mat4::orthographic_rh(-ortho_right, ortho_right, -ortho_top, ortho_top, 0.1, 1000.0);
                        proj * view
                    },
                    "profile" => {
                        let view = glam::Mat4::look_at_rh(glam::Vec3::new(0.0, 0.0, 10.0), glam::Vec3::ZERO, glam::Vec3::Y);
                        let proj = glam::Mat4::orthographic_rh(-5.0 * aspect, 5.0 * aspect, -5.0, 5.0, 0.1, 1000.0);
                        proj * view
                    },
                    _ => self.camera_ctrl.build_view_projection_matrix(aspect),
                };

                let view_proj_array = view_proj.to_cols_array();
                let view_proj_bytes = as_u8_slice(&view_proj_array);
                renderer.queue.write_buffer(&renderer.camera_buffers[i], 0, view_proj_bytes);
            }

            let frame = renderer.surface.get_current_texture().map_err(|e| JsValue::from_str(&e.to_string()))?;
            let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = renderer.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

            {
                let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.1, g: 0.1, b: 0.1, a: 1.0 }),
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

                for (i, &q) in quadrants.iter().enumerate() {
                    let (vp_x, vp_y, vp_w, vp_h) = if quadrants.len() == 4 {
                        let half_w = full_w / 2.0;
                        let half_h = full_h / 2.0;
                        match q {
                            "top" => (0.0, 0.0, half_w, half_h),
                            "perspective" => (half_w, 0.0, half_w, half_h),
                            "side" => (0.0, half_h, half_w, half_h),
                            "profile" => (half_w, half_h, half_w, half_h),
                            _ => (0.0, 0.0, half_w, half_h),
                        }
                    } else {
                        (0.0, 0.0, full_w, full_h)
                    };

                    rpass.set_viewport(vp_x, vp_y, vp_w, vp_h, 0.0, 1.0);
                    rpass.set_scissor_rect(vp_x as u32, vp_y as u32, vp_w as u32, vp_h as u32);

                    if renderer.num_indices > 0 {
                        rpass.set_pipeline(&renderer.pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(0, renderer.vertex_buffer.slice(..));
                        rpass.set_vertex_buffer(1, renderer.normal_buffer.slice(..));
                        rpass.set_vertex_buffer(2, renderer.color_buffer.slice(..));
                        rpass.set_index_buffer(renderer.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                        rpass.draw_indexed(0..renderer.num_indices, 0, 0..1);
                    }

                    if renderer.num_line_vertices > 0 {
                        rpass.set_pipeline(&renderer.line_pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(0, renderer.line_vertex_buffer.slice(..));
                        rpass.set_vertex_buffer(1, renderer.line_color_buffer.slice(..));
                        rpass.draw(0..renderer.num_line_vertices, 0..1);
                    }
                }
            }

            renderer.queue.submit(Some(encoder.finish()));
            frame.present();
        }
        Ok(())
    }