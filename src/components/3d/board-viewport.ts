// File: src/components/3d/board-viewport.ts
import { Point3D } from "../pages/board-builder-page.logic"; 
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import type { BoardModel, BezierCurveData } from "../pages/board-builder-page.logic";
import type { WasmEngine } from "../../lib/client/wasm/surfer_wasm.js";
import { TextureManager } from "./managers/TextureManager";
import { AnnotationBuilder } from "./builders/AnnotationBuilder";
import { FinBuilder } from "./builders/FinBuilder";
import { GizmoBuilder } from "./builders/GizmoBuilder";
import { CurvatureBuilder } from "./builders/CurvatureBuilder";
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
  vertexCount: number;
  triangleCount: number;
}

@customElement("board-viewport")
export class BoardViewport extends LitElement {
    @property({ type: Object }) boardState?: BoardModel;
  @property({ type: Object }) meshData?: RustMesh;
      @property({ type: Object }) curvatureCombs?: Float32Array;
  @property({ attribute: false }) mathEngine?: WasmEngine;
  @property({ type: String }) selectedNodeContinuity: "G0" | "G1" | "G2" = "G1";
  @property({ type: Boolean }) isProcessing = false;
  
  protected override createRenderRoot() { return this; }

  @query("canvas") private canvas!: HTMLCanvasElement;
    @state() private maximizedView: ViewportId | null = null;
    @state() private isFlipped = false;
  @state() private isOrtho = false;
  @state() private activeProfileSlice = 0;

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
  private curvatureGroup = new THREE.Group();
  private previewGroup = new THREE.Group();
    private zebraOffset = 0;
  
