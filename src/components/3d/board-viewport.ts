// FILE: src/components/3d/board-viewport.ts
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";

export type ViewportId = 'perspective' | 'top' | 'side' | 'profile';
import * as THREE from "three";
import type { BoardModel, BezierCurveData } from "../pages/board-builder-page.logic";
import { generateBoardCurves, type BoardCurves } from "../../lib/client/geometry/board-curves";
import { MeshGeneratorService } from "../../lib/client/geometry/mesh-generator";
import { extractCrossSectionsSS9000 } from "../../lib/client/geometry/manual-baker";
import { TextureManager } from "./managers/TextureManager";
import { AnnotationBuilder } from "./builders/AnnotationBuilder";
import { FinBuilder } from "./builders/FinBuilder";
import { GizmoBuilder } from "./builders/GizmoBuilder";
import { InteractionManager } from "./managers/InteractionManager";
import { SceneManager } from "./managers/SceneManager";

@customElement("board-viewport")
export class BoardViewport extends LitElement {
  @property({ type: Object }) boardState?: BoardModel;
  
  protected override createRenderRoot() { 
    return this; // Use Light DOM for Tailwind CSS support
  }

  @query("canvas")
  private canvas!: HTMLCanvasElement;

  @state() private maximizedView: ViewportId | null = null;

  private sceneManager!: SceneManager;
  private interactionManager!: InteractionManager;
  private textureManager = new TextureManager();
  
  private geometryUpdateDebounceId: number | undefined;
  private boardContainer = new THREE.Group();
  private wireframeGroup = new THREE.Group();
  private solidGroup = new THREE.Group();
  private finGroup = new THREE.Group();
  private gizmoGroup = new THREE.Group();
  private annotationGroup = new THREE.Group();
  private sliceLinesGroup = new THREE.Group();
  private apexLineGroup = new THREE.Group();
  private zebraOffset = 0;

  @state() private isFlipped = false;
    
