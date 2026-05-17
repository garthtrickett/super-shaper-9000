import * as THREE from "three";
import { BoardModel } from "../../pages/board-builder-page.logic";
import { ViewportId } from "../board-viewport";

export class InteractionManager {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private dragging = false;

  constructor(
    private element: HTMLElement,
    private canvas: HTMLCanvasElement,
    private cameras: Record<ViewportId, THREE.Camera>,
    private controls: any,
    private gizmoGroup: THREE.Group,
    private wireframeGroup: THREE.Group,
    private sliceLinesGroup: THREE.Group
  ) {}

  initialize() {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  setBoardState(state: BoardModel) {}
  setMaximizedView(view: ViewportId | null) {}
  isDragging() { return this.dragging; }

  private onPointerDown = (e: PointerEvent) => {};
  private onPointerMove = (e: PointerEvent) => {};
  private onPointerUp = (e: PointerEvent) => { this.dragging = false; };
}
