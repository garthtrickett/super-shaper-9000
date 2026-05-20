// File: src/components/3d/board-viewport.ts
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { BoardModel } from "../pages/board-builder-page.logic";
import type { WasmEngine } from "../../lib/client/wasm/surfer_wasm.js";

export type ViewportId = 'perspective' | 'top' | 'side' | 'profile';

export interface RustMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  volumeLiters: number;
  vertexCount: number;
  triangleCount: number;
}

@customElement("board-viewport")
export class BoardViewport extends LitElement {
  @property({ type: Object }) boardState?: BoardModel;
  @property({ type: Object }) meshData?: RustMesh;
  @property({ attribute: false }) mathEngine?: WasmEngine;
  @property({ type: String }) selectedNodeContinuity: "G0" | "G1" | "G2" = "G1";
  @property({ type: Boolean }) isProcessing = false;
  
  protected override createRenderRoot() { return this; }

  @query("#wgpu-canvas") private wgpuCanvas!: HTMLCanvasElement;
  
  @state() private maximizedView: ViewportId | null = null;
  @state() private isFlipped = false;
    @state() private isOrtho = false;
      @state() private activeProfileSlice = 0;
    @state() private showTangents: Record<ViewportId, boolean> = { perspective: true, top: true, side: true, profile: true };
  @state() private showGizmos: Record<ViewportId, boolean> = { perspective: true, top: true, side: true, profile: true };
  @state() private showSolidMesh: boolean = true;
  @state() private gizmoScale: Record<ViewportId, number> = { perspective: 1.0, top: 1.0, side: 0.5, profile: 0.3 };
    @state() private showSettings: Record<ViewportId, boolean> = { perspective: false, top: false, side: false, profile: false };
  @state() private hoverInsertPoint: { left: number, top: number } | null = null;

  private ro?: ResizeObserver;
  
