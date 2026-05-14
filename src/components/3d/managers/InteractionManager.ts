// File: src/components/3d/managers/InteractionManager.ts
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BoardModel } from "../../pages/board-builder-page.logic";

export interface HostWithPreview extends HTMLElement {
  setHoverPreview(preview: { curve: string, t: number, mirrorX: boolean } | null): void;
  mathEngine?: import("../../../lib/client/wasm/surfer_wasm.js").WasmEngine;
  getZHeight(curveName: string, yInches: number, zInches: number, mathEngine: import("../../../lib/client/wasm/surfer_wasm.js").WasmEngine): number;
  getXOffset(curveName: string, xInches: number, zInches: number, mathEngine: import("../../../lib/client/wasm/surfer_wasm.js").WasmEngine): number;
}

export class InteractionManager {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private draggedGizmo: THREE.Mesh | null = null;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private dragStartPos = new THREE.Vector2();
  private activeDragCamera: THREE.Camera | null = null;
  private boardState?: BoardModel;
  private maximizedView: 'perspective' | 'top' | 'side' | 'profile' | null = null;
    private isPanning = false;
  private panStartPixel = new THREE.Vector2();
  private activePanCamera: THREE.OrthographicCamera | null = null;
  public hoveredCurve: string | null = null;
  public hoveredT: number | null = null;

    constructor(
    private host: HostWithPreview,
    private canvas: HTMLCanvasElement,
        private cameras: {
      perspective: THREE.PerspectiveCamera | THREE.OrthographicCamera;
      top: THREE.OrthographicCamera;
      side: THREE.OrthographicCamera;
      profile: THREE.OrthographicCamera;
    },
    private controls: {
      perspective: OrbitControls;
    },
    private gizmoGroup: THREE.Group,
    private wireframeGroup: THREE.Group
  ) {}

        private onContextMenu = (e: Event) => {
    e.preventDefault();
  }

    public initialize() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  public isDragging(): boolean {
    return this.draggedGizmo !== null;
  }

