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
    msaa_texture: wgpu::TextureView,
        line_pipeline: wgpu::RenderPipeline,
    line_vertex_buffers: Vec<wgpu::Buffer>,
    line_color_buffers: Vec<wgpu::Buffer>,
    num_line_vertices: [u32; 4],
    gizmo_pipeline: wgpu::RenderPipeline,
    gizmo_vertex_buffers: Vec<wgpu::Buffer>,
    gizmo_color_buffers: Vec<wgpu::Buffer>,
    gizmo_index_buffers: Vec<wgpu::Buffer>,
    num_gizmo_indices: [u32; 4],
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
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth24Plus,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }

    pub fn create_msaa_texture(
        device: &wgpu::Device,
        config: &wgpu::SurfaceConfiguration,
        width: u32,
        height: u32,
    ) -> wgpu::TextureView {
        let size = wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("MSAA Texture"),
            size,
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: config.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }

    fn update_mesh_buffers(&mut self, mesh: &RawGeometryData) {
        if !mesh.indices.is_empty() {
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
        }
    }

        fn update_view_buffers(
        &mut self,
        idx: usize,
        line_vertices: &[f32],
        line_colors: &[f32],
        tri_vertices: &[f32],
        tri_colors: &[f32],
        tri_indices: &[u32],
    ) {
        let line_verts = as_u8_slice(line_vertices);
        let line_cols = as_u8_slice(line_colors);

        self.line_vertex_buffers[idx] = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (line_verts.len().max(4)) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.line_color_buffers[idx] = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (line_cols.len().max(4)) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        if !line_verts.is_empty() {
            self.queue
                .write_buffer(&self.line_vertex_buffers[idx], 0, line_verts);
            self.queue
                .write_buffer(&self.line_color_buffers[idx], 0, line_cols);
            self.num_line_vertices[idx] = (line_vertices.len() / 3) as u32;
        } else {
            self.num_line_vertices[idx] = 0;
        }

        let tri_verts = as_u8_slice(tri_vertices);
        let tri_cols = as_u8_slice(tri_colors);
        let tri_idxs = as_u8_slice(tri_indices);

        self.gizmo_vertex_buffers[idx] = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (tri_verts.len().max(4)) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gizmo_color_buffers[idx] = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (tri_cols.len().max(4)) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.gizmo_index_buffers[idx] = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (tri_idxs.len().max(4)) as u64,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        if !tri_idxs.is_empty() {
            self.queue.write_buffer(&self.gizmo_vertex_buffers[idx], 0, tri_verts);
            self.queue.write_buffer(&self.gizmo_color_buffers[idx], 0, tri_cols);
            self.queue.write_buffer(&self.gizmo_index_buffers[idx], 0, tri_idxs);
            self.num_gizmo_indices[idx] = tri_indices.len() as u32;
        } else {
            self.num_gizmo_indices[idx] = 0;
        }
    }
}

struct CameraController {
    is_dragging: bool,
    last_mouse: (f32, f32),
    yaw: f32,
    pitch: f32,
    distance_top: f32,
    distance_side: f32,
    distance_profile: f32,
    distance_persp: f32,
    target: glam::Vec3,
    pan_top: (f32, f32),
    pan_side: (f32, f32),
    pan_profile: (f32, f32),
}

impl Default for CameraController {
    fn default() -> Self {
        Self {
            is_dragging: false,
            last_mouse: (0.0, 0.0),
            yaw: std::f32::consts::PI / 4.0,
            pitch: std::f32::consts::PI / 6.0,
            distance_top: 1.0,
            distance_side: 1.0,
            distance_profile: 1.0,
            distance_persp: 1.0,
            target: glam::Vec3::ZERO,
            pan_top: (0.0, 0.0),
            pan_side: (0.0, 0.0),
            pan_profile: (0.0, 0.0),
        }
    }
}