    override firstUpdated() {
        const views: ViewportId[] = ['top', 'perspective', 'side', 'profile'];
    views.forEach(v => {
        const savedScale = localStorage.getItem(`gizmoScale_${v}`);
        if (savedScale) this.gizmoScale[v] = parseFloat(savedScale);

        const savedTan = localStorage.getItem(`showTangents_${v}`);
        if (savedTan) this.showTangents[v] = savedTan === 'true';

        const savedGizmos = localStorage.getItem(`showGizmos_${v}`);
        if (savedGizmos) this.showGizmos[v] = savedGizmos === 'true';
    });
    
    const savedSolid = localStorage.getItem(`showSolidMesh`);
    if (savedSolid) this.showSolidMesh = savedSolid === 'true';

    // Dispatch initial state to WASM worker immediately so the first render is correct
    views.forEach(v => {
        this.dispatchEvent(new CustomEvent('set-gizmo-scale', { detail: { quad: v, scale: this.gizmoScale[v] }, bubbles: true, composed: true }));
        this.dispatchEvent(new CustomEvent('set-show-tangents', { detail: { quad: v, show: this.showTangents[v] }, bubbles: true, composed: true }));
        this.dispatchEvent(new CustomEvent('set-show-gizmos', { detail: { quad: v, show: this.showGizmos[v] }, bubbles: true, composed: true }));
    });
    this.dispatchEvent(new CustomEvent('set-show-solid-mesh', { detail: { show: this.showSolidMesh }, bubbles: true, composed: true }));

    const offscreen = this.wgpuCanvas.transferControlToOffscreen();
    this.dispatchEvent(new CustomEvent('init-renderer', {
        detail: { canvas: offscreen, width: this.wgpuCanvas.clientWidth, height: this.wgpuCanvas.clientHeight },
        bubbles: true,
        composed: true
    }));

    this.ro = new ResizeObserver(() => {
        this.dispatchEvent(new CustomEvent('resize-renderer', {
            detail: { width: this.wgpuCanvas.clientWidth, height: this.wgpuCanvas.clientHeight },
            bubbles: true,
            composed: true
        }));
    });
    this.ro.observe(this.wgpuCanvas);

                        this.wgpuCanvas.addEventListener("pointerdown", this.handlePointerDown);
    this.wgpuCanvas.addEventListener("pointermove", this.handlePointerMove);
    this.wgpuCanvas.addEventListener("pointerup", this.handlePointerUp);
    this.wgpuCanvas.addEventListener("pointercancel", this.handlePointerUp);
    this.wgpuCanvas.addEventListener("pointerleave", () => {
        this.hoverInsertPoint = null;
        this.wgpuCanvas.style.cursor = 'default';
    });
        this.wgpuCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.wgpuCanvas.getBoundingClientRect();
      const w = rect.width / 2;
      const h = rect.height / 2;
      const ndcX = ((e.clientX - rect.left) / w) - 1.0;
      const ndcY = 1.0 - ((e.clientY - rect.top) / h);
      
      let quad = "perspective";
      if (this.maximizedView) {
        quad = this.maximizedView;
      } else {
        if (ndcX < 0 && ndcY > 0) quad = "top";
        else if (ndcX >= 0 && ndcY > 0) quad = "perspective";
        else if (ndcX < 0 && ndcY <= 0) quad = "side";
        else if (ndcX >= 0 && ndcY <= 0) quad = "profile";
      }

      this.dispatchEvent(new CustomEvent('viewport-wheel', {
        detail: { dy: e.deltaY, quad },
        bubbles: true,
        composed: true
      }));
    }, { passive: false });
  }

    private _lastDispatchedSlice = -1;

  override updated() {
    const prevSlice = this.activeProfileSlice;
    if (this.boardState?.selectedNode?.curve.startsWith('crossSection_')) {
        const idx = parseInt(this.boardState.selectedNode.curve.split('_')[1] || "0", 10);
        if (!isNaN(idx)) {
            this.activeProfileSlice = idx;
        }
    }
    if (this.boardState?.crossSections && this.activeProfileSlice >= this.boardState.crossSections.length) {
        this.activeProfileSlice = Math.max(0, this.boardState.crossSections.length - 1);
    }
    if (prevSlice !== this.activeProfileSlice) {
        this.requestUpdate();
    }
    
    if (this.activeProfileSlice !== this._lastDispatchedSlice) {
        this._lastDispatchedSlice = this.activeProfileSlice;
        this.dispatchEvent(new CustomEvent('set-active-profile-slice', { detail: { slice: this.activeProfileSlice }, bubbles: true, composed: true }));
    }
  }

  override disconnectedCallback() {
    this.ro?.disconnect();
    super.disconnectedCallback();
  }


    private toggleMaximize(view: ViewportId | null) {
    this.maximizedView = view;
    this.dispatchEvent(new CustomEvent('set-view-mode', {
        detail: { mode: view || "quad" },
        bubbles: true,
        composed: true
    }));
  }

  private toggleFlip = () => {
    this.isFlipped = !this.isFlipped;
  };

        private toggleOrtho = () => {
    this.isOrtho = !this.isOrtho;
    this.dispatchEvent(new CustomEvent('set-ortho', {
        detail: { isOrtho: this.isOrtho },
        bubbles: true,
        composed: true
    }));
  };

      public updateGizmoScale(quad: ViewportId, scale: number) {
    this.gizmoScale = { ...this.gizmoScale, [quad]: scale };
    this.dispatchEvent(new CustomEvent('set-gizmo-scale', {
        detail: { quad, scale },
        bubbles: true,
        composed: true
    }));
    localStorage.setItem(`gizmoScale_${quad}`, scale.toString());
  }

  private toggleSettings = (quad: ViewportId) => {
    this.showSettings = { ...this.showSettings, [quad]: !this.showSettings[quad] };
  };

    private toggleTangents = (quad: ViewportId) => {
    const newState = !this.showTangents[quad];
    this.showTangents = { ...this.showTangents, [quad]: newState };
    this.dispatchEvent(new CustomEvent('set-show-tangents', {
        detail: { quad, show: newState },
        bubbles: true,
        composed: true
    }));
    localStorage.setItem(`showTangents_${quad}`, newState.toString());
  };

  private toggleGizmos = (quad: ViewportId) => {
    const newState = !this.showGizmos[quad];
    this.showGizmos = { ...this.showGizmos, [quad]: newState };
    this.dispatchEvent(new CustomEvent('set-show-gizmos', {
        detail: { quad, show: newState },
        bubbles: true,
        composed: true
    }));
    localStorage.setItem(`showGizmos_${quad}`, newState.toString());
  };

  private toggleSolidMesh = () => {
    this.showSolidMesh = !this.showSolidMesh;
    this.dispatchEvent(new CustomEvent('set-show-solid-mesh', {
        detail: { show: this.showSolidMesh },
        bubbles: true,
        composed: true
    }));
    localStorage.setItem(`showSolidMesh`, this.showSolidMesh.toString());
  };

        private activeDragNode: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' } | null = null;
  private lastDragPosition: [number, number, number] | null = null;

  private getHoverInsertPoint(quad: string, clientX: number, clientY: number, localNdcX: number, localNdcY: number, localAspect: number): { left: number, top: number } | null {
      if (quad === 'perspective' || !this.mathEngine) return null;
      const targetCurve = quad === 'top' ? 'outline' : (quad === 'side' ? 'rockerTop' : `crossSection_${this.activeProfileSlice}`);
      
      let ox = 0, oy = 0, oz = 0;
      if (quad === "profile") {
          if (this.boardState?.crossSections && this.boardState.crossSections[this.activeProfileSlice]) {
              const cs = this.boardState.crossSections[this.activeProfileSlice]!;
              const pt = cs.controlPoints?.[0] || 
                         (cs as unknown as { control_points?: {x: number, y: number, z: number}[] }).control_points?.[0];
              if (pt) {
                  oz = Array.isArray(pt) ? pt[2] : (pt as {z: number}).z;
              }
          }
      }
      
      type EngineExt = { unproject_to_plane(quad: string, ndcx: number, ndcy: number, aspect: number, ox: number, oy: number, oz: number): Float32Array; find_closest_t(curve: string, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): number; get_point_on_curve(curve: string, t: number): Float32Array; project_to_screen(quad: string, x: number, y: number, z: number, aspect: number): Float32Array; };
      
      const engine = this.mathEngine as unknown as EngineExt;
      
      const pt = engine.unproject_to_plane(quad, localNdcX, localNdcY, localAspect, ox, oy, oz);
      let worldX = pt[0]!, worldY = pt[1]!, worldZ = pt[2]!;

      let roX = worldX, roY = worldY, roZ = worldZ;
      let rdX = 0, rdY = 0, rdZ = 0;
      if (quad === 'top') { roY = 100.0; rdY = -1.0; }
      else if (quad === 'side') { roX = -100.0; rdX = 1.0; }
      else if (quad === 'profile') { roZ = worldZ - 100.0; rdZ = 1.0; }
      
      const t = engine.find_closest_t(targetCurve, roX, roY, roZ, rdX, rdY, rdZ);
      if (t >= 0.0 && t <= 1.0) {
          const curvePt = engine.get_point_on_curve(targetCurve, t);
          const proj = engine.project_to_screen(quad, curvePt[0]!, curvePt[1]!, curvePt[2]!, localAspect);
          if (proj[2]! < 1.0) {
              const rect = this.wgpuCanvas.getBoundingClientRect();
              let pxX = 0, pxY = 0;
              if (this.maximizedView) {
                  pxX = rect.left + ((proj[0]! + 1) / 2) * rect.width;
                  pxY = rect.top + ((1 - proj[1]!) / 2) * rect.height;
              } else {
                  const w = rect.width / 2;
                  const h = rect.height / 2;
                  const offsetX = (quad === 'perspective' || quad === 'profile') ? w : 0;
                  const offsetY = (quad === 'side' || quad === 'profile') ? h : 0;
                  pxX = rect.left + offsetX + ((proj[0]! + 1) / 2) * w;
                  pxY = rect.top + offsetY + ((1 - proj[1]!) / 2) * h;
              }
              
              const dist = Math.hypot(pxX - clientX, pxY - clientY);
              if (dist < 20) { // 20 pixels snap threshold
                  return { left: pxX - rect.left, top: pxY - rect.top };
              }
          }
      }
      return null;
  }

                      private findClosestNode(quad: string, ndcX: number, ndcY: number, aspect: number): { node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' }, curve: string, t: number } | null {
      const threshold = 0.05;
      let bestHit: { node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' }, curve: string, t: number } | null = null;
      let minDist = threshold;

      const checkNode = (curveName: string, pts: (import("../pages/board-builder-page.logic").Point3D | {x: number, y: number, z: number})[] | undefined, i: number, type: 'anchor'|'tangent1'|'tangent2', isSymmetrical: boolean) => {
          if (!pts || !pts[i]) return;
          const pt = pts[i];
          const ptX = Array.isArray(pt) ? pt[0] : pt.x;
          const ptY = Array.isArray(pt) ? pt[1] : pt.y;
          const ptZ = Array.isArray(pt) ? pt[2] : pt.z;

          // For symmetrical curves, ignore any nodes on the left side of the board.
          if (isSymmetrical && ptX < -1e-4) {
              return;
          }

          type EngineExt = { project_to_screen(quad: string, x: number, y: number, z: number, aspect: number): Float32Array; };
          if (this.mathEngine) {
              const proj = (this.mathEngine as unknown as EngineExt).project_to_screen(quad, ptX, ptY, ptZ, aspect);
              // Check if point is in front of the camera (z < 1 in NDC)
              if (proj[2]! < 1.0) {
                  const dx = (proj[0]! - ndcX) * aspect;
                  const dy = (proj[1]! - ndcY);
                  const dist = Math.hypot(dx, dy);
                  if (dist < minDist) {
                      minDist = dist;
                      bestHit = { node: { curve: curveName, index: i, type }, curve: curveName, t: i / (pts.length - 1 || 1) };
                  }
              }
          }
      };

            const checkCurve = (name: string, curveData: import("../pages/board-builder-page.logic").BezierCurveData | undefined, isSymmetrical: boolean) => {
          if (!curveData) return;
          if (!this.showGizmos[quad as ViewportId]) return; // Stop early if gizmos are off for this view

          const cdAny = curveData as unknown as { control_points?: {x: number, y: number, z: number}[], tangents_1?: {x: number, y: number, z: number}[], tangents_2?: {x: number, y: number, z: number}[] };
          const cps = curveData.controlPoints || cdAny.control_points;
          if (cps) {
              cps.forEach((_, i: number) => checkNode(name, cps, i, 'anchor', isSymmetrical));
          }
                                                            if (this.showTangents[quad as ViewportId]) {
              const t1s = curveData.tangents1 || cdAny.tangents_1;
              if (t1s) {
                  t1s.forEach((_, i: number) => {
                      if (i > 0) checkNode(name, t1s, i, 'tangent1', isSymmetrical);
                  });
              }
              const t2s = curveData.tangents2 || cdAny.tangents_2;
              if (t2s) {
                  t2s.forEach((_, i: number) => {
                      if (cps && i < cps.length - 1) checkNode(name, t2s, i, 'tangent2', isSymmetrical);
                  });
              }
          }
      };

            if (quad === 'top' || quad === 'perspective') {
          if (quad === 'top' || (this.boardState?.showOutline ?? true)) {
              checkCurve('outline', this.boardState?.outline, true);
          }
          if (quad === 'top' || (this.boardState?.showApexOutline ?? true)) {
              checkCurve('apexOutline', this.boardState?.apexOutline, true);
          }
          if (quad === 'top' || (this.boardState?.showRailOutline ?? true)) {
              checkCurve('railOutline', this.boardState?.railOutline, true);
          }
          if (quad === 'top' || (this.boardState?.showDeckShoulder ?? true)) {
              checkCurve('deckShoulder', this.boardState?.deckShoulder, true);
          }
          this.boardState?.outlineLayers?.forEach((l, i: number) => {
              if (l.active !== false) {
                  checkCurve(`outlineLayer_${i}_ext`, l.otlExt, true);
                  checkCurve(`outlineLayer_${i}_int`, l.otlInt, true);
              }
          });
          this.boardState?.bottomChannels?.forEach((c, i: number) => {
              checkCurve(`channel_${i}_left_outline`, c.leftOutline, false);
              checkCurve(`channel_${i}_right_outline`, c.rightOutline, false);
          });
      }

      if (quad === 'side' || quad === 'perspective') {
          if (quad === 'side' || (this.boardState?.showRockerTop ?? true)) {
              checkCurve('rockerTop', this.boardState?.rockerTop, false);
          }
          if (quad === 'side' || (this.boardState?.showRockerBottom ?? true)) {
              checkCurve('rockerBottom', this.boardState?.rockerBottom, false);
          }
          if (quad === 'side' || (this.boardState?.showApexRocker ?? true)) {
              checkCurve('apexRocker', this.boardState?.apexRocker, false);
          }
          this.boardState?.bottomChannels?.forEach((c, i: number) => {
              checkCurve(`channel_${i}_left_depth`, c.leftDepth, false);
              checkCurve(`channel_${i}_right_depth`, c.rightDepth, false);
          });
      }

      if (quad === 'profile' || quad === 'perspective') {
          if (quad === 'profile') {
              if (this.boardState?.crossSections && this.boardState.crossSections[this.activeProfileSlice]) {
                  checkCurve(`crossSection_${this.activeProfileSlice}`, this.boardState.crossSections[this.activeProfileSlice], true);
              }
          } else if (this.boardState?.showCrossSections ?? true) {
              this.boardState?.crossSections?.forEach((cs, i: number) => checkCurve(`crossSection_${i}`, cs, true));
          }
      }

      return bestHit;
  }

        private handlePointerDown = (e: PointerEvent) => {
    try { this.wgpuCanvas.setPointerCapture(e.pointerId); } catch {}
    
    const rect = this.wgpuCanvas.getBoundingClientRect();
    const w = rect.width / 2;
    const h = rect.height / 2;
    const aspect = rect.width / rect.height;

    const ndcX = ((e.clientX - rect.left) / w) - 1.0;
    const ndcY = 1.0 - ((e.clientY - rect.top) / h);

    let quad = "perspective";
    let localNdcX = ndcX;
    let localNdcY = ndcY;
    const localAspect = aspect;

    if (this.maximizedView) {
        quad = this.maximizedView;
        const maxW = rect.width;
        const maxH = rect.height;
        localNdcX = ((e.clientX - rect.left) / maxW) * 2 - 1.0;
        localNdcY = 1.0 - ((e.clientY - rect.top) / maxH) * 2;
    } else {
        if (ndcX < 0 && ndcY > 0) quad = "top";
        else if (ndcX >= 0 && ndcY > 0) quad = "perspective";
        else if (ndcX < 0 && ndcY <= 0) quad = "side";
        else if (ndcX >= 0 && ndcY <= 0) quad = "profile";

        localNdcX = ndcX < 0 ? ndcX * 2 + 1 : ndcX * 2 - 1;
        localNdcY = ndcY > 0 ? ndcY * 2 - 1 : ndcY * 2 + 1;
    }

    if (this.boardState) {
        let worldX = 0, worldY = 0, worldZ = 0;

        type EngineExt = { unproject_to_plane(quad: string, ndcx: number, ndcy: number, aspect: number, ox: number, oy: number, oz: number): Float32Array; find_closest_t(curve: string, rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): number; };
        if (this.mathEngine && (this.mathEngine as unknown as EngineExt).unproject_to_plane) {
            let ox = 0, oy = 0, oz = 0;
            if (quad === "profile") {
                if (this.boardState?.crossSections && this.boardState.crossSections[this.activeProfileSlice]) {
                    const cs = this.boardState.crossSections[this.activeProfileSlice]!;
                    const pt = cs.controlPoints?.[0] || 
                               (cs as unknown as { control_points?: {x: number, y: number, z: number}[] }).control_points?.[0];
                    if (pt) {
                        oz = Array.isArray(pt) ? pt[2] : (pt as {z: number}).z;
                    }
                }
            }
            const pt = (this.mathEngine as unknown as EngineExt).unproject_to_plane(quad, localNdcX, localNdcY, localAspect, ox, oy, oz);
            worldX = pt[0]!;
            worldY = pt[1]!;
            worldZ = pt[2]!;
        }

        if (quad) {
            const hit = this.findClosestNode(quad, localNdcX, localNdcY, localAspect);
            if (e.altKey) {
                if (quad === "perspective") {
                    console.info("Node insertion requires an orthographic view to determine placement depth.");
                    return;
                }
                let exactT = 0.5;
                const targetCurve = hit ? hit.curve : (quad === 'top' ? 'outline' : (quad === 'side' ? 'rockerTop' : `crossSection_${this.activeProfileSlice}`));
                if (this.mathEngine) {
                    let roX = worldX, roY = worldY, roZ = worldZ;
                    let rdX = 0, rdY = 0, rdZ = 0;
                    if (quad === 'top') { roY = 100.0; rdY = -1.0; }
                    else if (quad === 'side') { roX = -100.0; rdX = 1.0; }
                    else if (quad === 'profile') { roZ = worldZ - 100.0; rdZ = 1.0; }
                    
                    const t = this.mathEngine.find_closest_t(targetCurve, roX, roY, roZ, rdX, rdY, rdZ);
                    if (t >= 0.0 && t <= 1.0) exactT = t;
                }
                this.dispatchEvent(new CustomEvent('insert-node', { detail: { curve: targetCurve, t: exactT }, bubbles: true, composed: true }));
                return;
                        } else if (e.ctrlKey) {
                this.dispatchEvent(new CustomEvent('add-cross-section', { detail: { z: worldZ }, bubbles: true, composed: true }));
                return;
            } else if (hit) {
                this.wgpuCanvas.style.cursor = 'grabbing';
                this.activeDragNode = hit.node;
                const sel = this.boardState?.selectedNode;
                if (!sel || sel.curve !== hit.node.curve || sel.index !== hit.node.index || sel.type !== hit.node.type) {
                    this.dispatchEvent(new CustomEvent('node-selected', { detail: { node: hit.node }, bubbles: true, composed: true }));
                }
                return;
            }
        }
        
        if (!e.altKey && !e.ctrlKey) {
            if (this.boardState?.selectedNode) {
                this.dispatchEvent(new CustomEvent('node-selected', { detail: { node: null }, bubbles: true, composed: true }));
            }
        }
    }

    this.dispatchEvent(new CustomEvent('viewport-pointer', { detail: { type: "down", x: e.clientX, y: e.clientY, quad }, bubbles: true, composed: true }));
  };;

        private handlePointerMove = (e: PointerEvent) => {
    const rect = this.wgpuCanvas.getBoundingClientRect();
    const w = rect.width / 2;
    const h = rect.height / 2;
    const aspect = rect.width / rect.height;

    const ndcX = ((e.clientX - rect.left) / w) - 1.0;
    const ndcY = 1.0 - ((e.clientY - rect.top) / h);

    let quad = "perspective";
    let localNdcX = ndcX;
    let localNdcY = ndcY;
    const localAspect = aspect;

    if (this.maximizedView) {
        quad = this.maximizedView;
        const maxW = rect.width;
        const maxH = rect.height;
        localNdcX = ((e.clientX - rect.left) / maxW) * 2 - 1.0;
        localNdcY = 1.0 - ((e.clientY - rect.top) / maxH) * 2;
    } else {
        if (ndcX < 0 && ndcY > 0) quad = "top";
        else if (ndcX >= 0 && ndcY > 0) quad = "perspective";
        else if (ndcX < 0 && ndcY <= 0) quad = "side";
        else if (ndcX >= 0 && ndcY <= 0) quad = "profile";

        localNdcX = ndcX < 0 ? ndcX * 2 + 1 : ndcX * 2 - 1;
        localNdcY = ndcY > 0 ? ndcY * 2 - 1 : ndcY * 2 + 1;
    }

        if (this.activeDragNode) {
        if (this.wgpuCanvas.style.cursor !== 'grabbing') {
            this.wgpuCanvas.style.cursor = 'grabbing';
        }
        let originalPos: [number, number, number] = [0, 0, 0];
        if (this.boardState) {
            let curveData: import("../pages/board-builder-page.logic").BezierCurveData | undefined;
            if (this.activeDragNode.curve === 'outline') curveData = this.boardState.outline;
            else if (this.activeDragNode.curve === 'rockerTop') curveData = this.boardState.rockerTop;
            else if (this.activeDragNode.curve === 'rockerBottom') curveData = this.boardState.rockerBottom;
            else if (this.activeDragNode.curve === 'apexOutline') curveData = this.boardState.apexOutline;
            else if (this.activeDragNode.curve === 'railOutline') curveData = this.boardState.railOutline;
            else if (this.activeDragNode.curve === 'apexRocker') curveData = this.boardState.apexRocker;
            else if (this.activeDragNode.curve === 'deckShoulder') curveData = this.boardState.deckShoulder;
            else if (this.activeDragNode.curve.startsWith('crossSection_')) {
                const idx = parseInt(this.activeDragNode.curve.split('_')[1]!, 10);
                curveData = this.boardState.crossSections?.[idx];
            } else if (this.activeDragNode.curve.startsWith('outlineLayer_')) {
                const parts = this.activeDragNode.curve.split('_');
                const idx = parseInt(parts[1]!, 10);
                const layer = this.boardState.outlineLayers?.[idx];
                if (layer) curveData = parts[2] === 'ext' ? layer.otlExt : layer.otlInt;
            } else if (this.activeDragNode.curve.startsWith('channel_')) {
                const parts = this.activeDragNode.curve.split('_');
                const idx = parseInt(parts[1]!, 10);
                const channel = this.boardState.bottomChannels?.[idx];
                if (channel) {
                    if (parts[3] === 'outline') curveData = parts[2] === 'left' ? channel.leftOutline : channel.rightOutline;
                    if (parts[3] === 'depth') curveData = parts[2] === 'left' ? channel.leftDepth : channel.rightDepth;
                }
            }

            if (curveData) {
                const cdAny = curveData as unknown as { control_points?: {x: number, y: number, z: number}[], tangents_1?: {x: number, y: number, z: number}[], tangents_2?: {x: number, y: number, z: number}[] };
                let pts = curveData.controlPoints || cdAny.control_points;
                if (this.activeDragNode.type === 'tangent1') pts = curveData.tangents1 || cdAny.tangents_1;
                if (this.activeDragNode.type === 'tangent2') pts = curveData.tangents2 || cdAny.tangents_2;
                
                const pt = pts?.[this.activeDragNode.index];
                if (pt) {
                    originalPos = Array.isArray(pt) ? [pt[0] ?? 0, pt[1] ?? 0, pt[2] ?? 0] : [(pt as {x: number}).x, (pt as {y: number}).y, (pt as {z: number}).z];
                }
            }
        }

        let worldX = originalPos[0], worldY = originalPos[1], worldZ = originalPos[2];

        type EngineExt = { 
            unproject_to_plane(quad: string, ndcx: number, ndcy: number, aspect: number, ox: number, oy: number, oz: number): Float32Array;
        };

        if (this.mathEngine && (this.mathEngine as unknown as EngineExt).unproject_to_plane) {
            const pt = (this.mathEngine as unknown as EngineExt).unproject_to_plane(quad, localNdcX, localNdcY, localAspect, originalPos[0], originalPos[1], originalPos[2]);
            worldX = pt[0]!;
            worldY = pt[1]!;
            worldZ = pt[2]!;
        }

                this.lastDragPosition = [worldX, worldY, worldZ];
        this.dispatchEvent(new CustomEvent('gizmo-dragged', {
            detail: {
                userData: this.activeDragNode,
                position: [worldX, worldY, worldZ]
            },
            bubbles: true,
            composed: true
        }));
        return;
    }
    
        const hit = this.findClosestNode(quad, localNdcX, localNdcY, localAspect);
    
    let newCursor = 'default';
    this.hoverInsertPoint = null;

    if (hit) {
        newCursor = 'grab';
    } else if (quad !== 'perspective' && !this.activeDragNode) {
        const hoverPt = this.getHoverInsertPoint(quad, e.clientX, e.clientY, localNdcX, localNdcY, localAspect);
        if (hoverPt) {
            this.hoverInsertPoint = hoverPt;
            newCursor = e.altKey ? 'copy' : 'crosshair';
        }
    }

    if (this.wgpuCanvas.style.cursor !== newCursor) {
        this.wgpuCanvas.style.cursor = newCursor;
    }

    this.dispatchEvent(new CustomEvent('viewport-pointer', { detail: { type: "move", x: e.clientX, y: e.clientY, quad }, bubbles: true, composed: true }));
  };

            private handlePointerUp = (e: PointerEvent) => {
    this.wgpuCanvas.style.cursor = 'default';
    this.hoverInsertPoint = null;
    try { if (this.wgpuCanvas.hasPointerCapture(e.pointerId)) this.wgpuCanvas.releasePointerCapture(e.pointerId); } catch {}
    if (this.activeDragNode) {
        this.dispatchEvent(new CustomEvent('gizmo-drag-ended', {  
            detail: {
                userData: this.activeDragNode,
                position: this.lastDragPosition
            },
            bubbles: true, 
            composed: true 
        }));
                this.activeDragNode = null;
        this.lastDragPosition = null;
        return;
    }
    this.dispatchEvent(new CustomEvent('viewport-pointer', { detail: { type: "up", x: e.clientX, y: e.clientY, quad: "" }, bubbles: true, composed: true }));
  };

  override render() {
    const expandIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l-5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    const collapseIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M10 4v6m0 0H4m6 0L3 3"></path></svg>`;
    
        const renderProfileSliceSelector = () => {
      if (!this.boardState?.crossSections || this.boardState.crossSections.length === 0) return '';
            return html`
        <div class="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto z-50">
          <select  
            class="bg-zinc-950/90 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border border-zinc-800 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            .value=${this.activeProfileSlice.toString()}
            @change=${(e: Event) => {
              this.activeProfileSlice = parseInt((e.target as HTMLSelectElement).value, 10);
            }}
          >
            ${this.boardState.crossSections.map((_, idx) => html`
              <option value=${idx} ?selected=${this.activeProfileSlice === idx}>Slice ${idx + 1}</option>
            `)}
          </select>
        </div>
      `;
    };

        const renderQuadrantOverlay = (id: ViewportId, label: string) => html`
      <div class="relative w-full h-full pointer-events-none">
        <button type="button" @click=${() => this.toggleMaximize(id)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Maximize ${label}">
          <span>${label}</span> ${expandIcon}
        </button>
                ${id === 'profile' ? renderProfileSliceSelector() : ''}
        
                        <div class="absolute bottom-3 left-3 pointer-events-auto flex items-end gap-2 z-10">
          ${this.showSettings[id] ? html`
            <div class="mb-2 bg-zinc-950/95 border border-zinc-800 rounded shadow-xl backdrop-blur p-3 w-48 flex flex-col gap-4 origin-bottom-left animate-in fade-in zoom-in-95 duration-100">
                            <div class="flex justify-between items-center">
                <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Display Settings</span>
                <button @click=${() => this.toggleSettings(id)} class="text-zinc-500 hover:text-white">&times;</button>
              </div>
              
                            ${id === 'perspective' ? html`
              <label class="flex items-center justify-between cursor-pointer group mb-2">
                <span class="text-[10px] font-bold uppercase tracking-widest ${this.showSolidMesh ? 'text-zinc-200' : 'text-zinc-500'}">Solid Mesh</span>
                <input type="checkbox" .checked=${this.showSolidMesh} @change=${() => this.toggleSolidMesh()} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
              </label>

              <div class="flex flex-col gap-2 pt-2 border-t border-zinc-800 pb-2 border-b mb-2">
                ${[
                    { label: "Outline", key: "showOutline" },
                    { label: "Rocker Top", key: "showRockerTop" },
                    { label: "Rocker Bottom", key: "showRockerBottom" },
                    { label: "Apex Outline", key: "showApexOutline" },
                    { label: "Rail (Tuck)", key: "showRailOutline" },
                    { label: "Apex Rocker", key: "showApexRocker" },
                    { label: "Deck Shoulder", key: "showDeckShoulder" },
                    { label: "Cross Sections", key: "showCrossSections" }
                ].map(c => {
                    const isChecked = (this.boardState as any)?.[c.key] ?? true;
                    return html`
                    <label class="flex items-center justify-between cursor-pointer group">
                      <span class="text-[10px] font-bold uppercase tracking-widest ${isChecked ? 'text-zinc-200' : 'text-zinc-500'}">${c.label}</span>
                      <input type="checkbox" .checked=${isChecked} @change=${(e: Event) => {
                        this.dispatchEvent(new CustomEvent('boolean-changed', {
                          detail: { param: c.key, value: (e.target as HTMLInputElement).checked },
                          bubbles: true, composed: true
                        }));
                      }} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
                    </label>
                    `;
                })}
              </div>
              ` : ''}

              <label class="flex items-center justify-between cursor-pointer group mb-2">
                <span class="text-[10px] font-bold uppercase tracking-widest ${this.showGizmos[id] ? 'text-zinc-200' : 'text-zinc-500'}">Control Points</span>
                <input type="checkbox" .checked=${this.showGizmos[id]} @change=${() => this.toggleGizmos(id)} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
              </label>

              <label class="flex items-center justify-between cursor-pointer group mb-2">
                <span class="text-[10px] font-bold uppercase tracking-widest ${this.showTangents[id] ? 'text-zinc-200' : 'text-zinc-500'}">Tangents</span>
                <input type="checkbox" .checked=${this.showTangents[id]} @change=${() => this.toggleTangents(id)} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
              </label>

              <div class="flex flex-col gap-2">
                <div class="flex justify-between items-center">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Gizmo Size</span>
                  <span class="text-[10px] font-mono text-zinc-500">${this.gizmoScale[id].toFixed(1)}x</span>
                </div>
                <input type="range" min="0.1" max="3.0" step="0.1" .value=${this.gizmoScale[id].toString()} @input=${(e: Event) => this.updateGizmoScale(id, parseFloat((e.target as HTMLInputElement).value))} class="w-full accent-blue-500 cursor-pointer" />
              </div>
            </div>
          ` : ''}

          <div class="flex items-center gap-2">
            ${id === 'perspective' ? html`
              <button type="button" @click=${this.toggleOrtho} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isOrtho ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Toggle Orthographic">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8-4v10M4 7v10l8 4"></path></svg>
                <span>Ortho</span>
              </button>
            ` : ''}
            <button type="button" @click=${() => this.toggleSettings(id)} class="flex items-center gap-2 px-2.5 py-1.5 ${this.showSettings[id] ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Display Settings">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    return html`
                        <canvas id="wgpu-canvas" class="absolute inset-0 w-full h-full outline-none touch-none" style="z-index: 0;"></canvas>

            ${this.hoverInsertPoint ? html`
              <div 
                class="absolute z-10 pointer-events-none w-3 h-3 rounded-full border-2 border-emerald-400 bg-emerald-400/20 transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                style="left: ${this.hoverInsertPoint.left}px; top: ${this.hoverInsertPoint.top}px;"
              ></div>
              <div
                class="absolute z-10 pointer-events-none transform -translate-x-1/2 -translate-y-full mt-[-8px] text-[10px] font-bold text-emerald-400 bg-zinc-950/80 px-1.5 py-0.5 rounded border border-emerald-500/50 whitespace-nowrap backdrop-blur-sm shadow-xl"
                style="left: ${this.hoverInsertPoint.left}px; top: ${this.hoverInsertPoint.top}px;"
              >
                Alt+Click to Add Node
              </div>
            ` : ''}

      ${this.isProcessing ? html`
        <div class="absolute bottom-3 left-3 z-20 pointer-events-none flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 text-blue-400 border-blue-500/30 border text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors">
          <svg class="w-3.5 h-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Computing</span>
        </div>
      ` : ''}
            <div class="absolute bottom-3 right-3 z-20 pointer-events-auto flex gap-2">
        <button type="button" @click=${this.toggleFlip} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isFlipped ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Flip Board">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          <span>Flip</span>
        </button>
      </div>
      <div class="absolute inset-0 pointer-events-none z-10">
        ${this.maximizedView === null ? html`
          <div class="w-full h-full grid grid-cols-2 grid-rows-2">
            <div class="border-r border-b border-zinc-800/80">${renderQuadrantOverlay('top', 'Top')}</div>
            <div class="border-b border-zinc-800/80">${renderQuadrantOverlay('perspective', 'Perspective')}</div>
            <div class="border-r border-zinc-800/80">${renderQuadrantOverlay('side', 'Side')}</div>
            <div>${renderQuadrantOverlay('profile', 'Profile')}</div>
          </div>
        ` : html`
          <div class="w-full h-full relative pointer-events-none">
                        <button type="button" @click=${() => this.toggleMaximize(null)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Restore View">
              <span>${this.maximizedView}</span> ${collapseIcon}
            </button>
            ${this.maximizedView === 'profile' ? renderProfileSliceSelector() : ''}
                                                <div class="absolute bottom-3 left-3 pointer-events-auto flex items-end gap-2 z-10">
              ${this.showSettings[this.maximizedView!] ? html`
                <div class="mb-2 bg-zinc-950/95 border border-zinc-800 rounded shadow-xl backdrop-blur p-3 w-48 flex flex-col gap-4 origin-bottom-left animate-in fade-in zoom-in-95 duration-100">
                                                      <div class="flex justify-between items-center">
                    <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Display Settings</span>
                    <button @click=${() => this.toggleSettings(this.maximizedView!)} class="text-zinc-500 hover:text-white">&times;</button>
                  </div>
                  
                  ${this.maximizedView === 'perspective' ? html`
                  <label class="flex items-center justify-between cursor-pointer group mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-widest ${this.showSolidMesh ? 'text-zinc-200' : 'text-zinc-500'}">Solid Mesh</span>
                    <input type="checkbox" .checked=${this.showSolidMesh} @change=${() => this.toggleSolidMesh()} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
                  </label>

                  <div class="flex flex-col gap-2 pt-2 border-t border-zinc-800 pb-2 border-b mb-2">
                    ${[
                        { label: "Outline", key: "showOutline" },
                        { label: "Rocker Top", key: "showRockerTop" },
                        { label: "Rocker Bottom", key: "showRockerBottom" },
                        { label: "Apex Outline", key: "showApexOutline" },
                        { label: "Rail (Tuck)", key: "showRailOutline" },
                        { label: "Apex Rocker", key: "showApexRocker" },
                        { label: "Deck Shoulder", key: "showDeckShoulder" },
                        { label: "Cross Sections", key: "showCrossSections" }
                    ].map(c => {
                        const isChecked = (this.boardState as any)?.[c.key] ?? true;
                        return html`
                        <label class="flex items-center justify-between cursor-pointer group">
                          <span class="text-[10px] font-bold uppercase tracking-widest ${isChecked ? 'text-zinc-200' : 'text-zinc-500'}">${c.label}</span>
                          <input type="checkbox" .checked=${isChecked} @change=${(e: Event) => {
                            this.dispatchEvent(new CustomEvent('boolean-changed', {
                              detail: { param: c.key, value: (e.target as HTMLInputElement).checked },
                              bubbles: true, composed: true
                            }));
                          }} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
                        </label>
                        `;
                    })}
                  </div>
                  ` : ''}

                  <label class="flex items-center justify-between cursor-pointer group mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-widest ${this.showGizmos[this.maximizedView!] ? 'text-zinc-200' : 'text-zinc-500'}">Control Points</span>
                    <input type="checkbox" .checked=${this.showGizmos[this.maximizedView!]} @change=${() => this.toggleGizmos(this.maximizedView!)} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
                  </label>

                  <label class="flex items-center justify-between cursor-pointer group mb-2">
                    <span class="text-[10px] font-bold uppercase tracking-widest ${this.showTangents[this.maximizedView!] ? 'text-zinc-200' : 'text-zinc-500'}">Tangents</span>
                    <input type="checkbox" .checked=${this.showTangents[this.maximizedView!]} @change=${() => this.toggleTangents(this.maximizedView!)} class="w-3.5 h-3.5 accent-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer" />
                  </label>

                  <div class="flex flex-col gap-2">
                    <div class="flex justify-between items-center">
                      <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Gizmo Size</span>
                      <span class="text-[10px] font-mono text-zinc-500">${this.gizmoScale[this.maximizedView!].toFixed(1)}x</span>
                    </div>
                    <input type="range" min="0.1" max="3.0" step="0.1" .value=${this.gizmoScale[this.maximizedView!].toString()} @input=${(e: Event) => this.updateGizmoScale(this.maximizedView!, parseFloat((e.target as HTMLInputElement).value))} class="w-full accent-blue-500 cursor-pointer" />
                  </div>
                </div>
              ` : ''}

              <div class="flex items-center gap-2">
                ${this.maximizedView === 'perspective' ? html`
                  <button type="button" @click=${this.toggleOrtho} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isOrtho ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Toggle Orthographic">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
                    <span>Ortho</span>
                  </button>
                ` : ''}
                <button type="button" @click=${() => this.toggleSettings(this.maximizedView!)} class="flex items-center gap-2 px-2.5 py-1.5 ${this.showSettings[this.maximizedView!] ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Display Settings">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </button>
              </div>
            </div>
          </div>
        `}
      </div>
    `;
  }
}
