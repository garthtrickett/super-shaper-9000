import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BoardModel } from "../../pages/board-builder-page.logic";

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

  constructor(
    private host: HTMLElement,
    private canvas: HTMLCanvasElement,
    private cameras: {
      perspective: THREE.PerspectiveCamera;
      top: THREE.OrthographicCamera;
      side: THREE.OrthographicCamera;
      profile: THREE.OrthographicCamera;
    },
    private controls: {
      perspective: OrbitControls;
      top: OrbitControls;
      side: OrbitControls;
      profile: OrbitControls;
    },
    private gizmoGroup: THREE.Group
  ) {}

  public initialize() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
  }

  public dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
  }

  public setBoardState(state: BoardModel) {
    this.boardState = state;
  }

  public setMaximizedView(view: 'perspective' | 'top' | 'side' | 'profile' | null) {
    this.maximizedView = view;
    if (view) {
      this.controls.perspective.enabled = (view === 'perspective');
      this.controls.top.enabled = (view === 'top');
      this.controls.side.enabled = (view === 'side');
      this.controls.profile.enabled = (view === 'profile');
    }
  }

  private getQuadrantCameraAndMouse = (e: PointerEvent): { camera: THREE.Camera, mouse: THREE.Vector2 } => {
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

  private onPointerDown = (e: PointerEvent) => {
    this.dragStartPos.set(e.clientX, e.clientY);

    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    
    if (this.maximizedView) {
      this.controls.perspective.enabled = (this.maximizedView === 'perspective');
      this.controls.top.enabled = (this.maximizedView === 'top');
      this.controls.side.enabled = (this.maximizedView === 'side');
      this.controls.profile.enabled = (this.maximizedView === 'profile');
    } else {
      this.controls.perspective.enabled = (camera === this.cameras.perspective);
      this.controls.top.enabled = (camera === this.cameras.top);
      this.controls.side.enabled = (camera === this.cameras.side);
      this.controls.profile.enabled = (camera === this.cameras.profile);
    }

    if (this.boardState?.editMode !== 'manual' || this.boardState?.showGizmos === false) return;

    this.mouse.copy(mouse);
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.layers.mask = camera.layers.mask;
    
    const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
    const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isGizmo);

    if (hit) {
      this.draggedGizmo = hit.object as THREE.Mesh;
      this.activeDragCamera = camera;
      
      this.controls.perspective.enabled = false;
      this.controls.top.enabled = false;
      this.controls.side.enabled = false;
      this.controls.profile.enabled = false;
      
      const curveName = this.draggedGizmo.userData.curve as string;
      const worldNormal = new THREE.Vector3();
      
      if (curveName === 'outline') {
          worldNormal.set(0, 1, 0).transformDirection(this.draggedGizmo.parent!.matrixWorld);
      }
      else if (curveName.startsWith('rocker')) {
          worldNormal.set(1, 0, 0).transformDirection(this.draggedGizmo.parent!.matrixWorld);
      }
      else if (curveName.startsWith('crossSection')) {
          worldNormal.set(0, 0, 1).transformDirection(this.draggedGizmo.parent!.matrixWorld);
      }
      else {
          camera.getWorldDirection(worldNormal).negate();
      }
      
      const worldPos = new THREE.Vector3();
      this.draggedGizmo.getWorldPosition(worldPos);
      
      this.dragPlane.setFromNormalAndCoplanarPoint(worldNormal, worldPos);
      
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragOffset)) {
        this.dragOffset.sub(worldPos);
      }
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    // Dynamically update active viewport controls on hover, but only if not actively dragging/clicking
    if (e.buttons === 0 && !this.draggedGizmo) {
      if (!this.maximizedView) {
        const { camera } = this.getQuadrantCameraAndMouse(e);
        if (this.controls.perspective.enabled !== (camera === this.cameras.perspective)) {
          this.controls.perspective.enabled = (camera === this.cameras.perspective);
          this.controls.top.enabled = (camera === this.cameras.top);
          this.controls.side.enabled = (camera === this.cameras.side);
          this.controls.profile.enabled = (camera === this.cameras.profile);
        }
      }
    }

    if (!this.draggedGizmo || !this.activeDragCamera) return;
    
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
      
      // Convert world target back to local coordinates so the UI updates correctly
      this.draggedGizmo.parent!.worldToLocal(target);
      
      const inInches = target.clone().multiplyScalar(12);

      const userData = this.draggedGizmo.userData as { curve: string; index: number; maxIndex: number; origZ: number; };
      const curveName = userData.curve;
      const isEndNode = userData.index === 0 || userData.index === userData.maxIndex;

      if (curveName === 'outline') inInches.y = 0;
      if (curveName === 'rockerTop' || curveName === 'rockerBottom') inInches.x = 0;
      if (curveName.startsWith('crossSection_')) inInches.z = userData.origZ;
      if ((curveName === 'rockerTop' || curveName === 'rockerBottom') && isEndNode) inInches.x = 0;

      target.copy(inInches).multiplyScalar(1/12);
      this.draggedGizmo.position.copy(target);
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const dist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);

    if (this.draggedGizmo) {
      if (dist >= 5) {
        const finalPosInches = this.draggedGizmo.position.clone().multiplyScalar(12);
        this.host.dispatchEvent(new CustomEvent('gizmo-dragged', {
          detail: {
            userData: this.draggedGizmo.userData,
            position: [finalPosInches.x, finalPosInches.y, finalPosInches.z]
          },
          bubbles: true, composed: true
        }));
        this.host.dispatchEvent(new CustomEvent('gizmo-drag-ended', { bubbles: true, composed: true }));
      }
      this.draggedGizmo = null;
      this.activeDragCamera = null;
    }
    
    if (this.maximizedView) {
      this.controls.perspective.enabled = (this.maximizedView === 'perspective');
      this.controls.top.enabled = (this.maximizedView === 'top');
      this.controls.side.enabled = (this.maximizedView === 'side');
      this.controls.profile.enabled = (this.maximizedView === 'profile');
    } else {
      const { camera } = this.getQuadrantCameraAndMouse(e);
      this.controls.perspective.enabled = (camera === this.cameras.perspective);
      this.controls.top.enabled = (camera === this.cameras.top);
      this.controls.side.enabled = (camera === this.cameras.side);
      this.controls.profile.enabled = (camera === this.cameras.profile);
    }

    if (dist < 5) {
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
