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
            self.queue
                .write_buffer(&self.gizmo_vertex_buffers[idx], 0, tri_verts);
            self.queue
                .write_buffer(&self.gizmo_color_buffers[idx], 0, tri_cols);
            self.queue
                .write_buffer(&self.gizmo_index_buffers[idx], 0, tri_idxs);
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
    is_flipped: bool,
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
            is_flipped: false,
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
                if self.is_flipped {
                    self.yaw += dx * 0.01;
                    self.pitch -= dy * 0.01;
                } else {
                    self.yaw -= dx * 0.01;
                    self.pitch += dy * 0.01;
                }
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

#[derive(Clone, Copy, Debug, PartialEq)]
struct ViewportCameraParams {
    yaw: f32,
    pitch: f32,
    distance: f32,
    target: glam::Vec3,
    pan: (f32, f32),
    is_flipped: bool,
    is_ortho: bool,
    aspect: f32,
    bbox_min: glam::Vec3,
    bbox_max: glam::Vec3,
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
    hover_z: Option<f32>,
    bbox_cache: std::sync::Mutex<[Option<[glam::Vec3; 2]>; 4]>,
    cached_cam_params: std::sync::Mutex<[Option<ViewportCameraParams>; 4]>,
    cached_view_projs: std::sync::Mutex<[Option<(glam::Mat4, glam::Vec3)>; 4]>,
    cached_inv_view_projs: std::sync::Mutex<[Option<glam::Mat4>; 4]>,
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn viewport_index(quad: &str) -> Option<usize> {
    match quad {
        "top" => Some(0),
        "perspective" => Some(1),
        "side" => Some(2),
        "profile" => Some(3),
        _ => None,
    }
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            console_error_panic_hook::set_once();
            let _ = console_log::init_with_level(log::Level::Info);
        }
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
            line_masks: [0x7FF, 0x7FF, 0x7FF, 0x7FF],
            gizmo_masks: [0x7FF, 0x7FF, 0x7FF, 0x7FF],
            show_solid_mesh: true,
            hover_z: None,
            bbox_cache: std::sync::Mutex::new([None; 4]),
            cached_cam_params: std::sync::Mutex::new([None; 4]),
            cached_view_projs: std::sync::Mutex::new([None; 4]),
            cached_inv_view_projs: std::sync::Mutex::new([None; 4]),
        }
    }

    fn invalidate_bbox_cache(&self) {
        if let Ok(mut cache) = self.bbox_cache.lock() {
            *cache = [None; 4];
        }
        if let Ok(mut cache) = self.cached_cam_params.lock() {
            *cache = [None; 4];
        }
        if let Ok(mut cache) = self.cached_view_projs.lock() {
            *cache = [None; 4];
        }
        if let Ok(mut cache) = self.cached_inv_view_projs.lock() {
            *cache = [None; 4];
        }
    }

    fn invalidate_bbox_cache_for_quad(&self, quad: &str) {
        if let Some(idx) = viewport_index(quad) {
            if let Ok(mut cache) = self.bbox_cache.lock() {
                cache[idx] = None;
            }
            if let Ok(mut cache) = self.cached_cam_params.lock() {
                cache[idx] = None;
            }
            if let Ok(mut cache) = self.cached_view_projs.lock() {
                cache[idx] = None;
            }
            if let Ok(mut cache) = self.cached_inv_view_projs.lock() {
                cache[idx] = None;
            }
        }
    }

    fn get_current_viewport_camera_params(&self, quad: &str, aspect: f32) -> ViewportCameraParams {
        let (min_pt, max_pt) = self.get_view_bounding_box(quad);
        let ctrl = &self.camera_ctrl;
        match quad {
            "top" => ViewportCameraParams {
                yaw: 0.0,
                pitch: 0.0,
                distance: ctrl.distance_top,
                target: ctrl.target,
                pan: ctrl.pan_top,
                is_flipped: ctrl.is_flipped,
                is_ortho: true,
                aspect,
                bbox_min: min_pt,
                bbox_max: max_pt,
            },
            "side" => ViewportCameraParams {
                yaw: 0.0,
                pitch: 0.0,
                distance: ctrl.distance_side,
                target: ctrl.target,
                pan: ctrl.pan_side,
                is_flipped: ctrl.is_flipped,
                is_ortho: true,
                aspect,
                bbox_min: min_pt,
                bbox_max: max_pt,
            },
            "profile" => ViewportCameraParams {
                yaw: 0.0,
                pitch: 0.0,
                distance: ctrl.distance_profile,
                target: ctrl.target,
                pan: ctrl.pan_profile,
                is_flipped: ctrl.is_flipped,
                is_ortho: true,
                aspect,
                bbox_min: min_pt,
                bbox_max: max_pt,
            },
            _ => ViewportCameraParams {
                yaw: ctrl.yaw,
                pitch: ctrl.pitch,
                distance: ctrl.distance_persp,
                target: ctrl.target,
                pan: (0.0, 0.0),
                is_flipped: ctrl.is_flipped,
                is_ortho: self.is_ortho,
                aspect,
                bbox_min: min_pt,
                bbox_max: max_pt,
            },
        }
    }

    fn get_view_bounding_box(&self, quad: &str) -> (glam::Vec3, glam::Vec3) {
        if let Some(idx) = viewport_index(quad) {
            if let Ok(cache) = self.bbox_cache.lock() {
                if let Some([min_pt, max_pt]) = cache[idx] {
                    return (min_pt, max_pt);
                }
            }
        }

        let model = self.engine.get_model();

        let mut min_pt = glam::Vec3::splat(f32::INFINITY);
        let mut max_pt = glam::Vec3::splat(f32::NEG_INFINITY);

        let mut add_curve = |c_opt: &Option<surfer_core::model::BezierCurveData>,
                             mirror_x: bool| {
            if let Some(c) = c_opt {
                if c.control_points.is_empty() {
                    return;
                }
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

        if min_pt.x.is_infinite() {
            min_pt.x = -10.0;
            max_pt.x = 10.0;
        }
        if min_pt.y.is_infinite() {
            min_pt.y = -2.0;
            max_pt.y = 2.0;
        }
        if min_pt.z.is_infinite() {
            min_pt.z = 0.0;
            max_pt.z = 70.0;
        }

        if let Some(idx) = viewport_index(quad) {
            if let Ok(mut cache) = self.bbox_cache.lock() {
                cache[idx] = Some([min_pt, max_pt]);
            }
        }

        (min_pt, max_pt)
    }

    fn get_camera_params(&self, quad: &str, aspect: f32) -> (glam::Mat4, glam::Vec3) {
        let current_params = self.get_current_viewport_camera_params(quad, aspect);
        if let Some(idx) = viewport_index(quad) {
            if let Ok(cache_params) = self.cached_cam_params.lock() {
                if cache_params[idx] == Some(current_params) {
                    if let Ok(cache_vp) = self.cached_view_projs.lock() {
                        if let Some(vp) = cache_vp[idx] {
                            return vp;
                        }
                    }
                }
            }
        }

        let (view_proj, cam_pos) = self.compute_camera_params(quad, aspect);

        if let Some(idx) = viewport_index(quad) {
            if let Ok(mut cache_params) = self.cached_cam_params.lock() {
                if let Ok(mut cache_vp) = self.cached_view_projs.lock() {
                    if let Ok(mut cache_inv) = self.cached_inv_view_projs.lock() {
                        cache_params[idx] = Some(current_params);
                        cache_vp[idx] = Some((view_proj, cam_pos));
                        cache_inv[idx] = Some(view_proj.inverse());
                    }
                }
            }
        }

        (view_proj, cam_pos)
    }

    fn compute_camera_params(&self, quad: &str, aspect: f32) -> (glam::Mat4, glam::Vec3) {
        let (min_pt, max_pt) = self.get_view_bounding_box(quad);
        let model = self.engine.get_model();

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
                let target = glam::Vec3::new(
                    self.camera_ctrl.pan_top.0,
                    0.0,
                    center_z + self.camera_ctrl.pan_top.1,
                );
                let cam_pos = target + glam::Vec3::new(0.0, 10.0, 0.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::new(-1.0, 0.0, 0.0));
                let proj = glam::Mat4::orthographic_rh(
                    -frustum * aspect,
                    frustum * aspect,
                    -frustum,
                    frustum,
                    0.1,
                    1000.0,
                );
                (proj * view, cam_pos)
            }
            "side" => {
                let stretch_y = 1.0;
                let base_frustum_half =
                    (size_z * 1.1 / (2.0 * aspect)).max(size_y * 1.5 * stretch_y / 2.0);
                let frustum_half = base_frustum_half * self.camera_ctrl.distance_side;
                let ortho_right = frustum_half * aspect;
                let ortho_top = frustum_half / stretch_y;
                let target = glam::Vec3::new(
                    0.0,
                    center_y + self.camera_ctrl.pan_side.1,
                    center_z + self.camera_ctrl.pan_side.0,
                );
                let cam_pos = target + glam::Vec3::new(-10.0, 0.0, 0.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                let proj = glam::Mat4::orthographic_rh(
                    -ortho_right,
                    ortho_right,
                    -ortho_top,
                    ortho_top,
                    0.1,
                    1000.0,
                );
                (proj * view, cam_pos)
            }
            "profile" => {
                // Reduced padding multiplier from 1.5 to 1.1 (width) and 1.2 (height)
                let base_frustum = (size_x * 1.1 / (2.0 * aspect)).max(size_y * 1.2 / 2.0);
                let frustum = base_frustum * self.camera_ctrl.distance_profile;

                let target_z = if let Some(cs) = model.cross_sections.get(self.active_profile_slice)
                {
                    cs.control_points.first().map(|p| p.z).unwrap_or(0.0) * scale
                } else {
                    center_z
                };

                // Lock X target to 0.0 (Stringer)
                let target = glam::Vec3::new(
                    self.camera_ctrl.pan_profile.0,
                    center_y + self.camera_ctrl.pan_profile.1,
                    target_z,
                );
                let cam_pos = target + glam::Vec3::new(0.0, 0.0, 1.0);
                let view = glam::Mat4::look_at_rh(cam_pos, target, glam::Vec3::Y);
                let proj = glam::Mat4::orthographic_rh(
                    -frustum * aspect,
                    frustum * aspect,
                    -frustum,
                    frustum,
                    0.9,
                    1.1,
                );
                (proj * view, cam_pos)
            }
            _ => {
                // perspective
                let base_dist = size_z.max(size_x).max(size_y) * 1.3;
                let dist = base_dist * self.camera_ctrl.distance_persp;
                let x = dist * self.camera_ctrl.pitch.cos() * self.camera_ctrl.yaw.sin();
                let y = dist * self.camera_ctrl.pitch.sin();
                let z = dist * self.camera_ctrl.pitch.cos() * self.camera_ctrl.yaw.cos();

                // Keep perspective locked to X=0.0 to pivot cleanly around stringer
                let target = self.camera_ctrl.target + glam::Vec3::new(0.0, center_y, center_z);
                let cam_pos = target + glam::Vec3::new(x, y, z);

                let up = if self.camera_ctrl.is_flipped {
                    glam::Vec3::NEG_Y
                } else {
                    glam::Vec3::Y
                };

                if self.is_ortho {
                    let base_frustum = (size_z * 1.1 / (2.0 * aspect)).max(size_x * 1.2 / 2.0);
                    let frustum = base_frustum * self.camera_ctrl.distance_persp;
                    let view = glam::Mat4::look_at_rh(cam_pos, target, up);
                    let proj = glam::Mat4::orthographic_rh(
                        -frustum * aspect,
                        frustum * aspect,
                        -frustum,
                        frustum,
                        0.1,
                        1000.0,
                    );
                    (proj * view, cam_pos)
                } else {
                    let view = glam::Mat4::look_at_rh(cam_pos, target, up);
                    let proj =
                        glam::Mat4::perspective_rh(45.0_f32.to_radians(), aspect, 0.1, 1000.0);
                    (proj * view, cam_pos)
                }
            }
        }
    }

    fn get_dynamic_gizmo_scale(&self, quad: &str, base_scale: f32) -> f32 {
        let (min_pt, max_pt) = self.get_view_bounding_box(quad);
        let scale = 1.0 / 12.0;
        let size_x = (max_pt.x - min_pt.x).max(0.1) * scale;
        let size_y = (max_pt.y - min_pt.y).max(0.1) * scale;
        let size_z = (max_pt.z - min_pt.z).max(0.1) * scale;

        let zoom = match quad {
            "top" => self.camera_ctrl.distance_top,
            "side" => self.camera_ctrl.distance_side,
            "profile" => self.camera_ctrl.distance_profile,
            _ => self.camera_ctrl.distance_persp,
        };

        let view_size = match quad {
            "top" => size_z.max(size_x),
            "side" => size_z.max(size_y),
            "profile" => size_x.max(size_y),
            _ => size_z.max(size_x).max(size_y),
        };

        // The 0.15 factor ensures the new dynamic scaling feels identical
        // to the old explicit sizes (1.0 for whole board, 0.3 for slices).
        let dynamic_scale = view_size * zoom * 0.15 * base_scale;
        dynamic_scale.clamp(0.005, 5.0)
    }

    fn update_view_lines(&mut self, quad: &str) {
        let idx = match quad {
            "top" => 0,
            "perspective" => 1,
            "side" => 2,
            "profile" => 3,
            _ => return,
        };
        let dynamic_scale = self.get_dynamic_gizmo_scale(quad, self.gizmo_scale[idx]);
        if let Some(renderer) = &mut self.renderer {
            let (lv, lc, tv, tc, ti) = surfer_core::mesh::generate_lines_for_view(
                self.engine.get_model(),
                quad,
                self.active_profile_slice,
                self.show_tangents[idx],
                self.line_masks[idx],
                self.gizmo_masks[idx],
                dynamic_scale,
                self.hover_z,
            );
            renderer.update_view_buffers(idx, &lv, &lc, &tv, &tc, &ti);
        }
    }

    fn update_all_views_lines(&mut self) {
        let views = ["top", "perspective", "side", "profile"];
        for view_id in views {
            self.update_view_lines(view_id);
        }
    }

    #[wasm_bindgen]
    pub fn flip_camera(&mut self) {
        self.camera_ctrl.is_flipped = !self.camera_ctrl.is_flipped;
        self.camera_ctrl.pitch = -self.camera_ctrl.pitch;
        self.camera_ctrl.yaw = -self.camera_ctrl.yaw;
    }

    #[wasm_bindgen]
    pub fn set_view_mode(&mut self, mode: &str) {
        self.view_mode = mode.to_string();
    }

    #[wasm_bindgen]
    pub fn set_hover_z(&mut self, z: Option<f32>) {
        self.hover_z = z;
        self.update_view_lines("profile");
        self.update_view_lines("perspective");
    }

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
        self.update_view_lines(quad);
    }

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
        self.update_view_lines(quad);
    }

    #[wasm_bindgen]
    pub fn set_show_solid_mesh(&mut self, show: bool) {
        self.show_solid_mesh = show;
    }

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
        self.update_view_lines(quad);
    }

    #[wasm_bindgen]
    pub fn set_ortho(&mut self, is_ortho: bool) {
        self.is_ortho = is_ortho;
    }

    #[wasm_bindgen]
    #[wasm_bindgen]
    pub fn set_active_profile_slice(&mut self, slice: usize) {
        self.active_profile_slice = slice;
        self.invalidate_bbox_cache_for_quad("profile");
        self.update_view_lines("profile");
        self.update_view_lines("perspective");
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
        self.update_view_lines(quad);
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
        active_quad: &str,
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

        self.update_render_mesh_draft_for_quad(active_quad);
    }

    #[wasm_bindgen]
    #[wasm_bindgen]
    pub fn propose_state_only(&mut self, action_js: JsValue) -> Result<(), JsValue> {
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        if action.is_geometry_altering() {
            self.invalidate_bbox_cache();
        }

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
            vec![
                "top".to_string(),
                "perspective".to_string(),
                "side".to_string(),
                "profile".to_string(),
            ]
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

            let mut uniform_data = [0.0f32; 28];
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
            uniform_data[24] = if model.show_topography.unwrap_or(false) {
                1.0
            } else {
                0.0
            };

            let scale_ft = 1.0 / 12.0;
            let stringer_width = if let Some(stringers) = &model.stringers {
                stringers
                    .first()
                    .map(|s| s.width * scale_ft)
                    .unwrap_or(0.125 * scale_ft)
            } else {
                0.125 * scale_ft
            };
            let stringer_offset = if let Some(stringers) = &model.stringers {
                if stringers.len() > 1 {
                    stringers[1].shift * scale_ft
                } else {
                    0.0
                }
            } else {
                0.0
            };
            uniform_data[25] = stringer_width;
            uniform_data[26] = stringer_offset;

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
                        rpass
                            .set_vertex_buffer(0, renderer.line_vertex_buffers[view_idx].slice(..));
                        rpass.set_vertex_buffer(1, renderer.line_color_buffers[view_idx].slice(..));
                        rpass.draw(0..renderer.num_line_vertices[view_idx], 0..1);
                    }

                    if renderer.num_gizmo_indices[view_idx] > 0 {
                        rpass.set_pipeline(&renderer.gizmo_pipeline);
                        rpass.set_bind_group(0, &renderer.camera_bind_groups[i], &[]);
                        rpass.set_vertex_buffer(
                            0,
                            renderer.gizmo_vertex_buffers[view_idx].slice(..),
                        );
                        rpass
                            .set_vertex_buffer(1, renderer.gizmo_color_buffers[view_idx].slice(..));
                        rpass.set_index_buffer(
                            renderer.gizmo_index_buffers[view_idx].slice(..),
                            wgpu::IndexFormat::Uint32,
                        );
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
    #[wasm_bindgen]
    pub fn propose(&mut self, action_js: JsValue) -> Result<JsValue, JsValue> {
        let action: BoardAction = serde_wasm_bindgen::from_value(action_js)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let is_geo = action.is_geometry_altering();
        if is_geo {
            self.invalidate_bbox_cache();
        }

        let (new_state, effects) = self.engine.update(action);

        if is_geo {
            self.update_render_mesh();
        } else {
            self.update_render_mesh_draft();
        }

        let res = WasmUpdateResult {
            state: &new_state,
            effects: &effects,
        };

        Ok(serde_wasm_bindgen::to_value(&res)?)
    }

    fn update_render_mesh(&mut self) {
        self.invalidate_bbox_cache();
        let mesh = self.engine.compute_mesh();
        self.stats.vertex_count = mesh.vertices.len() / 3;
        self.stats.triangle_count = mesh.indices.len() / 3;
        self.stats.volume_liters = mesh.volume_liters;

        if let Some(renderer) = &mut self.renderer {
            renderer.update_mesh_buffers(&mesh);
            self.update_all_views_lines();
        }
    }

    fn update_render_mesh_draft(&mut self) {
        self.invalidate_bbox_cache();
        if self.renderer.is_some() {
            self.update_all_views_lines();
        }
    }

    fn update_render_mesh_draft_for_quad(&mut self, quad: &str) {
        if viewport_index(quad).is_some() {
            self.invalidate_bbox_cache_for_quad(quad);
            if self.renderer.is_some() {
                self.update_view_lines(quad);
            }
        } else {
            self.invalidate_bbox_cache();
            if self.renderer.is_some() {
                self.update_all_views_lines();
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
        quad: &str,
        rx: f32,
        ry: f32,
        rz: f32,
        dx: f32,
        dy: f32,
        dz: f32,
    ) -> f32 {
        self.engine
            .find_closest_t(curve_name, quad, [rx, ry, rz], [dx, dy, dz])
            .unwrap_or(-1.0)
    }

    #[wasm_bindgen]
    pub fn get_point_on_curve(&self, curve_name: &str, quad: &str, t: f32) -> js_sys::Float32Array {
        if let Some(pt) = self.engine.get_point_on_curve(curve_name, quad, t) {
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
        let current_params = self.get_current_viewport_camera_params(quad, aspect);
        let mut inv_vp = glam::Mat4::IDENTITY;
        let mut cam_pos = glam::Vec3::ZERO;
        let mut found_cache = false;

        if let Some(idx) = viewport_index(quad) {
            if let Ok(cache_params) = self.cached_cam_params.lock() {
                if cache_params[idx] == Some(current_params) {
                    if let Ok(cache_inv) = self.cached_inv_view_projs.lock() {
                        if let Some(inv) = cache_inv[idx] {
                            inv_vp = inv;
                            found_cache = true;
                        }
                    }
                    if let Ok(cache_vp) = self.cached_view_projs.lock() {
                        if let Some((_, pos)) = cache_vp[idx] {
                            cam_pos = pos;
                        }
                    }
                }
            }
        }

        if !found_cache {
            let (view_proj, pos) = self.get_camera_params(quad, aspect);
            inv_vp = view_proj.inverse();
            cam_pos = pos;
        }

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
    pub fn get_surface_y_at(&self, z: f32, _x: f32, is_deck: bool) -> f32 {
        let model = self.engine.get_model();
        let bounds = surfer_core::geometry::get_board_bounds(model);
        let hint_t = ((z - bounds.nose_z) / model.length).clamp(0.0, 1.0);
        if is_deck {
            if let Some(rt) = &model.rocker_top {
                surfer_core::geometry::evaluate_bezier_at_z(rt, z, hint_t).y
            } else {
                0.0
            }
        } else if let Some(rb) = &model.rocker_bottom {
            surfer_core::geometry::evaluate_bezier_at_z(rb, z, hint_t).y
        } else {
            0.0
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bounding_box_cache_hits() {
        let engine = WasmEngine::new();

        // First call: populates cache
        let (min1, max1) = engine.get_view_bounding_box("top");

        // Second call: should hit the cache
        let (min2, max2) = engine.get_view_bounding_box("top");

        assert_eq!(min1, min2);
        assert_eq!(max1, max2);

        // Verify cache contains the value
        if let Ok(cache) = engine.bbox_cache.lock() {
            assert!(cache[0].is_some());
        }

        // Invalidate the cache
        engine.invalidate_bbox_cache();
        if let Ok(cache) = engine.bbox_cache.lock() {
            assert!(cache[0].is_none());
        };
    }

    #[test]
    fn test_matrix_cache_hits_and_invalidation() {
        let engine = WasmEngine::new();

        // Initial call: computes and caches
        let (vp1, pos1) = engine.get_camera_params("top", 1.33);

        // Second call with identical params: hits cache
        let (vp2, pos2) = engine.get_camera_params("top", 1.33);

        assert_eq!(vp1, vp2);
        assert_eq!(pos1, pos2);

        // Verify cache contains the inverse matrix
        if let Ok(cache) = engine.cached_inv_view_projs.lock() {
            assert!(cache[0].is_some());
        }

        // Modify camera parameter on controller (e.g. pan)
        let mut engine_mut = WasmEngine::new();
        let (vp_init, _) = engine_mut.get_camera_params("top", 1.33);
        engine_mut.camera_ctrl.pan_top = (10.0, 5.0);
        let (vp_new, _) = engine_mut.get_camera_params("top", 1.33);

        // Should recalculate due to cache invalidation/mismatch
        assert_ne!(vp_init, vp_new);
    }

    #[test]
    fn test_active_profile_slice_invalidates_cache() {
        let mut engine = WasmEngine::new();

        // Warm up the caches for "profile"
        let _ = engine.get_view_bounding_box("profile");
        let _ = engine.get_camera_params("profile", 1.33);

        // Verify cache is populated
        if let Ok(cache) = engine.bbox_cache.lock() {
            assert!(cache[3].is_some());
        }
        if let Ok(cache) = engine.cached_view_projs.lock() {
            assert!(cache[3].is_some());
        }

                // Change active profile slice
        engine.set_active_profile_slice(1);

        // Verify that the view-projection and camera parameter caches are invalidated (None).
        // Note: bbox_cache[3] is automatically re-populated with the fresh slice bounds
        // during the internal update_view_lines call, so we assert on the matrix and param caches.
        if let Ok(cache) = engine.cached_view_projs.lock() {
            assert!(cache[3].is_none());
        }
        if let Ok(cache) = engine.cached_cam_params.lock() {
            assert!(cache[3].is_none());
        };
    }

    #[test]
    #[cfg(target_arch = "wasm32")]
    fn test_propose_select_node_preserves_caches() {
        let mut engine = WasmEngine::new();

        // Populate caches
        let _ = engine.get_view_bounding_box("top");
        let _ = engine.get_camera_params("top", 1.33);

        // Assert caches are populated
        {
            let cache = engine.bbox_cache.lock().unwrap();
            assert!(cache[0].is_some());
        }
        {
            let cam_cache = engine.cached_cam_params.lock().unwrap();
            assert!(cam_cache[0].is_some());
        }

        // Propose a non-geometry-altering action (SelectNode)
        let action = surfer_core::model::BoardAction::SelectNode { node: None };
        let action_js = serde_wasm_bindgen::to_value(&action).unwrap();
        let _ = engine.propose(action_js).unwrap();

        // Caches must remain populated
        {
            let cache = engine.bbox_cache.lock().unwrap();
            assert!(
                cache[0].is_some(),
                "Bounding box cache was cleared on non-geometric action!"
            );
        }
        {
            let cam_cache = engine.cached_cam_params.lock().unwrap();
            assert!(
                cam_cache[0].is_some(),
                "Camera params cache was cleared on non-geometric action!"
            );
        }
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
                display_settings_2: vec4<f32>,
            };
            @group(0) @binding(0)
            var<uniform> camera: CameraUniform;

            struct VertexOutput {
                @builtin(position) clip_position: vec4<f32>,
                @location(0) custom_data: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) world_pos: vec3<f32>,
            };

            fn hsl_to_rgb(h: f32, s: f32, l: f32) -> vec3<f32> {
                let rgb = clamp(abs(fract(h + vec3<f32>(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
                return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
            }

            @vertex
            fn vs_main(
                @location(0) position: vec3<f32>,
                @location(1) normal: vec3<f32>,
                @location(2) custom_data: vec3<f32>,
            ) -> VertexOutput {
                var out: VertexOutput;
                out.custom_data = custom_data;
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
                let show_topography = camera.display_settings_2.x > 0.5;
                let stringer_width = camera.display_settings_2.y;
                let stringer_offset = camera.display_settings_2.z;

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
                } else {
                    var base_color = vec3<f32>(0.9, 0.9, 0.9);

                    if (show_heatmap) {
                        let hue = (1.0 - in.custom_data.x) * 0.666;
                        base_color = hsl_to_rgb(hue, 1.0, 0.5);
                    } else if (show_topography) {
                        let elev = in.custom_data.y;
                        let t = clamp((elev + 0.25) / 1.75, 0.0, 1.0);
                        let hue = (1.0 - t) * 0.666;
                        base_color = hsl_to_rgb(hue, 0.8, 0.5);
                        
                        let contour_val = elev / 0.125;
                        let f = fract(contour_val);
                        let df = fwidth(contour_val);
                        let line = smoothstep(df, 0.0, f) + smoothstep(1.0 - df, 1.0, f);
                        base_color = mix(base_color, vec3<f32>(0.0, 0.0, 0.0), clamp(line, 0.0, 1.0) * 0.4);
                    }

                    if (!show_heatmap && !show_topography) {
                        let abs_x = abs(in.world_pos.x);
                        let in_center = abs_x < (stringer_width * 0.5);
                        var in_offset = false;
                        if (stringer_offset > 0.0) {
                            let dist_to_offset = abs(abs_x - stringer_offset);
                            in_offset = dist_to_offset < (stringer_width * 0.5);
                        }
                        if (in_center || in_offset) {
                            base_color = vec3<f32>(0.65, 0.45, 0.25);
                        }
                    }

                    // Three-Point Studio Lighting Setup
                    let key_dir = normalize(vec3<f32>(5.0, 5.0, 10.0));
                    let fill_dir = normalize(vec3<f32>(-5.0, -5.0, 10.0));
                    let rim_dir = normalize(vec3<f32>(0.0, 0.0, -10.0));

                    let ambient = 0.2;
                    let key = max(dot(normal, key_dir), 0.0) * 0.6;
                    let fill = max(dot(normal, fill_dir), 0.0) * 0.3;
                    let rim = max(dot(normal, rim_dir), 0.0) * 0.2;
                    
                    let total_light = ambient + key + fill + rim;

                    return vec4<f32>(base_color * total_light, 1.0);
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
                size: 112,
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
                    display_settings_2: vec4<f32>,
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