  @state() private hoverPreview: { curve: string, t: number, mirrorX: boolean } | null = null;
  private mriClippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1000);
    
  private matAnchor = new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false });
  private matHandle = new THREE.MeshBasicMaterial({ color: 0x71717a, depthTest: false });
  private matSelected = new THREE.MeshBasicMaterial({ color: 0x059669, depthTest: false });

                override firstUpdated() {
    this.boardContainer.add(this.wireframeGroup, this.solidGroup, this.finGroup, this.gizmoGroup, this.annotationGroup, this.sliceLinesGroup, this.apexLineGroup, this.curvatureGroup, this.previewGroup);
    this.sceneManager = new SceneManager(this.canvas,[this.boardContainer]);
    this.interactionManager = new InteractionManager(this, this.canvas, this.sceneManager.cameras, this.sceneManager.controls, this.gizmoGroup, this.wireframeGroup, this.sliceLinesGroup);
    this.interactionManager.initialize();
    this.sceneManager.startRenderLoop(() => {
      if (this.boardState?.showZebra) {
        this.zebraOffset += 0.5;
        this.textureManager.updateZebraCanvas(this.zebraOffset);
      }
    });
  }

          override updated(changedProperties: PropertyValues) {
    if (changedProperties.has("curvatureCombs") && this.curvatureCombs) {
      CurvatureBuilder.build(this.curvatureGroup, this.curvatureCombs, 1/12);
    }
    
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

                if ((changedProperties.has("boardState") || changedProperties.has("mathEngine")) && this.boardState) {
      this.interactionManager?.setBoardState(this.boardState);
      const oldState = changedProperties.get("boardState") as BoardModel | undefined;
      let needsFullGeometryUpdate = false;
      let isManualDragUpdate = false;

      if (oldState) {
        for (const key in this.boardState) {
          const k = key as keyof BoardModel;
          if (k === 'history' || k === 'historyIndex') continue;

          const isComplex = typeof this.boardState[k] === 'object' && this.boardState[k] !== null;
          let changed = false;
          if (isComplex) {
            changed = JSON.stringify(this.boardState[k]) !== JSON.stringify(oldState[k]);
          } else {
            changed = this.boardState[k] !== oldState[k];
          }

          if (changed) {
                        if (['outline', 'rockerTop', 'rockerBottom', 'crossSections', 'apexOutline', 'railOutline', 'apexRocker', 'deckShoulder', 'outlineLayers', 'bottomChannels'].includes(k)) {
              isManualDragUpdate = true;
                        } else if (!['selectedNode', 'showGizmos', 'showSolidMesh', 'showHeatmap', 'showZebra', 'showApexLine', 'showCurvature', 'showMriView', 'mriSlicePosition', 'gizmoScaleTop', 'gizmoScaleSide', 'gizmoScaleProfile'].includes(k)) {
              needsFullGeometryUpdate = true;
              isManualDragUpdate = false;
              break;
            }
          }
        }
      } else {
        needsFullGeometryUpdate = true;
      }

            let shouldUpdateSolidMesh = false;
      if (changedProperties.has("meshData") && this.meshData) {
        shouldUpdateSolidMesh = true;
      }

      // Reset scale that might have been applied during a preview drag
      this.solidGroup.scale.set(1, 1, 1);
      this.finGroup.scale.set(1, 1, 1);
      this.annotationGroup.scale.set(1, 1, 1);

            if (needsFullGeometryUpdate || changedProperties.has("mathEngine")) {
        clearTimeout(this.geometryUpdateDebounceId);
        void this._updateGeometry();
      } else if (isManualDragUpdate) {
        this._updateGizmoPositionsFromState();
        if (shouldUpdateSolidMesh) {
          this._updateSolidMeshOnly();
        }
        clearTimeout(this.geometryUpdateDebounceId);
        this.geometryUpdateDebounceId = window.setTimeout(() => void this._updateGeometry(), 150);
      } else {
        if (shouldUpdateSolidMesh) {
          this._updateSolidMeshOnly();
        }
        if (oldState?.showGizmos !== this.boardState.showGizmos) this.updateGizmoVisibility();
        if (oldState?.showSolidMesh !== this.boardState.showSolidMesh) this.solidGroup.visible = this.boardState.showSolidMesh !== false;
        if (JSON.stringify(oldState?.selectedNode) !== JSON.stringify(this.boardState.selectedNode)) this.updateGizmoHighlights();
        if (oldState?.showApexLine !== this.boardState.showApexLine) this.apexLineGroup.visible = !!this.boardState.showApexLine;
                if (oldState?.showCurvature !== this.boardState.showCurvature) {
          CurvatureBuilder.build(this.curvatureGroup, this.curvatureCombs, 1/12);
        }
                        if (oldState?.gizmoScaleTop !== this.boardState.gizmoScaleTop ||
            oldState?.gizmoScaleSide !== this.boardState.gizmoScaleSide ||
            oldState?.gizmoScaleProfile !== this.boardState.gizmoScaleProfile ||
            oldState?.gizmoScalePerspective !== this.boardState.gizmoScalePerspective) {
          if (this.mathEngine && !this.interactionManager?.isDragging()) {
            GizmoBuilder.build(this.gizmoGroup, this.boardState, this.mathEngine, 1/12, this.matAnchor, this.matHandle, this.activeProfileSlice);
            this.updateGizmoHighlights();
          }
        }
      }

      // Update clipping plane dynamically without rebuilding geometry
      if (this.boardState.showMriView) {
        const pct = this.boardState.mriSlicePosition ?? 50.0;
        const scale = 1 / 12;
        const L = this.boardState.length * scale;
        const sliceZ = -L/2 + (L * (pct / 100.0));
        this.mriClippingPlane.normal.set(0, 0, -1);
        this.mriClippingPlane.constant = sliceZ;
      } else {
        this.mriClippingPlane.constant = 1000; // Disable clipping by moving plane far away
      }
    }
  }

    private _updateSolidMeshOnly() {
    if (!this.meshData) return;
    const scale = 1 / 12;
    while (this.solidGroup.children.length > 0) {
        const child = this.solidGroup.children[0] as THREE.Mesh;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.solidGroup.remove(child);
    }
    this.buildSolidMeshFromRust(this.meshData, scale);
  }

        private _updateGeometry() {
    if (!this.boardState) return;
    const mathEngine = this.mathEngine;
    if (!mathEngine) return; // Wait for WASM to initialize
    
    while (this.wireframeGroup.children.length > 0) {
        const child = this.wireframeGroup.children[0] as THREE.Line;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.wireframeGroup.remove(child);
    }

    const scale = 1 / 12;
    this.buildWireframe(mathEngine, scale);

    while (this.solidGroup.children.length > 0) {
        const child = this.solidGroup.children[0] as THREE.Mesh;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.solidGroup.remove(child);
    }

    if (this.meshData) {
      this.buildSolidMeshFromRust(this.meshData, scale);
    }
    
        FinBuilder.build(this.finGroup, this.boardState, mathEngine, scale);
    if (!this.interactionManager?.isDragging()) {
      GizmoBuilder.build(this.gizmoGroup, this.boardState, mathEngine, scale, this.matAnchor, this.matHandle, this.activeProfileSlice);
    }
    this.buildSliceLines(mathEngine, scale);
    this.buildApexLine(mathEngine, scale);
    CurvatureBuilder.build(this.curvatureGroup, this.curvatureCombs, scale);
    AnnotationBuilder.build(this.annotationGroup, this.boardState, scale);
    this.solidGroup.visible = this.boardState?.showSolidMesh !== false;
    this.updateGizmoVisibility();
    this.updateGizmoHighlights();
  }
  
        private buildWireframe(mathEngine: WasmEngine, scale: number) {
    const matOutline = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85 });
    const matRocker = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.85 });

                const projectY = (curveName: string, p: Point3D): Point3D => {
      if (!this.boardState) return p;
      const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { topY: number, botY: number, apexY: number, tuckY: number, shoulderY: number };

      let finalY = p[1];
      if (["outline", "apexOutline"].includes(curveName)) finalY = profile.apexY;
      else if (curveName === "railOutline") finalY = profile.tuckY;
      else if (curveName === "deckShoulder") finalY = profile.shoulderY;

      return [p[0], finalY, p[2]];
    };

    const activeOutline = this.boardState?.outline
      ? this.sampleBezierCurve(this.boardState.outline, 100).map((p) =>
          projectY("outline", p),
        )
      :[];

    const activeRockerTop = this.boardState?.rockerTop
      ? this.sampleBezierCurve(this.boardState.rockerTop, 100)
      :[];
    const activeRockerBottom = this.boardState?.rockerBottom
      ? this.sampleBezierCurve(this.boardState.rockerBottom, 100)
      :[];

                const buildLine = (
      pts: [number, number, number][],
      mat: THREE.Material,
      layerIndex: number,
      mirrorX = false,
      curveName: string = ""
    ) => {
      const geometry = new THREE.BufferGeometry();
      const vertices = new Float32Array(pts.length * 3);
      pts.forEach((p, i) => {
        vertices[i * 3] = (mirrorX ? -p[0] : p[0]) * scale;
        vertices[i * 3 + 1] = p[1] * scale;
        vertices[i * 3 + 2] = p[2] * scale;
      });
                geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        if (pts.length === 0) geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
        const line = new THREE.Line(geometry, mat);
        line.layers.set(layerIndex);
        line.userData = { isCurveLine: true, curve: curveName, mirrorX };
        return line;
    };
    
        const matApexOutline = new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.5 });
    const matRailOutline = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 });
        const matApexRocker = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 });
    const matDeckShoulder = new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.85 });

        const activeApexOutline = this.boardState?.apexOutline && this.boardState.apexOutline.controlPoints.length > 0
      ? this.sampleBezierCurve(this.boardState.apexOutline, 100).map((p) => projectY("apexOutline", p))
      : activeOutline.map((p) => {
          const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { apexX: number, apexY: number };
          return [profile.apexX, profile.apexY, p[2]] as Point3D;
        });

    const activeRailOutline = this.boardState?.railOutline && this.boardState.railOutline.controlPoints.length > 0
      ? this.sampleBezierCurve(this.boardState.railOutline, 100).map((p) => projectY("railOutline", p))
      : activeOutline.map((p) => {
          const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { tuckX: number, tuckY: number };
          return [profile.tuckX, profile.tuckY, p[2]] as Point3D;
        });

    const activeApexRocker = this.boardState?.apexRocker && this.boardState.apexRocker.controlPoints.length > 0
      ? this.sampleBezierCurve(this.boardState.apexRocker, 100).map((p) => {
          const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { apexX: number };
          return [profile.apexX, p[1], p[2]] as Point3D;
        })
      : activeOutline.map((p) => {
          const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { apexX: number, apexY: number };
          return [profile.apexX, profile.apexY, p[2]] as Point3D;
        });

    const activeDeckShoulder = this.boardState?.deckShoulder && this.boardState.deckShoulder.controlPoints.length > 0
      ? this.sampleBezierCurve(this.boardState.deckShoulder, 100).map((p) => projectY("deckShoulder", p))
      : activeOutline.map((p) => {
          const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { shoulderX: number, shoulderY: number };
          return [profile.shoulderX, profile.shoulderY, p[2]] as Point3D;
        });

        if (this.boardState?.showOutline !== false) {
      this.wireframeGroup.add(buildLine(activeOutline, matOutline, 1, false, 'outline'));
      this.wireframeGroup.add(buildLine(activeOutline, matOutline, 1, true, 'outline'));
      
    }

    if (activeApexOutline && this.boardState?.showApexOutline !== false) {
      this.wireframeGroup.add(buildLine(activeApexOutline, matApexOutline, 1, false, 'apexOutline'));
      this.wireframeGroup.add(buildLine(activeApexOutline, matApexOutline, 1, true, 'apexOutline'));      
    }

    if (activeRailOutline && this.boardState?.showRailOutline !== false) {
      this.wireframeGroup.add(buildLine(activeRailOutline, matRailOutline, 1, false, 'railOutline'));
      this.wireframeGroup.add(buildLine(activeRailOutline, matRailOutline, 1, true, 'railOutline'));      
    }

    if (this.boardState?.showRockerTop !== false) this.wireframeGroup.add(buildLine(activeRockerTop, matRocker, 2, false, 'rockerTop'));
    if (this.boardState?.showRockerBottom !== false) this.wireframeGroup.add(buildLine(activeRockerBottom, matRocker, 2, false, 'rockerBottom'));

                                if (activeApexRocker && this.boardState?.showApexRocker !== false) {
      this.wireframeGroup.add(buildLine(activeApexRocker, matApexRocker, 2, false, 'apexRocker'));
      this.wireframeGroup.add(buildLine(activeApexRocker, matApexRocker, 2, true, 'apexRocker'));
    }

    if (activeDeckShoulder && this.boardState?.showDeckShoulder !== false) {
      this.wireframeGroup.add(buildLine(activeDeckShoulder, matDeckShoulder, 1, false, 'deckShoulder'));
      this.wireframeGroup.add(buildLine(activeDeckShoulder, matDeckShoulder, 1, true, 'deckShoulder'));
      this.wireframeGroup.add(buildLine(activeDeckShoulder, matDeckShoulder, 2, false, 'deckShoulder'));
    }

        if (this.boardState?.bottomChannels) {
      const matChannelOutline = new THREE.LineDashedMaterial({ color: 0x10b981, dashSize: 0.5 * scale, gapSize: 0.25 * scale, transparent: true, opacity: 0.6 });
      const matChannelDepth = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.4 });
      
      this.boardState.bottomChannels.forEach((channel, idx) => {
                const drawOutline = (curveData: BezierCurveData, curveName: string) => {
           if (curveData && curveData.controlPoints.length > 0) {
                            const sampledOutline = this.sampleBezierCurve(curveData, 50).map(p => {
                 const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { topY: number, botY: number, apexY: number, tuckY: number };
                 return[p[0], profile.botY, p[2]] as Point3D;
              });
              const line = buildLine(sampledOutline, matChannelOutline, 1, false, curveName);
              (line as THREE.Line).computeLineDistances();
              this.wireframeGroup.add(line);
           }
        };
        const drawDepth = (curveData: BezierCurveData, curveName: string) => {
           if (curveData && curveData.controlPoints.length > 0) {
                            const sampledDepth = this.sampleBezierCurve(curveData, 50).map(p => {
                 const profile = mathEngine.get_profile_at_z(p[2]) as unknown as { topY: number, botY: number, apexY: number, tuckY: number };
                 return[p[0], profile.botY - 2.0 + p[1], p[2]] as Point3D;
              });
              this.wireframeGroup.add(buildLine(sampledDepth, matChannelDepth, 2, false, curveName));
           }
        };

        drawOutline(channel.leftOutline, `channel_${idx}_left_outline`);
        drawOutline(channel.rightOutline, `channel_${idx}_right_outline`);
        drawDepth(channel.leftDepth, `channel_${idx}_left_depth`);
        drawDepth(channel.rightDepth, `channel_${idx}_right_depth`);
      });
    }

        if (this.boardState && this.boardState.showOutline !== false && this.boardState.outlineLayers) {
      this.boardState.outlineLayers.forEach((layer, idx) => {
        if (layer.active === false) return;
        if (layer.otlExt?.controlPoints?.length > 0) {
          const sampled = this.sampleBezierCurve(layer.otlExt, 50).map((p) => projectY("outline", p));
          this.wireframeGroup.add(buildLine(sampled, matOutline, 1, false, `outlineLayer_${idx}_ext`));
          this.wireframeGroup.add(buildLine(sampled, matOutline, 1, true, `outlineLayer_${idx}_ext`));
        }
        if (layer.otlInt?.controlPoints?.length > 0) {
          const sampled = this.sampleBezierCurve(layer.otlInt, 50).map((p) => projectY("outline", p));
          this.wireframeGroup.add(buildLine(sampled, matOutline, 1, false, `outlineLayer_${idx}_int`));
          this.wireframeGroup.add(buildLine(sampled, matOutline, 1, true, `outlineLayer_${idx}_int`));
        }
      });
    }
  }
  
      private buildSolidMeshFromRust(meshData: RustMesh, _scale: number) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geom.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));

        if (meshData.colors && meshData.colors.length > 0) {
      geom.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    }

    const { map, bumpMap } = this.textureManager.getBoardTextures();
        const standardMat = new THREE.MeshPhysicalMaterial({ 
      map, bumpMap, bumpScale: 0.005, roughness: 0.4, metalness: 0.0, 
      clearcoat: 1.0, clearcoatRoughness: 0.05, ior: 1.5, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      clippingPlanes: [this.mriClippingPlane]
    });
    const heatmapMat = new THREE.MeshStandardMaterial({ 
      vertexColors: true, roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      clippingPlanes:[this.mriClippingPlane]
    });
    const zebraMat = new THREE.MeshStandardMaterial({ 
      color: 0xffffff, metalness: 1.0, roughness: 0.0, envMap: this.textureManager.getZebraTexture(), side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      clippingPlanes:[this.mriClippingPlane]
    });
    let activeMat: THREE.Material = standardMat;
    if (this.boardState!.showHeatmap) activeMat = heatmapMat;
    else if (this.boardState!.showZebra) activeMat = zebraMat;
    const mesh = new THREE.Mesh(geom, activeMat);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.layers.set(0);
    this.solidGroup.add(mesh);

        const capMat = new THREE.MeshBasicMaterial({ color: 0x475569, side: THREE.BackSide, clippingPlanes:[this.mriClippingPlane] });
    const capMesh = new THREE.Mesh(geom, capMat);
    capMesh.layers.set(0);
    this.solidGroup.add(capMesh);
  }

  

    private buildApexLine(mathEngine: WasmEngine, scale: number) {
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
      const profile = mathEngine.get_profile_at_z(p[2]) as { topY: number, botY: number, apexY: number, tuckY: number };
      return[p[0], profile.apexY, p[2]] as Point3D;
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

    private buildSliceLines(mathEngine: WasmEngine, scale: number) {
    while (this.sliceLinesGroup.children.length > 0) {
      const child = this.sliceLinesGroup.children[0] as THREE.Line;
      child.geometry.dispose(); (child.material as THREE.Material).dispose();
      this.sliceLinesGroup.remove(child);
    }
    const crossSections = this.boardState!.crossSections ||[];
        if (this.boardState?.showCrossSections !== false) {
      crossSections.forEach((cs, idx) => {
        const curveName = `crossSection_${idx}`;
        const pts: THREE.Vector3[] = this.sampleBezierCurve(cs, 40).map(p => {
          const worldY = this.getZHeight(curveName, p[1], p[2], mathEngine);
          return new THREE.Vector3(p[0]*scale, worldY*scale, p[2]*scale);
        });
                        const leftPts = pts.map(p => new THREE.Vector3(-p.x, p.y, p.z));
        const color = new THREE.Color(0x334155); // Darker Slate-700
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false });
        
        const targetLayer = idx === this.activeProfileSlice ? 3 : 4;

                const lineRight = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        lineRight.layers.set(targetLayer);
        lineRight.userData = { isSlice: true, curveName, defaultColor: color.getHex(), isCurveLine: true, curve: curveName, mirrorX: false };
        this.sliceLinesGroup.add(lineRight);

                const lineLeft = new THREE.Line(new THREE.BufferGeometry().setFromPoints(leftPts), mat);
        lineLeft.layers.set(targetLayer);
        lineLeft.userData = { isSlice: true, curveName, defaultColor: color.getHex(), isCurveLine: true, curve: curveName, mirrorX: true };
        this.sliceLinesGroup.add(lineLeft);
      });
    }
  }
  
              override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('gizmo-dragging', this._handleGizmoDragging as EventListener);
    this.addEventListener('gizmo-drag-ended', this._handleGizmoDragEnded as EventListener);
  }

  override disconnectedCallback() {
    this.removeEventListener('gizmo-dragging', this._handleGizmoDragging as EventListener);
    this.removeEventListener('gizmo-drag-ended', this._handleGizmoDragEnded as EventListener);
    super.disconnectedCallback();
  }

  private _handleGizmoDragEnded = () => {
    // Clear debounce and force a clean rebuild of geometry to ensure preview artifacts are removed
    clearTimeout(this.geometryUpdateDebounceId);
    this._updateGeometry();
  };

  private _getCurveData(curveName: string): BezierCurveData | undefined {
    if (!this.boardState) return undefined;
    if (curveName === 'outline') return this.boardState.outline;
    if (curveName === 'rockerTop') return this.boardState.rockerTop;
    if (curveName === 'rockerBottom') return this.boardState.rockerBottom;
    if (curveName === 'apexOutline') return this.boardState.apexOutline;
    if (curveName === 'railOutline') return this.boardState.railOutline;
    if (curveName === 'apexRocker') return this.boardState.apexRocker;
    if (curveName === 'deckShoulder') return this.boardState.deckShoulder;
    if (curveName.startsWith('crossSection_')) {
      const idx = parseInt(curveName.split('_')[1] || "0", 10);
      return this.boardState.crossSections?.[idx];
    }
    if (curveName.startsWith('outlineLayer_')) {
      const parts = curveName.split('_');
      const idx = parseInt(parts[1] || "0", 10);
      const layer = this.boardState.outlineLayers?.[idx];
      if (layer) return parts[2] === 'ext' ? layer.otlExt : layer.otlInt;
    }
    if (curveName.startsWith('channel_')) {
      const parts = curveName.split('_');
      const idx = parseInt(parts[1] || "0", 10);
      const side = parts[2];
      const type = parts[3];
      const channel = this.boardState.bottomChannels?.[idx];
      if (channel) {
        if (side === 'left') return type === 'outline' ? channel.leftOutline : channel.leftDepth;
        if (side === 'right') return type === 'outline' ? channel.rightOutline : channel.rightDepth;
      }
    }
    return undefined;
  }

  private _handleGizmoDragging = (e: Event) => {
    const customEvent = e as CustomEvent<{ userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number] }>;
    if (!this.boardState || !this.mathEngine) return;
    const { userData, position } = customEvent.detail;
    const curveData = this._getCurveData(userData.curve);
    if (!curveData) return;

    // FIX: Cast the JSON.parse result to unknown first to satisfy ESLint
    const clonedCurve = JSON.parse(JSON.stringify(curveData)) as unknown as BezierCurveData;

    if (userData.type === 'anchor') {
      const oldA = clonedCurve.controlPoints[userData.index];
      if (oldA) {
        const dx = position[0] - oldA[0];
        const dy = position[1] - oldA[1];
        const dz = position[2] - oldA[2];
        clonedCurve.controlPoints[userData.index] = position;
        
        if (clonedCurve.tangents1[userData.index]) {
          const t1 = clonedCurve.tangents1[userData.index]!;
          clonedCurve.tangents1[userData.index] = [t1[0] + dx, t1[1] + dy, t1[2] + dz];
        }
        if (clonedCurve.tangents2[userData.index]) {
          const t2 = clonedCurve.tangents2[userData.index]!;
          clonedCurve.tangents2[userData.index] = [t2[0] + dx, t2[1] + dy, t2[2] + dz];
        }
      }
    } else if (userData.type === 'tangent1' || userData.type === 'tangent2') {
      const isT1 = userData.type === 'tangent1';
      if (isT1) clonedCurve.tangents1[userData.index] = position;
      else clonedCurve.tangents2[userData.index] = position;

      if (this.selectedNodeContinuity !== 'G0') {
        const anchor = clonedCurve.controlPoints[userData.index];
        const tSrc = position;
        const tTgt = isT1 ? clonedCurve.tangents2[userData.index] : clonedCurve.tangents1[userData.index];
        
        if (anchor && tSrc && tTgt) {
          const dx = anchor[0] - tSrc[0];
          const dy = anchor[1] - tSrc[1];
          const dz = anchor[2] - tSrc[2];
          const lenSrc = Math.hypot(dx, dy, dz);
          
          if (lenSrc > 1e-6) {
            const tgtDx = tTgt[0] - anchor[0];
            const tgtDy = tTgt[1] - anchor[1];
            const tgtDz = tTgt[2] - anchor[2];
            const lenTgt = Math.hypot(tgtDx, tgtDy, tgtDz);
            
            const newTgt: Point3D = [
              anchor[0] + (dx / lenSrc) * lenTgt,
              anchor[1] + (dy / lenSrc) * lenTgt,
              anchor[2] + (dz / lenSrc) * lenTgt
            ];
            
            if (isT1) clonedCurve.tangents2[userData.index] = newTgt;
            else clonedCurve.tangents1[userData.index] = newTgt;
          }
        }
      }
    }

    let steps = 100;
    if (userData.curve.startsWith('channel_') || userData.curve.startsWith('outlineLayer_')) {
        steps = 50;
    } else if (userData.curve.startsWith('crossSection_')) {
        steps = 40;
    }
    
    const sampled = this.sampleBezierCurve(clonedCurve, steps);
    const projected = sampled.map(p => {
       const x = this.getXOffset(userData.curve, p[0], p[2], this.mathEngine!);
       let y = p[1];
       
       const profile = this.mathEngine!.get_profile_at_z(p[2]) as unknown as { topY: number, botY: number, apexY: number, tuckY: number, shoulderY: number };
       if (["outline", "apexOutline"].includes(userData.curve)) y = profile.apexY;
       else if (userData.curve === "railOutline") y = profile.tuckY;
       else if (userData.curve === "deckShoulder") y = profile.shoulderY;
       else if (userData.curve.startsWith('channel_') && userData.curve.endsWith('_outline')) y = profile.botY;
       else if (userData.curve.startsWith('channel_') && userData.curve.endsWith('_depth')) y = profile.botY - 2.0 + p[1];
       else if (userData.curve.startsWith('crossSection_')) y = this.getZHeight(userData.curve, p[1], p[2], this.mathEngine!);
       
       return [x, y, p[2]] as Point3D;
    });

    const scale = 1/12;
    const groups = [this.wireframeGroup, this.sliceLinesGroup];
    
    for (const group of groups) {
      group.children.forEach(child => {
        if (child.userData?.curve === userData.curve) {
          const line = child as THREE.Line;
          const mirrorX = line.userData.mirrorX as boolean;
          const positions = line.geometry.attributes.position?.array as Float32Array;
          
                    if (positions.length === projected.length * 3) {
             for (let i = 0; i < projected.length; i++) {
               const p = projected[i];
               if (!p) continue;
               positions[i * 3] = (mirrorX ? -p[0] : p[0]) * scale;
               positions[i * 3 + 1] = p[1] * scale;
               positions[i * 3 + 2] = p[2] * scale;
             }
             const posAttr = line.geometry.attributes.position as THREE.BufferAttribute | undefined;
             if (posAttr) posAttr.needsUpdate = true;
          }
          if (line.material instanceof THREE.LineDashedMaterial) {
              line.computeLineDistances();
          }
        }
      });
    }
  };

    public getZHeight(curveName: string, yInches: number, zInches: number, mathEngine: WasmEngine): number {
    if (!this.boardState) return yInches;
    const profile = mathEngine.get_profile_at_z(zInches) as { topY: number, botY: number, apexY: number, tuckY: number };
    if (['outline', 'apexOutline'].includes(curveName)) {
      return profile.apexY;
    }
    if (curveName === 'railOutline') {
      return profile.tuckY;
    }
    if (curveName === 'deckShoulder') {
      return profile.topY;
    }
    if (curveName.startsWith('channel_') && curveName.endsWith('_outline')) {
      return profile.botY;
    }
    if (curveName.startsWith('channel_') && curveName.endsWith('_depth')) {
      return profile.botY - 2.0 + yInches;
    }
        if (curveName.startsWith('crossSection_')) {
      const idx = parseInt(curveName.split('_')[1] || "0", 10);
      const cs = this.boardState.crossSections?.[idx];
      if (cs && cs.controlPoints.length > 0) {
        const rawBot = cs.controlPoints[0]![1];
        const rawTop = cs.controlPoints[cs.controlPoints.length - 1]![1];
        const rawH = Math.max(rawTop - rawBot, 0.0001);
        const worldH = Math.max(profile.topY - profile.botY, 0.0001);
        return profile.botY + ((yInches - rawBot) / rawH) * worldH;
      }
    }
    return yInches;
  }


  
          private sampleBezierCurve(bezier: BezierCurveData, steps: number = 40): [number, number, number][] {
        if (!this.mathEngine) return[];
         
        const flat = this.mathEngine.sample_curve(bezier, steps) as unknown as Float32Array;
        const pts: [number, number, number][] =[];
        for (let i = 0; i < flat.length; i += 3) {
            pts.push([flat[i]!, flat[i + 1]!, flat[i + 2]!]);
        }
        return pts;
    }

  public getXOffset(curveName: string, xInches: number, zInches: number, mathEngine: WasmEngine): number {
      if (curveName === 'apexRocker') {
          const profile = mathEngine.get_profile_at_z(zInches) as { apexX: number };
          return profile.apexX;
      }
      return xInches;
  }

    public previewState(newState: BoardModel) {
    if (!this.mathEngine) return;
    
    const scaleX = newState.width / (this.boardState?.width || 1);
    const scaleY = newState.thickness / (this.boardState?.thickness || 1);
    const scaleZ = newState.length / (this.boardState?.length || 1);

    const oldState = this.boardState;
    this.boardState = newState;

    const scale = 1 / 12;
    
    // Rebuild wireframe
    while (this.wireframeGroup.children.length > 0) {
        const child = this.wireframeGroup.children[0] as THREE.Line;
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
        this.wireframeGroup.remove(child);
    }
    this.buildWireframe(this.mathEngine, scale);

        // Update Gizmos
        if (oldState?.gizmoScaleTop !== newState.gizmoScaleTop ||
        oldState?.gizmoScaleSide !== newState.gizmoScaleSide ||
        oldState?.gizmoScaleProfile !== newState.gizmoScaleProfile ||
        oldState?.gizmoScalePerspective !== newState.gizmoScalePerspective) {
      GizmoBuilder.build(this.gizmoGroup, newState, this.mathEngine, 1/12, this.matAnchor, this.matHandle, this.activeProfileSlice);
      this.updateGizmoHighlights();
    } else {
      this._updateGizmoPositionsFromState();
    }

    // Rebuild Slice Lines and Apex Line
    this.buildSliceLines(this.mathEngine, scale);
    this.buildApexLine(this.mathEngine, scale);

    // Stretch the solid mesh, fins, and annotations visually
    this.solidGroup.scale.set(scaleX, scaleY, scaleZ);
    this.finGroup.scale.set(scaleX, scaleY, scaleZ);
    this.annotationGroup.scale.set(scaleX, scaleY, scaleZ);

    if (newState.showMriView) {
        const pct = newState.mriSlicePosition ?? 50.0;
        const L = newState.length * scale;
        const sliceZ = -L/2 + (L * (pct / 100.0));
        this.mriClippingPlane.normal.set(0, 0, -1);
        this.mriClippingPlane.constant = sliceZ;
    }

    this.boardState = oldState;
  }

  public setHoverPreview(preview: { curve: string, t: number, mirrorX: boolean } | null) {
      this.hoverPreview = preview;
      this.updatePreviewNode();
  }

  private updatePreviewNode() {
      while (this.previewGroup.children.length > 0) {
          const child = this.previewGroup.children[0] as THREE.Mesh;
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
          this.previewGroup.remove(child);
      }
      if (!this.hoverPreview || !this.mathEngine) return;

            const { curve, t, mirrorX } = this.hoverPreview;
      const ptRaw = this.mathEngine.get_point_on_curve(curve, t) as Float32Array | undefined;
      if (!ptRaw) return;

      let x = ptRaw[0] as number;
      let y = ptRaw[1] as number;
      const z = ptRaw[2] as number;

      y = this.getZHeight(curve, y, z, this.mathEngine);
      x = this.getXOffset(curve, x, z, this.mathEngine);

      if (mirrorX) x = -x;

                  const scale = 1/12;
      const isCrossSection = curve.startsWith('crossSection_');
            const isSideView = curve === 'rockerTop' || curve === 'rockerBottom' || curve === 'apexRocker' || (curve.startsWith('channel_') && curve.endsWith('_depth'));
      const isTopView = !isCrossSection && !isSideView;
      
      let scaleX = 1.0;
      let scaleY = 1.0;
      let scaleZ = 1.0;
      let targetLayer = 1;

      let userScale = 1.0;
      if (isCrossSection) {
          userScale = this.boardState?.gizmoScaleProfile ?? 1.0;
      } else if (isSideView) {
          userScale = this.boardState?.gizmoScaleSide ?? 1.0;
      } else if (isTopView) {
          userScale = this.boardState?.gizmoScaleTop ?? 1.0;
      }

            if (isCrossSection) {
          scaleX = (1.0 / 3.5) * userScale;
          scaleY = (1.0 / 3.5) * userScale;
          scaleZ = (1.0 / 3.5) * userScale;
          targetLayer = 3;
      } else if (isSideView) {
          scaleX = userScale;
          scaleY = userScale / 2.5; // Counter-stretch for 2.5x camera Y stretch
          scaleZ = userScale;
          targetLayer = 2;
      } else {
          scaleX = userScale;
          scaleY = userScale;
          scaleZ = userScale;
      }

      const mat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.6, depthTest: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35 * scale, 16, 16), mat);
      mesh.scale.set(scaleX, scaleY, scaleZ);
      mesh.position.set(x * scale, y * scale, z * scale);
      mesh.renderOrder = 1000;
      
      mesh.layers.set(targetLayer);

      this.previewGroup.add(mesh);
  }

        private _updateGizmoPositionsFromState() {
    const mathEngine = this.mathEngine;
    if (!this.boardState || !mathEngine) return;
    const scale = 1 / 12;
        const gizmosByUserData = new Map<string, THREE.Mesh[]>();
    this.gizmoGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData.isGizmo) {
        const { curve, index, type } = child.userData;
        const key = `${curve}-${index}-${type}`;
        if (!gizmosByUserData.has(key)) gizmosByUserData.set(key, []);
        gizmosByUserData.get(key)!.push(child as THREE.Mesh);
      }
    });

        const updatePositionsForCurve = (curveData: BezierCurveData | undefined, curveName: string) => {
      if (!curveData) return;
            curveData.controlPoints.forEach((cp, i) => {
        const cpY = this.getZHeight(curveName, cp[1], cp[2], mathEngine);
        const cpX = this.getXOffset(curveName, cp[0], cp[2], mathEngine);
                gizmosByUserData.get(`${curveName}-${i}-anchor`)?.forEach(mesh => {
            mesh.position.set(cpX * scale, cpY * scale, cp[2] * scale);
        });
        
        const t1 = curveData.tangents1[i]; 
        if (t1) {
          const t1Y = this.getZHeight(curveName, t1[1], t1[2], mathEngine);
          const t1X = this.getXOffset(curveName, t1[0], t1[2], mathEngine);
          gizmosByUserData.get(`${curveName}-${i}-tangent1`)?.forEach(mesh => {
              mesh.position.set(t1X * scale, t1Y * scale, t1[2] * scale);
          });
        }
        
        const t2 = curveData.tangents2[i]; 
        if (t2) {
          const t2Y = this.getZHeight(curveName, t2[1], t2[2], mathEngine);
          const t2X = this.getXOffset(curveName, t2[0], t2[2], mathEngine);
          gizmosByUserData.get(`${curveName}-${i}-tangent2`)?.forEach(mesh => {
              mesh.position.set(t2X * scale, t2Y * scale, t2[2] * scale);
          });
        }
      });
    };
    
    updatePositionsForCurve(this.boardState.outline, 'outline');
    updatePositionsForCurve(this.boardState.rockerTop, 'rockerTop');
    updatePositionsForCurve(this.boardState.rockerBottom, 'rockerBottom');
    updatePositionsForCurve(this.boardState.apexOutline, 'apexOutline');
    updatePositionsForCurve(this.boardState.railOutline, 'railOutline');
                updatePositionsForCurve(this.boardState.apexRocker, 'apexRocker');
        updatePositionsForCurve(this.boardState.deckShoulder, 'deckShoulder');
    this.boardState.crossSections?.forEach((cs, idx) => updatePositionsForCurve(cs, `crossSection_${idx}`));
        this.boardState.outlineLayers?.forEach((layer, idx) => {
        updatePositionsForCurve(layer.otlExt, `outlineLayer_${idx}_ext`);
        updatePositionsForCurve(layer.otlInt, `outlineLayer_${idx}_int`);
    });
        this.boardState.bottomChannels?.forEach((channel, idx) => {
        updatePositionsForCurve(channel.leftOutline, `channel_${idx}_left_outline`);
        updatePositionsForCurve(channel.rightOutline, `channel_${idx}_right_outline`);
        updatePositionsForCurve(channel.leftDepth, `channel_${idx}_left_depth`);
        updatePositionsForCurve(channel.rightDepth, `channel_${idx}_right_depth`);
    });
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
        mat.opacity = isSelected ? 1.0 : 0.5; // Increased from 0.15
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

  private toggleOrtho = () => {
    this.isOrtho = !this.isOrtho;
    this.sceneManager.toggleOrtho();
  };

    override render() {
    const expandIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l-5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    const collapseIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M10 4v6m0 0H4m6 0L3 3"></path></svg>`;
    
    const renderProfileSliceSelector = () => {
      if (!this.boardState?.crossSections || this.boardState.crossSections.length === 0) return '';
      return html`
        <div class="absolute bottom-3 left-3 pointer-events-auto z-50">
          <select 
            class="bg-zinc-950/90 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border border-zinc-800 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            .value=${this.activeProfileSlice.toString()}
            @change=${(e: Event) => {
              this.activeProfileSlice = parseInt((e.target as HTMLSelectElement).value, 10);
              this._updateGeometry();
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
      </div>
    `;
        return html`
      <canvas class="block w-full h-full outline-none"></canvas>
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
        <button type="button" @click=${this.toggleOrtho} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isOrtho ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Toggle Orthographic">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
          <span>Ortho</span>
        </button>
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
          </div>
        `}
      </div>
    `;
  }
}
