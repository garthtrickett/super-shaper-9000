// File: src/components/3d/board-viewport.ts
import { Point3D } from "../pages/board-builder-page.logic"; 
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import type { BoardModel, BezierCurveData } from "../pages/board-builder-page.logic";
import { generateBoardCurves, type BoardCurves } from "../../lib/client/geometry/board-curves";
import { MeshGeneratorService } from "../../lib/client/geometry/mesh-generator";
import { TextureManager } from "./managers/TextureManager";
import { AnnotationBuilder } from "./builders/AnnotationBuilder";
import { FinBuilder } from "./builders/FinBuilder";
import { GizmoBuilder } from "./builders/GizmoBuilder";
import { InteractionManager } from "./managers/InteractionManager";
import { SceneManager } from "./managers/SceneManager";

export type ViewportId = 'perspective' | 'top' | 'side' | 'profile';

export interface RustMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  volumeLiters: number;
}

@customElement("board-viewport")
export class BoardViewport extends LitElement {
  @property({ type: Object }) boardState?: BoardModel;
  @property({ type: Object }) meshData?: RustMesh;
  
  protected override createRenderRoot() { return this; }

  @query("canvas") private canvas!: HTMLCanvasElement;
  @state() private maximizedView: ViewportId | null = null;
  @state() private isFlipped = false;

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
  private latestCurves?: BoardCurves;
    