  public dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }

        private onWheel = (e: WheelEvent) => {
    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    
    if (camera !== this.cameras.perspective) {
      e.preventDefault();
      const orthoCam = camera as THREE.OrthographicCamera;
      
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, orthoCam);
      const preZoomOrigin = raycaster.ray.origin.clone();

      const zoomFactor = Math.pow(0.998, e.deltaY);
      let newZoom = orthoCam.zoom * zoomFactor;
      newZoom = Math.max(0.1, Math.min(newZoom, 50.0));
      
      orthoCam.zoom = newZoom;
      orthoCam.updateProjectionMatrix();

      raycaster.setFromCamera(mouse, orthoCam);
      const postZoomOrigin = raycaster.ray.origin.clone();

      const diff = preZoomOrigin.sub(postZoomOrigin);
      orthoCam.position.add(diff);
    }
  }

  public setBoardState(state: BoardModel) {
    this.boardState = state;
  }

  public setMaximizedView(view: 'perspective' | 'top' | 'side' | 'profile' | null) {
    this.maximizedView = view;
    if (view) {
      this.controls.perspective.enabled = (view === 'perspective');
    }
  }

    private getQuadrantCameraAndMouse = (e: PointerEvent | WheelEvent): { camera: THREE.Camera, mouse: THREE.Vector2 } => {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (this.maximizedView) {
      const camera = this.cameras[this.maximizedView];
      const localX = (x / rect.width) * 2 - 1;
      const localY = -(y / rect.height) * 2 + 1;
      return { camera, mouse: new THREE.Vector2(localX, localY) };
    }

    const w = rect.width / 2;
    const h = rect.height / 2;

    let camera: THREE.Camera;
    let localX: number;
    let localY: number;

    if (x < w && y >= h) { // Bottom Left
        camera = this.cameras.side;
        localX = (x / w) * 2 - 1;
        localY = -((y - h) / (rect.height - h)) * 2 + 1;
    } else if (x >= w && y >= h) { // Bottom Right
        camera = this.cameras.profile;
        localX = ((x - w) / (rect.width - w)) * 2 - 1;
        localY = -((y - h) / (rect.height - h)) * 2 + 1;
    } else if (x < w && y < h) { // Top Left
        camera = this.cameras.top;
        localX = (x / w) * 2 - 1;
        localY = -(y / h) * 2 + 1;
    } else { // Top Right
        camera = this.cameras.perspective;
        localX = ((x - w) / (rect.width - w)) * 2 - 1;
        localY = -(y / h) * 2 + 1;
    }

        return { camera, mouse: new THREE.Vector2(localX, localY) };
  }

  private findCurveAtPointer(e: PointerEvent): { curveName: string, t: number, mirrorX: boolean } | null {
    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    this.mouse.copy(mouse);
        this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.layers.mask = camera.layers.mask;
    this.raycaster.params.Line = { threshold: 1.5 }; 

        const intersects = this.raycaster.intersectObjects(this.wireframeGroup.children, false);

    // In Orthographic views, large Line thresholds cause rays to hit multiple lines.
    // Three.js sorts by Z-depth (distance from camera) by default, meaning higher lines (like deckShoulder)
    // steal the hover from lower lines (like outline). We must sort by the actual radial distanceToRay.
    intersects.sort((a, b) => {
      const distA = a.distanceToRay !== undefined ? a.distanceToRay : a.distance;
      const distB = b.distanceToRay !== undefined ? b.distanceToRay : b.distance;
      return distA - distB;
    });

    const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isCurveLine);

    if (hit) {
        const curveName = hit.object.userData.curve as string;
        const mirrorX = hit.object.userData.mirrorX as boolean;
        const ro = this.raycaster.ray.origin.clone();
        const rd = this.raycaster.ray.direction.clone();
        if (mirrorX) {
            ro.x *= -1;
            rd.x *= -1;
        }
        ro.multiplyScalar(12);

        const mathEngine = this.host.mathEngine;
        if (mathEngine && typeof mathEngine.find_closest_t === 'function') {
            const t = mathEngine.find_closest_t(curveName, ro.x, ro.y, ro.z, rd.x, rd.y, rd.z);
            if (t >= 0 && t <= 1) {
                return { curveName, t, mirrorX };
            }
        }
    }
    return null;
  }

    private onPointerDown = (e: PointerEvent) => {
    const isRightClick = e.button === 2;
    const isAltClick = e.altKey && e.button === 0;

    if ((isRightClick || isAltClick) && this.hoveredCurve && this.hoveredT !== null) {
        this.host.dispatchEvent(new CustomEvent('insert-node', {
            detail: { curve: this.hoveredCurve, t: this.hoveredT },
            bubbles: true, composed: true
        }));
        this.hoveredCurve = null;
        this.hoveredT = null;
        this.host.setHoverPreview(null);
        e.stopPropagation();
        return;
    }

    this.dragStartPos.set(e.clientX, e.clientY);

    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    
    if (this.boardState?.showGizmos !== false) {
      this.mouse.copy(mouse);
      this.raycaster.setFromCamera(this.mouse, camera);
      this.raycaster.layers.mask = camera.layers.mask;
      
      const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
      const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isGizmo);

      if (hit) {
        this.draggedGizmo = hit.object as THREE.Mesh;
        this.activeDragCamera = camera;
        
        this.controls.perspective.enabled = false;
        
        // Calculate a plane facing the camera, which works flawlessly for all orthogonal layouts and is highly intuitive for 3D viewports
        const worldNormal = new THREE.Vector3();
        camera.getWorldDirection(worldNormal).negate();
        
        const worldPos = new THREE.Vector3();
        this.draggedGizmo.getWorldPosition(worldPos);
        
        this.dragPlane.setFromNormalAndCoplanarPoint(worldNormal, worldPos);
        
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragOffset)) {
          this.dragOffset.sub(worldPos);
        }
        return;
      }
    }

    // Handle panning vs orbiting if no gizmo was clicked
    if (camera === this.cameras.perspective) {
        this.controls.perspective.enabled = true;
    } else {
        this.controls.perspective.enabled = false;
        this.isPanning = true;
        this.activePanCamera = camera as THREE.OrthographicCamera;
        this.panStartPixel.set(e.clientX, e.clientY);
    }
  }

    private onPointerMove = (e: PointerEvent) => {
    if (this.isPanning && this.activePanCamera) {
      this.canvas.style.cursor = 'move';
      const dx = e.clientX - this.panStartPixel.x;
      const dy = e.clientY - this.panStartPixel.y;
      this.panStartPixel.set(e.clientX, e.clientY);

      const vpWidth = this.maximizedView ? this.canvas.clientWidth : this.canvas.clientWidth / 2;
      const vpHeight = this.maximizedView ? this.canvas.clientHeight : this.canvas.clientHeight / 2;

      const worldWidth = (this.activePanCamera.right - this.activePanCamera.left) / this.activePanCamera.zoom;
      const worldHeight = (this.activePanCamera.top - this.activePanCamera.bottom) / this.activePanCamera.zoom;

      const deltaXWorld = -(dx / vpWidth) * worldWidth;
      const deltaYWorld = (dy / vpHeight) * worldHeight;

      this.activePanCamera.translateX(deltaXWorld);
      this.activePanCamera.translateY(deltaYWorld);
      return;
    }

    if (this.draggedGizmo && this.activeDragCamera) {
      this.canvas.style.cursor = 'grabbing';
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (this.maximizedView) {
        this.mouse.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
      } else {
        const w = rect.width / 2;
        const h = rect.height / 2;
        
        if (this.activeDragCamera === this.cameras.top) this.mouse.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
        else if (this.activeDragCamera === this.cameras.perspective) this.mouse.set(((x - w) / (rect.width - w)) * 2 - 1, -(y / h) * 2 + 1);
        else if (this.activeDragCamera === this.cameras.side) this.mouse.set((x / w) * 2 - 1, -((y - h) / (rect.height - h)) * 2 + 1);
        else this.mouse.set(((x - w) / (rect.width - w)) * 2 - 1, -((y - h) / (rect.height - h)) * 2 + 1);
      }

      this.raycaster.setFromCamera(this.mouse, this.activeDragCamera);
      const target = new THREE.Vector3();
      
      if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
        target.sub(this.dragOffset);
        
        this.draggedGizmo.parent!.worldToLocal(target);
        
        const rawInches = target.clone().multiplyScalar(12);
        const stateInches = rawInches.clone();

        const userData = this.draggedGizmo.userData as { type: 'anchor' | 'tangent1' | 'tangent2'; curve: string; index: number; maxIndex: number; origZ: number; };
        const curveName = userData.curve;
        const isEndNode = userData.index === 0 || userData.index === userData.maxIndex;

        if (isEndNode && userData.type === "anchor") {
          if (curveName.startsWith('crossSection_') || curveName === 'outline' || curveName === 'apexOutline' || curveName === 'railOutline') {
            stateInches.x = 0;
          }
        }
        if (userData.type === "anchor" && (curveName === 'outline' || curveName === 'apexOutline' || curveName === 'railOutline' || curveName.startsWith('crossSection_') || curveName.startsWith('outlineLayer_'))) {
          if (stateInches.x < 0) stateInches.x = 0;
        }

                target.copy(stateInches).multiplyScalar(1/12);
        
        this.draggedGizmo.position.copy(target);

        this.host.dispatchEvent(new CustomEvent('gizmo-dragging', {
          detail: {
            userData: this.draggedGizmo.userData,
            position: [stateInches.x, stateInches.y, stateInches.z]
          },
          bubbles: true, composed: true
        }));
      }
      return;
    }

    // Hover logic (not panning, not dragging)
    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    this.mouse.copy(mouse);
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.layers.mask = camera.layers.mask;

    const gizmoHits = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
    const gizmoHit = gizmoHits.find((i: THREE.Intersection) => i.object.userData?.isGizmo);

    if (gizmoHit) {
      this.canvas.style.cursor = 'grab';
      if (this.hoveredCurve) {
        this.hoveredCurve = null;
        this.hoveredT = null;
        this.host.setHoverPreview(null);
      }
    } else {
      const hit = this.findCurveAtPointer(e);
      if (hit) {
        this.canvas.style.cursor = 'copy'; // 'copy' cursor indicates "add" or "insert"
        this.hoveredCurve = hit.curveName;
        this.hoveredT = hit.t;
        this.host.setHoverPreview({ curve: hit.curveName, t: hit.t, mirrorX: hit.mirrorX });
      } else {
        this.canvas.style.cursor = 'default';
        if (this.hoveredCurve) {
          this.hoveredCurve = null;
          this.hoveredT = null;
          this.host.setHoverPreview(null);
        }
      }
    }
  }

    private onPointerUp = (e: PointerEvent) => {
    const dist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);

    if (this.isPanning) {
      this.isPanning = false;
      this.activePanCamera = null;
      this.canvas.style.cursor = 'default';
    }

    if (this.draggedGizmo) {
      if (dist >= 5) {
        const finalPosInches = this.draggedGizmo.position.clone().multiplyScalar(12);
        this.host.dispatchEvent(new CustomEvent('gizmo-dragged', {
          detail: {
            userData: this.draggedGizmo.userData,
            position:[finalPosInches.x, finalPosInches.y, finalPosInches.z]
          },
          bubbles: true, composed: true
        }));
        this.host.dispatchEvent(new CustomEvent('gizmo-drag-ended', { bubbles: true, composed: true }));
      }
      this.draggedGizmo = null;
      this.activeDragCamera = null;
      this.canvas.style.cursor = 'default';
    }
    
        if (dist < 5 && e.button === 0 && !e.altKey) {
      const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
      this.mouse.copy(mouse);
      this.raycaster.setFromCamera(this.mouse, camera);
      this.raycaster.layers.mask = camera.layers.mask;
      
      const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
      const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isGizmo);
      
      this.host.dispatchEvent(new CustomEvent('node-selected', {
        detail: { node: hit ? hit.object.userData : null },
        bubbles: true, composed: true
      }));
    }
  };
}