impl CameraController {
    fn process_pointer_down(&mut self, x: f32, y: f32) {
        self.is_dragging = true;
        self.last_mouse = (x, y);
    }
    fn process_pointer_move(&mut self, x: f32, y: f32, quad: &str) {
        if self.is_dragging {
            let dx = x - self.last_mouse.0;
            let dy = y - self.last_mouse.1;
            if quad == "perspective" {
                self.yaw -= dx * 0.01;
                self.pitch += dy * 0.01;
                self.pitch = self.pitch.clamp(-1.5, 1.5);
            } else if quad == "top" {
                let scale = self.distance_top * 0.015;
                self.pan_top.0 -= dy * scale;
                self.pan_top.1 += dx * scale;
            } else if quad == "side" {
                let scale = self.distance_side * 0.015;
                self.pan_side.0 -= dx * scale;
                self.pan_side.1 += dy * scale;
            } else if quad == "profile" {
                let scale = self.distance_profile * 0.015;
                self.pan_profile.0 -= dx * scale;
                self.pan_profile.1 += dy * scale;
            }
            self.last_mouse = (x, y);
        }
    }
    fn process_pointer_up(&mut self) {
        self.is_dragging = false;
    }
    fn process_wheel(&mut self, dy: f32, quad: &str) {
        let zoom = dy * 0.002;
        let factor = 1.0 + zoom;
        match quad {
            "top" => {
                self.distance_top *= factor;
                self.distance_top = self.distance_top.clamp(0.05, 20.0);
            }
            "side" => {
                self.distance_side *= factor;
                self.distance_side = self.distance_side.clamp(0.05, 20.0);
            }
            "profile" => {
                self.distance_profile *= factor;
                self.distance_profile = self.distance_profile.clamp(0.05, 20.0);
            }
            "perspective" => {
                self.distance_persp *= factor;
                self.distance_persp = self.distance_persp.clamp(0.05, 20.0);
            }
            _ => {}
        }
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
    is_ortho: bool,
            active_profile_slice: usize,
    show_tangents: [bool; 4],
    gizmo_scale: [f32; 4],
    line_masks: [u32; 4],
    gizmo_masks: [u32; 4],
    show_solid_mesh: bool,
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
            is_ortho: false,
                                                            active_profile_slice: 0,
            show_tangents: [true, true, true, true],
            gizmo_scale: [1.0, 1.0, 0.5, 0.3],
            line_masks: [0x1FF, 0x1FF, 0x1FF, 0x1FF],
            gizmo_masks: [0x1FF, 0x1FF, 0x1FF, 0x1FF],
            show_solid_mesh: true,
        }
    }

                    fn get_camera_params(&self, quad: &str, aspect: f32) -> (glam::Mat4, glam::Vec3) {
        let model = self.engine.get_model();
        
        let mut min_pt = glam::Vec3::splat(f32::INFINITY);
        let mut max_pt = glam::Vec3::splat(f32::NEG_INFINITY);

        let mut add_curve = |c_opt: &Option<surfer_core::model::BezierCurveData>, mirror_x: bool| {
            if let Some(c) = c_opt {
                if c.control_points.is_empty() { return; }
                for p in &c.control_points {
                    min_pt = min_pt.min(*p);
                    max_pt = max_pt.max(*p);
                    if mirror_x {
                        min_pt.x = min_pt.x.min(-p.x);
                        max_pt.x = max_pt.x.max(-p.x);
                    }
                }
                for i in 0..=20 {
                    let p = surfer_core::geometry::evaluate_curve(c, i as f32 / 20.0);
                    min_pt = min_pt.min(p);
                    max_pt = max_pt.max(p);
                    if mirror_x {
                        min_pt.x = min_pt.x.min(-p.x);
                        max_pt.x = max_pt.x.max(-p.x);
                    }
                }
            }
        };

        if quad == "top" || quad == "perspective" {
            add_curve(&model.outline, true);
            add_curve(&model.apex_outline, true);
            add_curve(&model.rail_outline, true);
            add_curve(&model.deck_shoulder, true);

            if let Some(layers) = &model.outline_layers {
                for l in layers {
                    if l.active {
                        add_curve(&Some(l.otl_ext.clone()), true);
                        add_curve(&Some(l.otl_int.clone()), true);
                    }
                }
            }
            if let Some(channels) = &model.bottom_channels {
                for c in channels {
                    add_curve(&Some(c.left_outline.clone()), false);
                    add_curve(&Some(c.right_outline.clone()), false);
                }
            }
        }

        if quad == "side" || quad == "perspective" {
            add_curve(&model.rocker_top, false);
            add_curve(&model.rocker_bottom, false);
            add_curve(&model.apex_rocker, false);
            if let Some(channels) = &model.bottom_channels {
                for c in channels {
                    add_curve(&Some(c.left_depth.clone()), false);
                    add_curve(&Some(c.right_depth.clone()), false);
                }
            }
        }

        if quad == "profile" {
            if let Some(cs) = model.cross_sections.get(self.active_profile_slice) {
                add_curve(&Some(cs.clone()), true);
            }
        }
        
        if min_pt.x.is_infinite() { min_pt.x = -10.0; max_pt.x = 10.0; }
        if min_pt.y.is_infinite() { min_pt.y = -2.0; max_pt.y = 2.0; }
        if min_pt.z.is_infinite() { min_pt.z = 0.0; max_pt.z = 70.0; }

        let scale = 1.0 / 12.0;
        let size_x = (max_pt.x - min_pt.x).max(0.1) * scale;
        let size_y = (max_pt.y - min_pt.y).max(0.1) * scale;
        let size_z = (max_pt.z - min_pt.z).max(0.1) * scale;

        // Force stringer-aligned X center to 0.0 to prevent wobble
        let center_y = (max_pt.y + min_pt.y) / 2.0 * scale;
        let center_z = (max_pt.z + min_pt.z) / 2.0 * scale;

        match quad {
            "top" => {
                let base_frustum = (size_z * 1.1 / (2.0 * aspect)).max(size_x * 1.2 / 2.0);
                let frustum = base_frustum * self.camera_ctrl.distance_top;
                // Lock X target to 0.0 (Stringer)
                let target = glam::Vec3::new(self.camera_ctrl.pan_top.0, 0.0, center_z + self.camera_ctrl.pan_top.1);
                let cam_pos = target + glam::Vec3::new(0.0, 10.0, 0.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::new(-1.0, 0.0, 0.0));
                let proj = glam::Mat4::orthographic_rh(-frustum * aspect, frustum * aspect, -frustum, frustum, 0.1, 1000.0);
                (proj * view, cam_pos)
            }
            "side" => {
                let stretch_y = 2.5;
                let base_frustum_half = (size_z * 1.1 / (2.0 * aspect)).max(size_y * 1.5 * stretch_y / 2.0);
                let frustum_half = base_frustum_half * self.camera_ctrl.distance_side;
                let ortho_right = frustum_half * aspect;
                let ortho_top = frustum_half / stretch_y;
                let target = glam::Vec3::new(0.0, center_y + self.camera_ctrl.pan_side.1, center_z + self.camera_ctrl.pan_side.0);
                let cam_pos = target + glam::Vec3::new(-10.0, 0.0, 0.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                let proj = glam::Mat4::orthographic_rh(-ortho_right, ortho_right, -ortho_top, ortho_top, 0.1, 1000.0);
                (proj * view, cam_pos)
            }
            "profile" => {
                // Reduced padding multiplier from 1.5 to 1.1 (width) and 1.2 (height)
                let base_frustum = (size_x * 1.1 / (2.0 * aspect)).max(size_y * 1.2 / 2.0);
                let frustum = base_frustum * self.camera_ctrl.distance_profile;
                
                let target_z = if let Some(cs) = model.cross_sections.get(self.active_profile_slice) {
                    cs.control_points.first().map(|p| p.z).unwrap_or(0.0) * scale
                } else {
                    center_z
                };
                
                // Lock X target to 0.0 (Stringer)
                let target = glam::Vec3::new(self.camera_ctrl.pan_profile.0, center_y + self.camera_ctrl.pan_profile.1, target_z);
                let cam_pos = target + glam::Vec3::new(0.0, 0.0, 1.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                let proj = glam::Mat4::orthographic_rh(-frustum * aspect, frustum * aspect, -frustum, frustum, 0.9, 1.1);
                (proj * view, cam_pos)
            }
            _ => { // perspective
                let base_dist = size_z.max(size_x).max(size_y) * 1.3;
                let dist = base_dist * self.camera_ctrl.distance_persp;
                let x = dist * self.camera_ctrl.pitch.cos() * self.camera_ctrl.yaw.sin();
                let y = dist * self.camera_ctrl.pitch.sin();
                let z = dist * self.camera_ctrl.pitch.cos() * self.camera_ctrl.yaw.cos();
                
                // Keep perspective locked to X=0.0 to pivot cleanly around stringer
                let target = self.camera_ctrl.target + glam::Vec3::new(0.0, center_y, center_z);
                let cam_pos = target + glam::Vec3::new(x, y, z);
                
                if self.is_ortho {
                    let base_frustum = (size_z * 1.1 / (2.0 * aspect)).max(size_x * 1.2 / 2.0);
                    let frustum = base_frustum * self.camera_ctrl.distance_persp;
                    let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                    let proj = glam::Mat4::orthographic_rh(-frustum * aspect, frustum * aspect, -frustum, frustum, 0.1, 1000.0);
                    (proj * view, cam_pos)
                } else {
                    let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                    let proj = glam::Mat4::perspective_rh(45.0_f32.to_radians(), aspect, 0.1, 1000.0);
                    (proj * view, cam_pos)
                }
            }
        }
    }

    #[wasm_bindgen]
    pub fn set_view_mode(&mut self, mode: &str) {
        self.view_mode = mode.to_string();
    }

        #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn set_show_tangents(&mut self, quad: &str, show: bool) {
        let idx = match quad {
            "top" => 0,
            "perspective" => 1,
            "side" => 2,
            "profile" => 3,
            _ => return,
        };
        self.show_tangents[idx] = show;
        if let Some(renderer) = &mut self.renderer {
            let (lv, lc, tv, tc, ti) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                quad,
                self.active_profile_slice,
                show,
                self.line_masks[idx],
                self.gizmo_masks[idx],
                self.gizmo_scale[idx],
            );
            renderer.update_view_buffers(idx, &lv, &lc, &tv, &tc, &ti);
        }
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn set_masks(&mut self, quad: &str, line_mask: u32, gizmo_mask: u32) {
        let idx = match quad {
            "top" => 0,
            "perspective" => 1,
            "side" => 2,
            "profile" => 3,
            _ => return,
        };
        self.line_masks[idx] = line_mask;
        self.gizmo_masks[idx] = gizmo_mask;
        if let Some(renderer) = &mut self.renderer {
            let (lv, lc, tv, tc, ti) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                quad,
                self.active_profile_slice,
                self.show_tangents[idx],
                self.line_masks[idx],
                self.gizmo_masks[idx],
                self.gizmo_scale[idx],
            );
            renderer.update_view_buffers(idx, &lv, &lc, &tv, &tc, &ti);
        }
    }

    #[wasm_bindgen]
    pub fn set_show_solid_mesh(&mut self, show: bool) {
        self.show_solid_mesh = show;
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn set_gizmo_scale(&mut self, quad: &str, scale: f32) {
        let idx = match quad {
            "top" => 0,
            "perspective" => 1,
            "side" => 2,
            "profile" => 3,
            _ => return,
        };
        self.gizmo_scale[idx] = scale;
        if let Some(renderer) = &mut self.renderer {
            let (lv, lc, tv, tc, ti) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                quad,
                self.active_profile_slice,
                self.show_tangents[idx],
                self.line_masks[idx],
                self.gizmo_masks[idx],
                self.gizmo_scale[idx],
            );
            renderer.update_view_buffers(idx, &lv, &lc, &tv, &tc, &ti);
        }
    }

    #[wasm_bindgen]
    pub fn set_ortho(&mut self, is_ortho: bool) {
        self.is_ortho = is_ortho;
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn set_active_profile_slice(&mut self, slice: usize) {
        self.active_profile_slice = slice;
        if let Some(renderer) = &mut self.renderer {
            let (lv_prof, lc_prof, tv_prof, tc_prof, ti_prof) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                "profile",
                self.active_profile_slice,
                self.show_tangents[3],
                self.line_masks[3],
                self.gizmo_masks[3],
                self.gizmo_scale[3]
            );
            renderer.update_view_buffers(3, &lv_prof, &lc_prof, &tv_prof, &tc_prof, &ti_prof);

            let (lv_persp, lc_persp, tv_persp, tc_persp, ti_persp) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                "perspective",
                self.active_profile_slice,
                self.show_tangents[1],
                self.line_masks[1],
                self.gizmo_masks[1],
                self.gizmo_scale[1]
            );
            renderer.update_view_buffers(1, &lv_persp, &lc_persp, &tv_persp, &tc_persp, &ti_persp);
        }
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
            renderer.msaa_texture =
                RenderState::create_msaa_texture(&renderer.device, &renderer.config, width, height);
        }
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn handle_pointer(&mut self, event_type: &str, x: f32, y: f32, quad: &str) {
        match event_type {
            "down" => self.camera_ctrl.process_pointer_down(x, y),
            "move" => self.camera_ctrl.process_pointer_move(x, y, quad),
            "up" => self.camera_ctrl.process_pointer_up(),
            _ => {}
        }
    }

    #[wasm_bindgen]
    pub fn handle_wheel(&mut self, dy: f32, quad: &str) {
        self.camera_ctrl.process_wheel(dy, quad);
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
    pub fn handle_gizmo_drag(
        &mut self,
        curve_name: &str,
        index: usize,
        node_type: &str,
        x: f32,
        y: f32,
        z: f32,
        continuity: &str,
    ) {
        let action = surfer_core::model::BoardAction::UpdateNodePosition {
            curve: curve_name.to_string(),
            index,
            node_type: node_type.to_string(),
            position: [x, y, z],
        };
        self.engine.update(action);

        if continuity != "G0" && (node_type == "tangent1" || node_type == "tangent2") {
            let cont_action = surfer_core::model::BoardAction::ApplyContinuity {
                curve: curve_name.to_string(),
                index,
                level: continuity.to_string(),
                master: Some(node_type.to_string()),
            };
            self.engine.update(cont_action);
        }

        self.update_render_mesh();
    }

    #[wasm_bindgen]
    pub fn propose_state_only(&mut self, action_js: JsValue) -> Result<(), JsValue> {
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.engine.update(action);
        Ok(())
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
        #[wasm_bindgen]
    pub fn render(&mut self) -> Result<(), JsValue> {
        let (full_w, full_h) = if let Some(r) = &self.renderer {
            (r.config.width as f32, r.config.height as f32)
        } else {
            return Ok(());
        };

        let quadrants: Vec<String> = if self.view_mode == "quad" || self.view_mode.is_empty() {
            vec!["top".to_string(), "perspective".to_string(), "side".to_string(), "profile".to_string()]
        } else {
            vec![self.view_mode.clone()]
        };

        let mut uniforms = Vec::new();
        for q_string in quadrants.iter() {
            let q = q_string.as_str();
            let (vp_w, vp_h) = if quadrants.len() == 4 {
                (full_w / 2.0, full_h / 2.0)
            } else {
                (full_w, full_h)
            };
            let aspect = vp_w / vp_h;

            let (view_proj, cam_pos) = self.get_camera_params(q, aspect);
            let view_proj_array = view_proj.to_cols_array();

            let mut uniform_data = [0.0f32; 24];
            uniform_data[0..16].copy_from_slice(&view_proj_array);
            uniform_data[16..19].copy_from_slice(&cam_pos.to_array());
            uniform_data[19] = 1.0;

            let model = self.engine.get_model();
            let bounds = surfer_core::geometry::get_board_bounds(model);
            let mri_z = bounds.nose_z
                + (bounds.tip_z - bounds.nose_z)
                    * (model.mri_slice_position.unwrap_or(50.0) / 100.0);
            let mri_z_world = mri_z * (1.0 / 12.0);

            uniform_data[20] = if model.show_heatmap.unwrap_or(false) {
                1.0
            } else {
                0.0
            };
            uniform_data[21] = if model.show_zebra.unwrap_or(false) {
                1.0
            } else {
                0.0
            };
            uniform_data[22] = if model.show_mri_view.unwrap_or(false) {
                1.0
            } else {
                0.0
            };
            uniform_data[23] = mri_z_world;
            
            uniforms.push(uniform_data);
        }

        let show_solid_mesh = self.show_solid_mesh;
        let view_mode = self.view_mode.clone();

        if let Some(renderer) = &mut self.renderer {
            for (i, uniform_data) in uniforms.iter().enumerate() {
                let uniform_bytes = as_u8_slice(uniform_data);
                renderer
                    .queue
                    .write_buffer(&renderer.camera_buffers[i], 0, uniform_bytes);
            }

            let frame = renderer
                .surface
                .get_current_texture()
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            let view = frame
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = renderer
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

            {
                let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &renderer.msaa_texture,
                        resolve_target: Some(&view),
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

                for (i, q_string) in quadrants.iter().enumerate() {
                    let q = q_string.as_str();
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

                    let draw_solid = (q == "perspective"
                        || (view_mode != "quad"
                            && view_mode != "top"
                            && view_mode != "side"
                            && view_mode != "profile"))
                        && show_solid_mesh;

                    if draw_solid && renderer.num_indices > 0 {
                        rpass.set_pipeline(&renderer.pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(0, renderer.vertex_buffer.slice(..));
                        rpass.set_vertex_buffer(1, renderer.normal_buffer.slice(..));
                        rpass.set_vertex_buffer(2, renderer.color_buffer.slice(..));
                        rpass.set_index_buffer(
                            renderer.index_buffer.slice(..),
                            wgpu::IndexFormat::Uint32,
                        );
                        rpass.draw_indexed(0..renderer.num_indices, 0, 0..1);
                    }

                    let view_idx = match q {
                        "top" => 0,
                        "perspective" => 1,
                        "side" => 2,
                        "profile" => 3,
                        _ => 1,
                    };

                    if renderer.num_line_vertices[view_idx] > 0 {
                        rpass.set_pipeline(&renderer.line_pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(0, renderer.line_vertex_buffers[view_idx].slice(..));
                        rpass.set_vertex_buffer(1, renderer.line_color_buffers[view_idx].slice(..));
                        rpass.draw(0..renderer.num_line_vertices[view_idx], 0..1);
                    }

                    if renderer.num_gizmo_indices[view_idx] > 0 {
                        rpass.set_pipeline(&renderer.gizmo_pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(0, renderer.gizmo_vertex_buffers[view_idx].slice(..));
                        rpass.set_vertex_buffer(1, renderer.gizmo_color_buffers[view_idx].slice(..));
                        rpass.set_index_buffer(renderer.gizmo_index_buffers[view_idx].slice(..), wgpu::IndexFormat::Uint32);
                        rpass.draw_indexed(0..renderer.num_gizmo_indices[view_idx], 0, 0..1);
                    }
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
                        let views = ["top", "perspective", "side", "profile"];
                        for (i, view_id) in views.iter().enumerate() {
                let (lv, lc, tv, tc, ti) = surfer_core::mesh::generate_lines_for_view(
                    self.engine.get_model(),
                    view_id,
                    self.active_profile_slice,
                    self.show_tangents[i],
                                        self.line_masks[i],
                    self.gizmo_masks[i],
                    self.gizmo_scale[i]
                );
                renderer.update_view_buffers(i, &lv, &lc, &tv, &tc, &ti);
            }
        }
    }

    #[wasm_bindgen]
    pub fn get_stats(&self) -> Result<JsValue, JsValue> {
        let obj = Object::new();
        Reflect::set(
            &obj,
            &JsValue::from_str("volumeLiters"),
            &JsValue::from_f64(self.stats.volume_liters as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("vertexCount"),
            &JsValue::from_f64(self.stats.vertex_count as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("triangleCount"),
            &JsValue::from_f64(self.stats.triangle_count as f64),
        )?;
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
    pub fn get_slice_profile(&self, z: f32) -> Result<JsValue, JsValue> {
        let profile = self.engine.compute_slice_profile(z);
        Ok(Float32Array::from(profile.as_slice()).into())
    }

        #[wasm_bindgen]
    pub fn camera_pos(&self) -> js_sys::Float32Array {
        let (_, cam_pos) = self.get_camera_params("perspective", 1.0);
        js_sys::Float32Array::from(&[cam_pos.x, cam_pos.y, cam_pos.z][..])
    }

    #[wasm_bindgen]
    pub fn camera_distance_top(&self) -> f32 {
        self.camera_ctrl.distance_top
    }

    #[wasm_bindgen]
    pub fn camera_distance_side(&self) -> f32 {
        self.camera_ctrl.distance_side
    }

    #[wasm_bindgen]
    pub fn camera_distance_profile(&self) -> f32 {
        self.camera_ctrl.distance_profile
    }

    #[wasm_bindgen]
    pub fn camera_distance_persp(&self) -> f32 {
        self.camera_ctrl.distance_persp
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
        #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen]
        pub fn unproject_to_plane(
        &self,
        quad: &str,
        ndc_x: f32,
        ndc_y: f32,
        aspect: f32,
        orig_x: f32,
        orig_y: f32,
        orig_z: f32,
    ) -> js_sys::Float32Array {
        let (view_proj, cam_pos) = self.get_camera_params(quad, aspect);
        let inv_vp = view_proj.inverse();

        let ndc_near = glam::Vec4::new(ndc_x, ndc_y, 0.1, 1.0);
        let ndc_far = glam::Vec4::new(ndc_x, ndc_y, 0.9, 1.0);

        let world_near = inv_vp * ndc_near;
        let world_far = inv_vp * ndc_far;

        let ro = world_near.truncate() / world_near.w;
        let rf = world_far.truncate() / world_far.w;
        let rd = (rf - ro).normalize();

        let orig_world = glam::Vec3::new(
            orig_x * (1.0 / 12.0),
            orig_y * (1.0 / 12.0),
            orig_z * (1.0 / 12.0),
        );

                let n = if quad == "top" {
            glam::Vec3::Y
        } else if quad == "side" {
            glam::Vec3::X
        } else if quad == "profile" {
            glam::Vec3::Z
        } else {
            (cam_pos - self.camera_ctrl.target).normalize()
        };

        let denom = n.dot(rd);
        let mut res = [orig_x, orig_y, orig_z];

        if denom.abs() > 1e-6 {
            let t = (orig_world - ro).dot(n) / denom;
            let hit = ro + rd * t;
            res[0] = hit.x * 12.0;
            res[1] = hit.y * 12.0;
            res[2] = hit.z * 12.0;
        }

        js_sys::Float32Array::from(&res[..])
    }

    #[wasm_bindgen]
        #[wasm_bindgen]
        pub fn project_to_screen(
        &self,
        quad: &str,
        x: f32,
        y: f32,
        z: f32,
        aspect: f32,
    ) -> js_sys::Float32Array {
        let (view_proj, _) = self.get_camera_params(quad, aspect);
        let clip =
            view_proj * glam::Vec4::new(x * (1.0 / 12.0), y * (1.0 / 12.0), z * (1.0 / 12.0), 1.0);
        let mut res = [0.0, 0.0, 2.0];
        if clip.w > 0.0 {
            res[0] = clip.x / clip.w;
            res[1] = clip.y / clip.w;
            res[2] = clip.z / clip.w;
        }
        js_sys::Float32Array::from(&res[..])
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

#[wasm_bindgen]
pub struct WgpuRenderer(RenderState);

#[wasm_bindgen]
#[allow(unused_variables)]
pub async fn create_wgpu_renderer(
    canvas: OffscreenCanvas,
    width: u32,
    height: u32,
) -> Result<WgpuRenderer, JsValue> {
    #[cfg(target_arch = "wasm32")]
    {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::GL,
            ..Default::default()
        });
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| JsValue::from_str("Failed to request WGPU adapter. WebGL/WebGPU may be unsupported or disabled in this environment."))?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: None,
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
                },
                None,
            )
            .await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut config = surface
            .get_default_config(&adapter, width.max(1), height.max(1))
            .ok_or_else(|| JsValue::from_str("Failed to get surface default config"))?;

        config.width = width.max(1);
        config.height = height.max(1);
        surface.configure(&device, &config);

        let shader_src = r#"
                        struct CameraUniform {
                view_proj: mat4x4<f32>,
                camera_pos: vec4<f32>,
                display_settings: vec4<f32>,
            };
            @group(0) @binding(0)
            var<uniform> camera: CameraUniform;

            struct VertexOutput {
                @builtin(position) clip_position: vec4<f32>,
                @location(0) color: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) world_pos: vec3<f32>,
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
                out.world_pos = position;
                out.clip_position = camera.view_proj * vec4<f32>(position, 1.0);
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let show_heatmap = camera.display_settings.x > 0.5;
                let show_zebra = camera.display_settings.y > 0.5;
                let show_mri = camera.display_settings.z > 0.5;
                let mri_z = camera.display_settings.w;

                if (show_mri) {
                    let dist = abs(in.world_pos.z - mri_z);
                    if (dist > 0.05) {
                        discard;
                    }
                }

                let normal = normalize(in.normal);
                let view_dir = normalize(camera.camera_pos.xyz - in.world_pos);

                if (show_zebra) {
                    let reflection = reflect(-view_dir, normal);
                    let stripe = fract(reflection.y * 10.0);
                    let intensity = smoothstep(0.4, 0.6, stripe);
                    return vec4<f32>(vec3<f32>(intensity), 1.0);
                } else if (show_heatmap) {
                    let light_dir = normalize(vec3<f32>(1.0, 2.0, 3.0));
                    let ambient = 0.3;
                    let diffuse = max(dot(normal, light_dir), 0.0) * 0.7;
                    return vec4<f32>(in.color * (ambient + diffuse), 1.0);
                } else {
                    let light_dir = normalize(vec3<f32>(1.0, 2.0, 3.0));
                    let ambient = 0.5;
                    let diffuse = max(dot(normal, light_dir), 0.0) * 0.5;
                    let base_color = vec3<f32>(0.9, 0.9, 0.9);
                    return vec4<f32>(base_color * (ambient + diffuse), 1.0);
                }
            }
        "#;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Shader"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        let camera_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
                label: Some("camera_bind_group_layout"),
            });

        let mut camera_buffers = Vec::new();
        let mut camera_bind_groups = Vec::new();
        for i in 0..4 {
            let buf = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("Camera Buffer {}", i)),
                size: 96,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
                layout: &camera_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buf.as_entire_binding(),
                }],
                label: Some(&format!("Camera Bind Group {}", i)),
            });
            camera_buffers.push(buf);
            camera_bind_groups.push(bg);
        }

        let render_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Render Pipeline Layout"),
                bind_group_layouts: &[&camera_bind_group_layout],
                push_constant_ranges: &[],
            });

        let line_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Line Shader"),
            source: wgpu::ShaderSource::Wgsl(
                r#"
                                struct CameraUniform {
                    view_proj: mat4x4<f32>,
                    camera_pos: vec4<f32>,
                    display_settings: vec4<f32>,
                };
                @group(0) @binding(0)
                var<uniform> camera: CameraUniform;

                struct VertexOutput {
                    @builtin(position) clip_position: vec4<f32>,
                    @location(0) color: vec3<f32>,
                };

                @vertex
                fn vs_main(
                    @location(0) position: vec3<f32>,
                    @location(1) color: vec3<f32>,
                ) -> VertexOutput {
                    var out: VertexOutput;
                    out.color = color;
                    out.clip_position = camera.view_proj * vec4<f32>(position, 1.0);
                    return out;
                }

                @fragment
                fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                    return vec4<f32>(in.color, 1.0);
                }
            "#
                .into(),
            ),
        });

        let line_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Line Pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &line_shader,
                entry_point: "vs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
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
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &line_shader,
                entry_point: "fs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
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
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
        });

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Render Pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: "vs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
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
                compilation_options: wgpu::PipelineCompilationOptions::default(),
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
                bias: wgpu::DepthBiasState {
                    constant: 100,
                    slope_scale: 2.0,
                    clamp: 0.0,
                },
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
                        multiview: None,
        });

        let gizmo_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Gizmo Pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &line_shader,
                entry_point: "vs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
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
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &line_shader,
                entry_point: "fs_main",
                compilation_options: wgpu::PipelineCompilationOptions::default(),
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
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
        });

        let depth_texture = RenderState::create_depth_texture(&device, width, height);
        let msaa_texture = RenderState::create_msaa_texture(&device, &config, width, height);

        let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 4,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let normal_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 4,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let color_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 4,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 4,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

                let mut line_vertex_buffers = Vec::new();
        let mut line_color_buffers = Vec::new();
        let mut gizmo_vertex_buffers = Vec::new();
        let mut gizmo_color_buffers = Vec::new();
        let mut gizmo_index_buffers = Vec::new();
        for _ in 0..4 {
            line_vertex_buffers.push(device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 4,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            line_color_buffers.push(device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 4,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            gizmo_vertex_buffers.push(device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 4,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            gizmo_color_buffers.push(device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 4,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            gizmo_index_buffers.push(device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: 4,
                usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }

        Ok(WgpuRenderer(RenderState {
            line_pipeline,
            line_vertex_buffers,
            line_color_buffers,
            num_line_vertices: [0; 4],
            gizmo_pipeline,
            gizmo_vertex_buffers,
            gizmo_color_buffers,
            gizmo_index_buffers,
            num_gizmo_indices: [0; 4],
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
            camera_buffers,
            camera_bind_groups,
            depth_texture,
            msaa_texture,
        }))
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        Err(JsValue::from_str("Not supported on this architecture"))
    }
}