  private matAnchor = new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false });
  private matHandle = new THREE.MeshBasicMaterial({ color: 0x71717a, depthTest: false });
  private matSelected = new THREE.MeshBasicMaterial({ color: 0x059669, depthTest: false });

  override firstUpdated() {
    this.boardContainer.add(this.wireframeGroup, this.solidGroup, this.finGroup, this.gizmoGroup, this.annotationGroup, this.sliceLinesGroup, this.apexLineGroup);
    this.sceneManager = new SceneManager(this.canvas,[this.boardContainer]);
    this.interactionManager = new InteractionManager(this, this.canvas, this.sceneManager.cameras, this.sceneManager.controls, this.gizmoGroup);
    this.interactionManager.initialize();
    this.sceneManager.startRenderLoop(() => {
      if (this.boardState?.showZebra) {
        this.zebraOffset += 0.5;
        this.textureManager.updateZebraCanvas(this.zebraOffset);
      }
    });
  }

    override updated(changedProperties: PropertyValues) {
    let shouldUpdateGeom = false;
    if (changedProperties.has("meshData") && this.meshData) {
      shouldUpdateGeom = true;
    }
    
    if (changedProperties.has("boardState") && this.boardState) {
      this.interactionManager?.setBoardState(this.boardState);
      const oldState = changedProperties.get("boardState") as BoardModel | undefined;
      let needsFullGeometryUpdate = false;
      let isManualDragUpdate = false;

      if (oldState) {
        for (const key in this.boardState) {
          const k = key as keyof BoardModel;
          if (this.boardState[k] !== oldState[k]) {
            if (['outline', 'rockerTop', 'rockerBottom', 'crossSections', 'apexOutline', 'railOutline', 'apexRocker'].includes(k)) {
              isManualDragUpdate = true;
            } else if (!['volume', 'selectedNode', 'showGizmos', 'showHeatmap', 'showZebra', 'showApexLine'].includes(k)) {
              needsFullGeometryUpdate = true;
              isManualDragUpdate = false;
              break;
            }
          }
        }
      } else {
        needsFullGeometryUpdate = true;
      }

            if (needsFullGeometryUpdate || shouldUpdateGeom) {
        clearTimeout(this.geometryUpdateDebounceId);
        void this._updateGeometry();
      } else if (isManualDragUpdate) {
        this._updateGizmoPositionsFromState();
        clearTimeout(this.geometryUpdateDebounceId);
        // Debounce high resolution mesh generation so gizmos drag fluidly!
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
    this.latestCurves = curves;
    if (!curves.outline || curves.outline.length === 0) return;
    
    while (this.wireframeGroup.children.length > 0) {
        const child = this.wireframeGroup.children[0] as THREE.Line;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.wireframeGroup.remove(child);
    }

    const scale = 1 / 12;
    this.buildWireframe(curves, scale);

    while (this.solidGroup.children.length > 0) {
        const child = this.solidGroup.children[0] as THREE.Mesh;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.solidGroup.remove(child);
    }

        if (this.meshData) {
      this.buildSolidMeshFromRust(this.meshData, scale);
    } else {
      this.buildSolidMesh(curves, scale);
    }
    FinBuilder.build(this.finGroup, this.boardState, curves, scale);
    GizmoBuilder.build(this.gizmoGroup, this.boardState, curves, scale, this.matAnchor, this.matHandle);
    this.buildSliceLines(curves, scale);
    this.buildApexLine(curves, scale);
    AnnotationBuilder.build(this.annotationGroup, this.boardState, scale);
    this.updateGizmoVisibility();
    this.updateGizmoHighlights();
  }
  
  private buildWireframe(curves: BoardCurves, scale: number) {
    const matOutline = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.85 });
    const matRocker = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.85 });

    const projectY = (curveName: string, p: Point3D): Point3D => {
      if (!this.boardState || !curves) return p;
      const profile = MeshGeneratorService.getBoardProfileAtZ(this.boardState, curves, p[2]);

      let finalY = p[1];
      if (["outline", "apexOutline"].includes(curveName)) finalY = profile.apexY;
      else if (curveName === "railOutline") finalY = profile.tuckY;

      return [p[0], finalY, p[2]];
    };

    const activeOutline = this.boardState?.outline
      ? this.sampleBezierCurve(this.boardState.outline, 100).map((p) =>
          projectY("outline", p),
        )
      : curves.outline;

    const activeRockerTop = this.boardState?.rockerTop
      ? this.sampleBezierCurve(this.boardState.rockerTop, 100)
      : curves.rockerTop;
    const activeRockerBottom = this.boardState?.rockerBottom
      ? this.sampleBezierCurve(this.boardState.rockerBottom, 100)
      : curves.rockerBottom;

    const buildLine = (
      pts: [number, number, number][],
      mat: THREE.LineBasicMaterial,
      layerIndex: number,
      mirrorX = false,
    ) => {
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        vertices[i * 3] = (mirrorX ? -p[0] : p[0]) * scale;
        vertices[i * 3 + 1] = p[1] * scale;
        vertices[i * 3 + 2] = p[2] * scale;
      });
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const line = new THREE.Line(geometry, mat);
        line.layers.set(layerIndex);
        return line;
    };
    
    const matApexOutline = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5 });
    const matRailOutline = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5 });
    const matApexRocker = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5 });

    const activeApexOutline = this.boardState?.apexOutline
      ? this.sampleBezierCurve(this.boardState.apexOutline, 100).map((p) =>
          projectY("apexOutline", p),
        )
      : null;
    const activeRailOutline = this.boardState?.railOutline
      ? this.sampleBezierCurve(this.boardState.railOutline, 100).map((p) =>
          projectY("railOutline", p),
        )
      : null;
    const activeApexRocker = this.boardState?.apexRocker
      ? this.sampleBezierCurve(this.boardState.apexRocker, 100)
      : null;

    if (this.boardState?.showOutline !== false) {
      this.wireframeGroup.add(buildLine(activeOutline, matOutline, 1, false));
      this.wireframeGroup.add(buildLine(activeOutline, matOutline, 1, true));
    }

    if (activeApexOutline && this.boardState?.showApexOutline !== false) {
      this.wireframeGroup.add(buildLine(activeApexOutline, matApexOutline, 1, false));
      this.wireframeGroup.add(buildLine(activeApexOutline, matApexOutline, 1, true));
    }

    if (activeRailOutline && this.boardState?.showRailOutline !== false) {
      this.wireframeGroup.add(buildLine(activeRailOutline, matRailOutline, 1, false));
      this.wireframeGroup.add(buildLine(activeRailOutline, matRailOutline, 1, true));
    }

    if (this.boardState?.showRockerTop !== false) this.wireframeGroup.add(buildLine(activeRockerTop, matRocker, 2, false));
    if (this.boardState?.showRockerBottom !== false) this.wireframeGroup.add(buildLine(activeRockerBottom, matRocker, 2, false));

    if (activeApexRocker && this.boardState?.showApexRocker !== false) {
      this.wireframeGroup.add(buildLine(activeApexRocker, matApexRocker, 2, false));
    }
  }
  
    private buildSolidMeshFromRust(meshData: RustMesh, scale: number) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geom.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));

    if (meshData.colors && meshData.colors.length > 0) {
      geom.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    }
    if (Math.abs(this.boardState!.volume - meshData.volumeLiters) > 0.05) {
      this.dispatchEvent(new CustomEvent("volume-calculated", { detail: { volume: meshData.volumeLiters }, bubbles: true, composed: true }));
    }

    const { map, bumpMap } = this.textureManager.getBoardTextures();
    const standardMat = new THREE.MeshPhysicalMaterial({ 
      map, bumpMap, bumpScale: 0.005, roughness: 0.4, metalness: 0.0, 
      clearcoat: 1.0, clearcoatRoughness: 0.05, ior: 1.5, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const heatmapMat = new THREE.MeshStandardMaterial({ 
      vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const zebraMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, metalness: 1.0, roughness: 0.0, envMap: this.textureManager.getZebraTexture(), side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    let activeMat: THREE.Material = standardMat;
    if (this.boardState!.showHeatmap) activeMat = heatmapMat;
    else if (this.boardState!.showZebra) activeMat = zebraMat;
    const mesh = new THREE.Mesh(geom, activeMat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.set(0);
    this.solidGroup.add(mesh);
    const blueprintMat = new THREE.MeshBasicMaterial({ color: 0x09090b, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    const blueprintMesh = new THREE.Mesh(geom, blueprintMat);
    blueprintMesh.layers.set(5); this.solidGroup.add(blueprintMesh);
    const edgesGeo = new THREE.EdgesGeometry(geom, 15);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 });
    const blueprintEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    blueprintEdges.layers.set(5); this.solidGroup.add(blueprintEdges);
  }

  private buildSolidMesh(curves: BoardCurves, _scale: number) {
    const meshData = MeshGeneratorService.generateMesh(this.boardState!, curves);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geom.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));

    if (meshData.colors && meshData.colors.length > 0) {
      geom.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    }
    if (Math.abs(this.boardState!.volume - meshData.volumeLiters) > 0.05) {
      this.dispatchEvent(new CustomEvent("volume-calculated", { detail: { volume: meshData.volumeLiters }, bubbles: true, composed: true }));
    }
    const { map, bumpMap } = this.textureManager.getBoardTextures();
    const standardMat = new THREE.MeshPhysicalMaterial({ 
      map, bumpMap, bumpScale: 0.005, roughness: 0.4, metalness: 0.0, 
      clearcoat: 1.0, clearcoatRoughness: 0.05, ior: 1.5, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const heatmapMat = new THREE.MeshStandardMaterial({ 
      vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    const zebraMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, metalness: 1.0, roughness: 0.0, envMap: this.textureManager.getZebraTexture(), side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    let activeMat: THREE.Material = standardMat;
    if (this.boardState!.showHeatmap) activeMat = heatmapMat;
    else if (this.boardState!.showZebra) activeMat = zebraMat;
    const mesh = new THREE.Mesh(geom, activeMat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.set(0);
    this.solidGroup.add(mesh);
    const blueprintMat = new THREE.MeshBasicMaterial({ color: 0x09090b, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    const blueprintMesh = new THREE.Mesh(geom, blueprintMat);
    blueprintMesh.layers.set(5); this.solidGroup.add(blueprintMesh);
    const edgesGeo = new THREE.EdgesGeometry(geom, 15);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.4 });
    const blueprintEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    blueprintEdges.layers.set(5); this.solidGroup.add(blueprintEdges);
  }

  private buildApexLine(curves: BoardCurves, scale: number) {
    while (this.apexLineGroup.children.length > 0) {
      const child = this.apexLineGroup.children[0] as THREE.Line;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      this.apexLineGroup.remove(child);
    }
    const mat = new THREE.LineBasicMaterial({
      color: 0x0ea5e9,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });

    const activeApexOutline = this.boardState?.apexOutline
      ? this.boardState.apexOutline
      : this.boardState!.outline;

    // Ensure the Apex line follows the vertical rocker profile
    const sampled = this.sampleBezierCurve(activeApexOutline, 100).map((p) => {
      const profile = MeshGeneratorService.getBoardProfileAtZ(
        this.boardState!,
        curves,
        p[2],
      );
      return [p[0], profile.apexY, p[2]] as Point3D;
    });

    const ptsRight = sampled.map(
      (p) => new THREE.Vector3(p[0] * scale, p[1] * scale, p[2] * scale),
    );
    const ptsLeft = sampled.map(p => new THREE.Vector3(-p[0] * scale, p[1] * scale, p[2] * scale));

    const lineRight = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ptsRight), mat);
    const lineLeft = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ptsLeft), mat);
    lineRight.renderOrder = 999; lineLeft.renderOrder = 999;
    this.apexLineGroup.add(lineRight, lineLeft);
    this.apexLineGroup.visible = !!this.boardState?.showApexLine;
  }

  private buildSliceLines(curves: BoardCurves, scale: number) {
    while (this.sliceLinesGroup.children.length > 0) {
      const child = this.sliceLinesGroup.children[0] as THREE.Line;
      child.geometry.dispose(); (child.material as THREE.Material).dispose();
      this.sliceLinesGroup.remove(child);
    }
    const crossSections = this.boardState!.crossSections ||[];
    if (this.boardState?.showCrossSections !== false) {
      crossSections.forEach((cs, idx) => {
        const pts: THREE.Vector3[] = this.sampleBezierCurve(cs, 40).map(p => new THREE.Vector3(p[0]*scale, p[1]*scale, p[2]*scale));
        const leftPts = pts.map(p => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
        leftPts.pop();
        const fullPts =[...leftPts, ...pts];
        if (fullPts[0]) fullPts.push(fullPts[0].clone());
        const color = new THREE.Color(0x94a3b8);
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(fullPts), mat);
        line.layers.set(3);
        line.userData = { isSlice: true, curveName: `crossSection_${idx}`, defaultColor: color.getHex() };
        this.sliceLinesGroup.add(line);
      });
    }
  }
  
  private sampleBezierCurve(bezier: BezierCurveData, steps: number = 40):[number, number, number][] {
      const pts:[number, number, number][] =[];
      const numSegments = bezier.controlPoints.length - 1;
      if (numSegments < 1) return pts;
      for (let i = 0; i <= steps; i++) {
          const t = i / steps; const scaledT = t * numSegments;
          let segmentIdx = Math.floor(scaledT); if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
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
    if (!this.boardState || !this.latestCurves) return;
    const scale = 1 / 12;
    const gizmosByUserData = new Map<string, THREE.Mesh>();
    this.gizmoGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData.isGizmo) {
        const { curve, index, type } = child.userData;
        gizmosByUserData.set(`${curve}-${index}-${type}`, child as THREE.Mesh);
      }
    });

    const updatePositionsForCurve = (curveData: BezierCurveData | undefined, curveName: string) => {
      if (!curveData) return;
      curveData.controlPoints.forEach((cp, i) => {
        gizmosByUserData.get(`${curveName}-${i}-anchor`)?.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);
        const t1 = curveData.tangents1[i]; if (t1) gizmosByUserData.get(`${curveName}-${i}-tangent1`)?.position.set(t1[0] * scale, t1[1] * scale, t1[2] * scale);
        const t2 = curveData.tangents2[i]; if (t2) gizmosByUserData.get(`${curveName}-${i}-tangent2`)?.position.set(t2[0] * scale, t2[1] * scale, t2[2] * scale);
      });
    };
    
    updatePositionsForCurve(this.boardState.outline, 'outline');
    updatePositionsForCurve(this.boardState.rockerTop, 'rockerTop');
    updatePositionsForCurve(this.boardState.rockerBottom, 'rockerBottom');
    updatePositionsForCurve(this.boardState.apexOutline, 'apexOutline');
    updatePositionsForCurve(this.boardState.railOutline, 'railOutline');
    updatePositionsForCurve(this.boardState.apexRocker, 'apexRocker');
    this.boardState.crossSections?.forEach((cs, idx) => updatePositionsForCurve(cs, `crossSection_${idx}`));
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

  private toggleFlip = () => {
    this.isFlipped = !this.isFlipped;
    this.boardContainer.rotation.z = this.isFlipped ? Math.PI : 0;
    this.boardContainer.updateMatrixWorld(true);
  };

  override render() {
    const expandIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l-5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    const collapseIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M10 4v6m0 0H4m6 0L3 3"></path></svg>`;
    const renderQuadrantOverlay = (id: ViewportId, label: string) => html`
      <div class="relative w-full h-full pointer-events-none">
        <button @click=${() => this.toggleMaximize(id)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Maximize ${label}">
          <span>${label}</span> ${expandIcon}
        </button>
      </div>
    `;
    return html`
      <canvas class="block w-full h-full outline-none"></canvas>
      <div class="absolute bottom-3 right-3 z-20 pointer-events-auto">
        <button @click=${this.toggleFlip} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isFlipped ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Flip Board">
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
              <span>${this.maximizedView}</span> ${collapseIcon}
            </button>
          </div>
        `}
      </div>
    `;
  }
}