  private matAnchor = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
  private matHandle = new THREE.MeshBasicMaterial({ color: 0xa1a1aa, depthTest: false });
  private matSelected = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false });

  override firstUpdated() {
    this.boardContainer.add(
      this.wireframeGroup, this.solidGroup, this.finGroup, 
      this.gizmoGroup, this.annotationGroup, this.sliceLinesGroup, this.apexLineGroup
    );

    this.sceneManager = new SceneManager(this.canvas, [this.boardContainer]);
    
    this.interactionManager = new InteractionManager(
      this, this.canvas, this.sceneManager.cameras, 
      this.sceneManager.controls, this.gizmoGroup
    );
    this.interactionManager.initialize();

    this.sceneManager.startRenderLoop(() => {
      if (this.boardState?.showZebra) {
        this.zebraOffset += 0.5;
        this.textureManager.updateZebraCanvas(this.zebraOffset);
      }
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.sceneManager) this.sceneManager.dispose();
    if (this.interactionManager) this.interactionManager.dispose();
    this.textureManager.dispose();
  }

  override updated(changedProperties: PropertyValues) {
    if (changedProperties.has("boardState") && this.boardState) {
      if (this.interactionManager) {
        this.interactionManager.setBoardState(this.boardState);
      }
      
      const oldState = changedProperties.get("boardState") as BoardModel | undefined;
      let needsFullGeometryUpdate = false;
      let isManualDragUpdate = false;

      if (oldState) {
        for (const key in this.boardState) {
          const k = key as keyof BoardModel;
          if (this.boardState[k] !== oldState[k]) {
            if (['manualOutline', 'manualRockerTop', 'manualRockerBottom', 'manualCrossSections'].includes(k)) {
              isManualDragUpdate = true;
            } else if (!['volume', 'selectedNode', 'showGizmos'].includes(k)) {
              needsFullGeometryUpdate = true;
              isManualDragUpdate = false;
              break;
            }
          }
        }
      } else {
        needsFullGeometryUpdate = true;
      }

      if (needsFullGeometryUpdate) {
        clearTimeout(this.geometryUpdateDebounceId);
        void this._updateGeometry();
      } else if (isManualDragUpdate) {
        this._updateGizmoPositionsFromState();
        clearTimeout(this.geometryUpdateDebounceId);
        this.geometryUpdateDebounceId = window.setTimeout(() => void this._updateGeometry(), 150);
      } else {
        if (oldState?.showGizmos !== this.boardState.showGizmos) this.updateGizmoVisibility();
        if (oldState?.selectedNode !== this.boardState.selectedNode) this.updateGizmoHighlights();
        if (oldState?.showApexLine !== this.boardState.showApexLine) this.apexLineGroup.visible = !!this.boardState.showApexLine;
      }
    }
  }

  private async _updateGeometry() {
    if (!this.boardState) return;
    
    const curves: BoardCurves = await generateBoardCurves(this.boardState);
    if (!curves.outline || curves.outline.length === 0) return;
    
    // Clear old wireframe
    while (this.wireframeGroup.children.length > 0) {
        const child = this.wireframeGroup.children[0] as THREE.Line;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.wireframeGroup.remove(child);
    }

    const scale = 1 / 12;
    this.buildWireframe(curves, scale);

    // Clear and build solid mesh
    while (this.solidGroup.children.length > 0) {
        const child = this.solidGroup.children[0] as THREE.Mesh;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.solidGroup.remove(child);
    }

    this.buildSolidMesh(curves, scale);

    // Delegate to builders
    FinBuilder.build(this.finGroup, this.boardState, curves, scale);
    GizmoBuilder.build(this.gizmoGroup, this.boardState, scale, this.matAnchor, this.matHandle);
    this.buildSliceLines(curves, scale);
    this.buildApexLine(curves, scale);
    AnnotationBuilder.build(this.annotationGroup, this.boardState, scale);

    this.updateGizmoVisibility();
    this.updateGizmoHighlights();
  }
  
  private buildWireframe(curves: BoardCurves, scale: number) {
    const matOutline = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.15 });
    const matRocker = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.15 });
    
    const buildLine = (pts:[number, number, number][], mat: THREE.LineBasicMaterial, layerIndex: number, mirrorX = false, isOutline = false) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            const zInches = p[2];
            const profile = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, zInches);
            
            if (isOutline) {
                vertices[i*3] = (mirrorX ? -profile.halfWidth : profile.halfWidth) * scale;
                vertices[i*3+1] = profile.apexY * scale;
            } else {
                // Rocker lines must strictly follow the stringer (X=0)
                vertices[i*3] = 0;
                vertices[i*3+1] = p[1] * scale;
            }
            vertices[i*3+2] = zInches * scale;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const line = new THREE.Line(geometry, mat);
        line.layers.set(layerIndex);
        return line;
    };
    
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, 1, false, true));
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, 1, true, true));
    this.wireframeGroup.add(buildLine(curves.rockerTop, matRocker, 2, false, false));
    this.wireframeGroup.add(buildLine(curves.rockerBottom, matRocker, 2, false, false));
  }
  
  private buildSolidMesh(curves: BoardCurves, _scale: number) {
    const meshData = MeshGeneratorService.generateMesh(this.boardState!, curves);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geom.computeVertexNormals();

    if (Math.abs(this.boardState!.volume - meshData.volumeLiters) > 0.05) {
      this.dispatchEvent(new CustomEvent("volume-calculated", { detail: { volume: meshData.volumeLiters }, bubbles: true, composed: true }));
    }

    const { map, bumpMap } = this.textureManager.getBoardTextures();
    const standardMat = new THREE.MeshPhysicalMaterial({ map, bumpMap, bumpScale: 0.005, roughness: 0.4, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, ior: 1.5, side: THREE.DoubleSide });
    const heatmapMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
    const zebraMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.0, envMap: this.textureManager.getZebraTexture(), side: THREE.DoubleSide });
    
    let activeMat: THREE.Material = standardMat;
    if (this.boardState!.showHeatmap) activeMat = heatmapMat;
    else if (this.boardState!.showZebra) activeMat = zebraMat;

    const mesh = new THREE.Mesh(geom, activeMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.layers.set(0);
    this.solidGroup.add(mesh);
    
    const blueprintMat = new THREE.MeshBasicMaterial({ color: 0x09090b, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    const blueprintMesh = new THREE.Mesh(geom, blueprintMat);
    blueprintMesh.layers.set(5);
    this.solidGroup.add(blueprintMesh);

    const edgesGeo = new THREE.EdgesGeometry(geom, 15);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 });
    const blueprintEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    blueprintEdges.layers.set(5);
    this.solidGroup.add(blueprintEdges);
  }

  private buildApexLine(curves: BoardCurves, scale: number) {
    while (this.apexLineGroup.children.length > 0) {
      const child = this.apexLineGroup.children[0] as THREE.Line;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      this.apexLineGroup.remove(child);
    }

    // Glowing neon emerald line that ignores depth (renders on top of the solid board)
    const mat = new THREE.LineBasicMaterial({ color: 0x34d399, depthTest: false, transparent: true, opacity: 0.9 });
    const ptsRight: THREE.Vector3[] = [];
    const ptsLeft: THREE.Vector3[] =[];
    
    const steps = 100;
    const minZ = curves.outline[0]![2];
    const maxZ = curves.outline[curves.outline.length - 1]![2];
    
    for(let i=0; i<=steps; i++) {
        const z = minZ + (maxZ - minZ) * (i/steps);
        const profile = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, z);
        ptsRight.push(new THREE.Vector3(profile.halfWidth * scale, profile.apexY * scale, z * scale));
        ptsLeft.push(new THREE.Vector3(-profile.halfWidth * scale, profile.apexY * scale, z * scale));
    }
    
    const geoRight = new THREE.BufferGeometry().setFromPoints(ptsRight);
    const geoLeft = new THREE.BufferGeometry().setFromPoints(ptsLeft);
    
    const lineRight = new THREE.Line(geoRight, mat);
    const lineLeft = new THREE.Line(geoLeft, mat);
    
    lineRight.renderOrder = 999;
    lineLeft.renderOrder = 999;

    this.apexLineGroup.add(lineRight, lineLeft);
    this.apexLineGroup.visible = !!this.boardState?.showApexLine;
  }

  private buildSliceLines(curves: BoardCurves, scale: number) {
    while (this.sliceLinesGroup.children.length > 0) {
      const child = this.sliceLinesGroup.children[0] as THREE.Line;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      this.sliceLinesGroup.remove(child);
    }

    const crossSections = (this.boardState!.editMode === "manual" && this.boardState!.manualCrossSections)
      ? this.boardState!.manualCrossSections
      : extractCrossSectionsSS9000(this.boardState!, curves);

    crossSections.forEach((cs, idx) => {
      const pts: THREE.Vector3[] = this.sampleBezierCurve(cs, 40).map(p => new THREE.Vector3(p[0]*scale, p[1]*scale, p[2]*scale));
      const leftPts = pts.map(p => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
      leftPts.pop();
      const fullPts = [...leftPts, ...pts];
      if (fullPts[0]) fullPts.push(fullPts[0].clone());

      const geo = new THREE.BufferGeometry().setFromPoints(fullPts);
      const hue = 0.66 * (1 - (idx / (crossSections.length - 1)));
      const color = new THREE.Color().setHSL(hue, 0.8, 0.6);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.layers.set(3);
      line.userData = { isSlice: true, curveName: `crossSection_${idx}`, defaultColor: color.getHex() };
      this.sliceLinesGroup.add(line);
    });
  }
  
  private sampleBezierCurve(bezier: BezierCurveData, steps: number = 40): [number, number, number][] {
      const pts: [number, number, number][] = [];
      const numSegments = bezier.controlPoints.length - 1;
      if (numSegments < 1) return pts;
      
      for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const scaledT = t * numSegments;
          let segmentIdx = Math.floor(scaledT);
          if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
          const localT = scaledT - segmentIdx;
          
          const P0 = bezier.controlPoints[segmentIdx]!; const P1 = bezier.controlPoints[segmentIdx + 1]!;
          const T0 = bezier.tangents2[segmentIdx]!; const T1 = bezier.tangents1[segmentIdx + 1]!;
          
          const u = 1 - localT, tt = localT*localT, uu = u*u, uuu = uu*u, ttt = tt*localT;
          const x = uuu * P0[0] + 3 * uu * localT * T0[0] + 3 * u * tt * T1[0] + ttt * P1[0];
          const y = uuu * P0[1] + 3 * uu * localT * T0[1] + 3 * u * tt * T1[1] + ttt * P1[1];
          const z = uuu * P0[2] + 3 * uu * localT * T0[2] + 3 * u * tt * T1[2] + ttt * P1[2];
          pts.push([x, y, z]);
      }
      return pts;
  }

  private _updateGizmoPositionsFromState() {
    if (!this.boardState || this.boardState.editMode !== 'manual') return;

    const scale = 1 / 12;
    const gizmosByUserData = new Map<string, THREE.Mesh>();
    this.gizmoGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData.isGizmo) {
        const { curve, index, type } = child.userData;
        const key = `${curve}-${index}-${type}`;
        gizmosByUserData.set(key, child as THREE.Mesh);
      }
    });

    const updatePositionsForCurve = (curveData: BezierCurveData | undefined, curveName: string) => {
      if (!curveData) return;
      curveData.controlPoints.forEach((cp, i) => {
        gizmosByUserData.get(`${curveName}-${i}-anchor`)?.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);
        const t1 = curveData.tangents1[i];
        if (t1) gizmosByUserData.get(`${curveName}-${i}-tangent1`)?.position.set(t1[0] * scale, t1[1] * scale, t1[2] * scale);
        const t2 = curveData.tangents2[i];
        if (t2) gizmosByUserData.get(`${curveName}-${i}-tangent2`)?.position.set(t2[0] * scale, t2[1] * scale, t2[2] * scale);
      });
    };

    updatePositionsForCurve(this.boardState.manualOutline, 'outline');
    updatePositionsForCurve(this.boardState.manualRockerTop, 'rockerTop');
    updatePositionsForCurve(this.boardState.manualRockerBottom, 'rockerBottom');
    this.boardState.manualCrossSections?.forEach((cs, idx) => updatePositionsForCurve(cs, `crossSection_${idx}`));
  }

  private updateGizmoHighlights() {
    const selected = this.boardState?.selectedNode;
    this.gizmoGroup.children.forEach(child => {
      const ud = child.userData;
      if (child instanceof THREE.Mesh && ud.isGizmo) {
        const isSelected = selected && ud.curve === selected.curve && ud.index === selected.index && ud.type === selected.type;
        child.material = isSelected ? this.matSelected : (ud.type === 'anchor' ? this.matAnchor : this.matHandle);
      }
    });
    this.sliceLinesGroup.children.forEach(child => {
      const ud = child.userData;
      if (ud.isSlice) {
        const mat = (child as THREE.Line).material as THREE.LineBasicMaterial;
        const isSelected = selected && selected.curve === ud.curveName;
        mat.color.setHex(isSelected ? 0xffffff : (ud.defaultColor as number));
        mat.opacity = isSelected ? 1.0 : 0.15;
        child.renderOrder = isSelected ? 999 : 0;
      }
    });
  }

  private updateGizmoVisibility() {
    this.gizmoGroup.visible = this.boardState?.showGizmos !== false;
  }

  private toggleMaximize(view: ViewportId | null) {
    this.maximizedView = view;
    if (this.sceneManager) this.sceneManager.setMaximizedView(view);
    if (this.interactionManager) this.interactionManager.setMaximizedView(view);
  }

  private toggleFlip() {
    this.isFlipped = !this.isFlipped;
    this.boardContainer.rotation.z = this.isFlipped ? Math.PI : 0;
    this.boardContainer.updateMatrixWorld(true);
  }

  override render() {
    const expandIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    const collapseIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M10 4v6m0 0H4m6 0L3 3"></path></svg>`;

    const renderQuadrantOverlay = (id: ViewportId, label: string) => html`
      <div class="relative w-full h-full pointer-events-none">
        <button @click=${() => this.toggleMaximize(id)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Maximize ${label}">
          <span>${label}</span>
          ${expandIcon}
        </button>
      </div>
    `;

    return html`
      <canvas class="block w-full h-full outline-none"></canvas>

      <div class="absolute top-3 right-3 z-20 pointer-events-auto">
        <button @click=${this.toggleFlip} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isFlipped ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Flip Board (Bottom Up)">
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
            <button @click=${() => this.toggleMaximize(null)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Restore View">
              <span>${this.maximizedView}</span>
              ${collapseIcon}
            </button>
          </div>
        `}
      </div>
    `;
  }
}
