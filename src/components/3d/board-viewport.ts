// FILE: src/components/3d/board-viewport.ts
import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoardModel, BezierCurveData } from "../pages/board-builder-page.logic";
import { generateBoardCurves } from "../../lib/client/geometry/board-curves";
import { MeshGeneratorService } from "../../lib/client/geometry/mesh-generator";
import { extractCrossSectionsSS9000 } from "../../lib/client/geometry/manual-baker";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";

@customElement("board-viewport")
export class BoardViewport extends LitElement {
  @property({ type: Object }) boardState?: BoardModel;
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
    }
  `;

  @query("canvas")
  private canvas!: HTMLCanvasElement;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspectiveCamera!: THREE.PerspectiveCamera;
  private topCamera!: THREE.OrthographicCamera;
  private sideCamera!: THREE.OrthographicCamera;
  private profileCamera!: THREE.OrthographicCamera;
  private controls!: OrbitControls;
  private animationId: number = 0;
  private resizeObserver!: ResizeObserver;
  private geometryUpdateDebounceId: number | undefined;
  private wireframeGroup = new THREE.Group();
  private solidGroup = new THREE.Group();
  private finGroup = new THREE.Group();
  private gizmoGroup = new THREE.Group();
  private annotationGroup = new THREE.Group();
  private sliceLinesGroup = new THREE.Group();
    
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private draggedGizmo: THREE.Mesh | null = null;
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private dragStartPos = new THREE.Vector2();
  private activeDragCamera: THREE.Camera | null = null;

  // Reusable materials for performance
  private matAnchor = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
  private matHandle = new THREE.MeshBasicMaterial({ color: 0xa1a1aa, depthTest: false });
  private matSelected = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false }); // Neon Green

  private _boardTexture: THREE.CanvasTexture | null = null;
  private _bumpTexture: THREE.CanvasTexture | null = null;

  private getBoardTextures() {
    if (this._boardTexture && this._bumpTexture) return { map: this._boardTexture, bumpMap: this._bumpTexture };

    // 1. Color & Stringer Map
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    // Warm white foam core
    ctx.fillStyle = '#fdfcf8';
    ctx.fillRect(0, 0, 1024, 1024);

    // Dark wood stringer (U=0.25 and U=0.75 mappings)
    ctx.fillStyle = '#4a3320';
    ctx.fillRect(256 - 3, 0, 6, 1024);
    ctx.fillRect(768 - 3, 0, 6, 1024);

    // Subtle brushed lines (foam cell texture direction)
    ctx.fillStyle = 'rgba(0,0,0,0.02)';
    for (let i = 0; i < 1024; i += 4) {
      ctx.fillRect(0, i, 1024, 1 + Math.random() * 2);
    }

    this._boardTexture = new THREE.CanvasTexture(canvas);
    this._boardTexture.wrapS = THREE.RepeatWrapping;
    this._boardTexture.wrapT = THREE.RepeatWrapping;
    this._boardTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. Bump Map (Micro Foam Cells)
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext('2d')!;
    
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, 512, 512);

    const imgData = bCtx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 40;
      const val = Math.min(255, Math.max(0, 128 + noise));
      imgData.data[i] = val;
      imgData.data[i + 1] = val;
      imgData.data[i + 2] = val;
      imgData.data[i + 3] = 255;
    }
    bCtx.putImageData(imgData, 0, 0);

    this._bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    this._bumpTexture.wrapS = THREE.RepeatWrapping;
    this._bumpTexture.wrapT = THREE.RepeatWrapping;

    return { map: this._boardTexture, bumpMap: this._bumpTexture };
  }

  override firstUpdated() {
    this.initThree();
  }

  private _updateGizmoPositionsFromState() {
    if (!this.boardState || this.boardState.editMode !== 'manual') return;

    const scale = 1 / 12;
    const gizmosByUserData = new Map<string, THREE.Mesh>();
    this.gizmoGroup.children.forEach(child => {
      if (child instanceof THREE.Mesh && child.userData.isGizmo) {
        const { curve, index, type } = child.userData;
        const key = `${curve}-${index}-${type}`;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        gizmosByUserData.set(key, child);
      }
    });

    const updatePositionsForCurve = (curveData: BezierCurveData | undefined, curveName: string) => {
      if (!curveData) return;
      for (let i = 0; i < curveData.controlPoints.length; i++) {
        const cp = curveData.controlPoints[i]!;
        const t1 = curveData.tangents1[i];
        const t2 = curveData.tangents2[i];

        const anchorKey = `${curveName}-${i}-anchor`;
        gizmosByUserData.get(anchorKey)?.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);

        if (t1) {
          const t1Key = `${curveName}-${i}-tangent1`;
          gizmosByUserData.get(t1Key)?.position.set(t1[0] * scale, t1[1] * scale, t1[2] * scale);
        }
        if (t2) {
          const t2Key = `${curveName}-${i}-tangent2`;
          gizmosByUserData.get(t2Key)?.position.set(t2[0] * scale, t2[1] * scale, t2[2] * scale);
        }
      }
    };

    updatePositionsForCurve(this.boardState.manualOutline, 'outline');
    updatePositionsForCurve(this.boardState.manualRockerTop, 'rockerTop');
    updatePositionsForCurve(this.boardState.manualRockerBottom, 'rockerBottom');
    this.boardState.manualCrossSections?.forEach((cs, idx) => {
      updatePositionsForCurve(cs, `crossSection_${idx}`);
    });
  }

  override updated(changedProperties: PropertyValues) {
    if (changedProperties.has("boardState") && this.boardState) {
      const oldState = changedProperties.get("boardState") as BoardModel | undefined;
      let needsFullGeometryUpdate = false;
      let isManualDragUpdate = false;

      if (oldState) {
        // Determine what kind of update is needed
        for (const key in this.boardState) {
          const k = key as keyof BoardModel;
          if (this.boardState[k] !== oldState[k]) {
            if (k === 'manualOutline' || k === 'manualRockerTop' || k === 'manualRockerBottom' || k === 'manualCrossSections') {
              isManualDragUpdate = true;
            } else if (k !== 'volume' && k !== 'selectedNode' && k !== 'showGizmos') {
              needsFullGeometryUpdate = true;
              isManualDragUpdate = false; // A parametric change overrides a drag
              break;
            }
          }
        }
      } else {
        // First render
        needsFullGeometryUpdate = true;
      }

      if (needsFullGeometryUpdate) {
        clearTimeout(this.geometryUpdateDebounceId);
        void this._updateGeometry(); // Parametric changes are instant
      } else if (isManualDragUpdate) {
        // For manual dragging, only update gizmo positions instantly
        this._updateGizmoPositionsFromState();
        
        // Debounce the heavy mesh regeneration
        clearTimeout(this.geometryUpdateDebounceId);
        this.geometryUpdateDebounceId = window.setTimeout(() => {
          void this._updateGeometry();
        }, 150); // 150ms delay after the last drag event
      } else {
        // Handle minor updates that don't need geometry regeneration
        if (oldState?.showGizmos !== this.boardState.showGizmos) this.updateGizmoVisibility();
        if (oldState?.selectedNode !== this.boardState.selectedNode) this.updateGizmoHighlights();
      }
    }
  }

  private async _updateGeometry() {
    if (!this.boardState) return;
    
    const curves = await generateBoardCurves(this.boardState);
    if (!curves.outline || curves.outline.length === 0) return;
    
    // clear old geometry properly
    while (this.wireframeGroup.children.length > 0) {
        const child = this.wireframeGroup.children[0] as THREE.Line;
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
        } else {
            child.material.dispose();
        }
        this.wireframeGroup.remove(child);
    }

    const matOutline = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.15 });
    const matRocker = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.15 });

    const scale = 1 / 12; // Inches to Feet for Three.js coordinates

    const buildLine = (pts: [number, number, number][], mat: THREE.LineBasicMaterial, layerIndex: number, mirrorX = false, followRocker = false) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            const zInches = p[2];
            const profile = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, zInches);
            
            vertices[i*3] = (mirrorX ? -p[0] : p[0]) * scale;
            if (this.boardState!.editMode === "manual") {
                // In manual mode, snap wireframe directly to the evaluated outline
                vertices[i*3] = (mirrorX ? -profile.halfWidth : profile.halfWidth) * scale;
            }
            
            if (followRocker) {
                // Wrap the 2D outline along the rail profile
                vertices[i*3+1] = profile.apexY * scale;
            } else {
                // Rocker lines. For accurate manual preview, we could map them to topY/botY
                // but since they are drawn flat in the Z-Y plane, we leave p[1]
                vertices[i*3+1] = p[1] * scale;
            }
            
            vertices[i*3+2] = zInches * scale;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const line = new THREE.Line(geometry, mat);
        line.layers.set(layerIndex);
        return line;
    };

    // Render outline wrapping the rails (Layer 1), and rocker staying normal (Layer 2)
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, 1, false, true));
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, 1, true, true)); 
    this.wireframeGroup.add(buildLine(curves.rockerTop, matRocker, 2, false, false));
    this.wireframeGroup.add(buildLine(curves.rockerBottom, matRocker, 2, false, false));

    // Handle Solid Mesh Rendering
    while (this.solidGroup.children.length > 0) {
        const child = this.solidGroup.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
        this.solidGroup.remove(child);
    }

    if (this.boardState) {
        // Delegate all heavy math to the decoupled MeshGeneratorService
        const meshData = MeshGeneratorService.generateMesh(this.boardState, curves);

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(meshData.vertices, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
        geom.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        geom.computeVertexNormals();

        // Dispatch volume event safely
        if (Math.abs(this.boardState.volume - meshData.volumeLiters) > 0.05) {
            this.dispatchEvent(new CustomEvent("volume-calculated", {
                detail: { volume: meshData.volumeLiters },
                bubbles: true,
                composed: true
            }));
        }

        const { map, bumpMap } = this.getBoardTextures();

        const standardMat = new THREE.MeshPhysicalMaterial({ 
            map: map,
            bumpMap: bumpMap,
            bumpScale: 0.005,
            roughness: 0.4, // Foam core is rough under the resin
            metalness: 0.0,
            clearcoat: 1.0, // High-gloss resin shell
            clearcoatRoughness: 0.05, // Flawlessly sanded finish
            ior: 1.5, // Refractive index of epoxy resin
            side: THREE.DoubleSide
        });

        const heatmapMat = new THREE.MeshStandardMaterial({ 
            vertexColors: true, 
            roughness: 0.8,
            side: THREE.DoubleSide 
        });

        const mesh = new THREE.Mesh(geom, this.boardState.showHeatmap ? heatmapMat : standardMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.layers.set(0);
        this.solidGroup.add(mesh);

        // --- Blueprint Mesh for Orthographic Layers (Layer 5) ---
        const blueprintMat = new THREE.MeshBasicMaterial({
            color: 0x09090b, // Match background to act as occlusion mask
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            side: THREE.DoubleSide
        });
        const blueprintMesh = new THREE.Mesh(geom, blueprintMat);
        blueprintMesh.layers.set(5);

        const edgesGeo = new THREE.EdgesGeometry(geom, 15);
        const edgesMat = new THREE.LineBasicMaterial({
            color: 0x3b82f6, // Blue blueprint lines
            transparent: true,
            opacity: 0.4
        });
        const blueprintEdges = new THREE.LineSegments(edgesGeo, edgesMat);
        blueprintEdges.layers.set(5);

        this.solidGroup.add(blueprintMesh);
        this.solidGroup.add(blueprintEdges);

        // --- STEP 6: Fin Placement & Rendering ---
        while (this.finGroup.children.length > 0) {
            const child = this.finGroup.children[0] as THREE.Mesh;
            if (child.geometry) child.geometry.dispose();
            if (child.material) (child.material as THREE.Material).dispose();
            this.finGroup.remove(child);
        }

        const createFinMesh = (isSmall: boolean = false, isBlueprint: boolean = false) => {
            const shape = new THREE.Shape();
            const base = isSmall ? 3.5 * scale : 4.5 * scale;
            const height = isSmall ? 4.0 * scale : 4.75 * scale;
            const sweep = isSmall ? 2.0 * scale : 2.5 * scale; 
            
            // Draw realistic Swept Fin Profile
            const leadX = base / 2;
            const trailX = -base / 2;
            const tipX = trailX + sweep; // Sweep back towards tail
            
            shape.moveTo(trailX, 0); // Trailing edge base
            // Trailing edge curve (sweeping back and up to tip)
            shape.quadraticCurveTo(trailX + sweep * 0.8, height * 0.4, tipX, height);
            // Leading edge curve (sweeping from tip down to leading base)
            shape.quadraticCurveTo(leadX + sweep * 0.2, height * 0.5, leadX, 0);
            shape.lineTo(trailX, 0); // Close base

            // Extrude with thin core and bevel to create an aerodynamic foil
            const geom = new THREE.ExtrudeGeometry(shape, { 
                depth: 0.05 * scale, 
                bevelEnabled: true, 
                bevelThickness: 0.08 * scale, 
                bevelSize: 0.05 * scale, 
                bevelSegments: 4 
            });
            
            // Center the thickness perfectly
            geom.translate(0, 0, -0.025 * scale);
            
            let mat;
            if (isBlueprint) {
                mat = new THREE.MeshBasicMaterial({
                    color: 0x09090b,
                    depthWrite: true,
                    polygonOffset: true,
                    polygonOffsetFactor: 1,
                    polygonOffsetUnits: 1
                });
            } else {
                mat = new THREE.MeshPhysicalMaterial({ 
                    color: 0xf8fafc, 
                    roughness: 0.15, 
                    transmission: 0.9,
                    thickness: 0.2,
                    ior: 1.5
                });
            }
            
            const finMesh = new THREE.Mesh(geom, mat);
            
            if (isBlueprint) {
                finMesh.layers.set(5);
                const edgesGeo = new THREE.EdgesGeometry(geom, 15);
                const edgesMat = new THREE.LineBasicMaterial({
                    color: 0x3b82f6,
                    transparent: true,
                    opacity: 0.6
                });
                const finEdges = new THREE.LineSegments(edgesGeo, edgesMat);
                finEdges.layers.set(5);
                finMesh.add(finEdges);
            } else {
                finMesh.castShadow = true;
                finMesh.layers.set(0);
            }
            
            // 1. Flip upside down so tip points down into the water (-Y)
            // 2. Rotate 90deg so leading edge (+X in shape) points towards the board's nose (-Z)
            finMesh.rotation.set(Math.PI, -Math.PI / 2, 0);
            return finMesh;
        };

        const mountFin = (zFromTail: number, railOffset: number, isRight: boolean, isCenter: boolean, isSmall: boolean) => {
            // 1. Create the perfectly oriented local fin meshes
            const finSolid = createFinMesh(isSmall, false);
            const finBlueprint = createFinMesh(isSmall, true);
            
            // 2. Wrap it in a container so Toe and Cant rotations don't conflict
            const finContainer = new THREE.Group();
            finContainer.add(finSolid);
            finContainer.add(finBlueprint);

            // 3. Position the container on the board
            const zLoc = (this.boardState!.length / 2) - zFromTail;
            const profile = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, zLoc);
            const xPos = isCenter ? 0 : (profile.halfWidth - railOffset);
            const actualX = isRight ? xPos : -xPos;
            const yPos = MeshGeneratorService.getBottomYAt(this.boardState!, curves, actualX, zLoc);

            finContainer.position.set(actualX * scale, yPos * scale, zLoc * scale);
            
            // 4. Align to Rocker (pitch) but ignore local Concave/Channel slope for absolute Cant & Pitch control
            // Real fin boxes are routed relative to the board's baseline rocker, not the steep local ramps of channels.
            const delta = 0.5;
            
            const pitchYC = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, zLoc).botY;
            const pitchYF = MeshGeneratorService.getBoardProfileAtZ(this.boardState!, curves, zLoc - delta).botY;
            
            const pRockerC = new THREE.Vector3(actualX, pitchYC, zLoc);
            const pRockerF = new THREE.Vector3(actualX, pitchYF, zLoc - delta);
            
            const vForward = new THREE.Vector3().subVectors(pRockerF, pRockerC).normalize();
            const vBackward = vForward.clone().negate();
            
            // Assume "absolute up" relative to the board deck is the Y axis
            const absoluteUp = new THREE.Vector3(0, 1, 0);
            
            // Calculate a horizontal Right vector (ignoring the concave's side-to-side slope)
            const vRight = new THREE.Vector3().crossVectors(absoluteUp, vBackward).normalize();
            
            // Recalculate true local Up orthogonal to the Rocker pitch
            const vUp = new THREE.Vector3().crossVectors(vBackward, vRight).normalize();
            
            const rotationMatrix = new THREE.Matrix4().makeBasis(vRight, vUp, vBackward);
            finContainer.rotation.setFromRotationMatrix(rotationMatrix);
            
            // 5. Apply Toe and Cant locally to the perfectly flush container
            if (!isCenter) {
                const cantRad = this.boardState!.cantAngle * Math.PI / 180;
                const toeRad = this.boardState!.toeAngle * Math.PI / 180;
                
                // Cant: Tilt outward around Z axis (Tip moves away from stringer)
                finContainer.rotateZ(isRight ? cantRad : -cantRad);
                // Toe: Angle inward around Y axis (Leading edge points toward stringer)
                finContainer.rotateY(isRight ? toeRad : -toeRad);
            }
            
            this.finGroup.add(finContainer);
        };

        // Mount Front Fins
        mountFin(this.boardState.frontFinZ, this.boardState.frontFinX, true, false, false);
        mountFin(this.boardState.frontFinZ, this.boardState.frontFinX, false, false, false);

        // Mount Rear Fins
        if (this.boardState.finSetup === "quad") {
            mountFin(this.boardState.rearFinZ, this.boardState.rearFinX, true, false, true);
            mountFin(this.boardState.rearFinZ, this.boardState.rearFinX, false, false, true);
        } else if (this.boardState.finSetup === "thruster") {
            mountFin(this.boardState.rearFinZ, 0, true, true, false);
        }
        
        // --- STEP 7: Gizmos (Manual Mode Only) ---
        while (this.gizmoGroup.children.length > 0) {
            const child = this.gizmoGroup.children[0] as THREE.Mesh | THREE.Line;
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
            this.gizmoGroup.remove(child);
        }

        if (this.boardState.editMode === "manual") {
            runClientUnscoped(clientLog("info", "[BoardViewport] Rendering manual Bezier Gizmos"));

            const anchorGeo = new THREE.SphereGeometry(0.4 * scale, 16, 16);
            const handleGeo = new THREE.BoxGeometry(0.3 * scale, 0.3 * scale, 0.3 * scale);
            const lineMat = new THREE.LineDashedMaterial({ color: 0x52525b, dashSize: 0.5 * scale, gapSize: 0.5 * scale, depthTest: false });

            const drawGizmosForCurve = (curve: BezierCurveData | undefined, curveName: string, layerIndex: number) => {
                if (!curve) return;
                for (let i = 0; i < curve.controlPoints.length; i++) {
                    const cp = curve.controlPoints[i]!;
                    const t1 = curve.tangents1[i];
                    const t2 = curve.tangents2[i];

                    // Draw Anchor
                    const anchorMesh = new THREE.Mesh(anchorGeo, this.matAnchor);
                    anchorMesh.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);
                    anchorMesh.renderOrder = 999;
                    anchorMesh.layers.set(layerIndex);
                    anchorMesh.userData = { 
                        isGizmo: true, 
                        type: 'anchor', 
                        curve: curveName, 
                        index: i,
                        maxIndex: curve.controlPoints.length - 1,
                        origZ: cp[2]
                    };
                    this.gizmoGroup.add(anchorMesh);

                    const drawHandle = (t: [number, number, number], handleType: string) => {
                        // Don't draw handles if they are completely collapsed onto the anchor
                        if (Math.abs(t[0]-cp[0]) < 0.001 && Math.abs(t[1]-cp[1]) < 0.001 && Math.abs(t[2]-cp[2]) < 0.001) return;

                        const handleMesh = new THREE.Mesh(handleGeo, this.matHandle);
                        handleMesh.position.set(t[0] * scale, t[1] * scale, t[2] * scale);
                        handleMesh.renderOrder = 999;
                        handleMesh.layers.set(layerIndex);
                        handleMesh.userData = { 
                            isGizmo: true, 
                            type: handleType, 
                            curve: curveName, 
                            index: i,
                            maxIndex: curve.controlPoints.length - 1,
                            origZ: t[2]
                        };
                        this.gizmoGroup.add(handleMesh);

                        const lineGeo = new THREE.BufferGeometry().setFromPoints([
                            new THREE.Vector3(cp[0] * scale, cp[1] * scale, cp[2] * scale),
                            new THREE.Vector3(t[0] * scale, t[1] * scale, t[2] * scale)
                        ]);
                        const line = new THREE.Line(lineGeo, lineMat);
                        line.computeLineDistances();
                        line.renderOrder = 998;
                        line.layers.set(layerIndex);
                        this.gizmoGroup.add(line);
                    };

                    if (t1) drawHandle(t1, 'tangent1');
                    if (t2) drawHandle(t2, 'tangent2');
                }
            };

            drawGizmosForCurve(this.boardState.manualOutline, 'outline', 1);
            drawGizmosForCurve(this.boardState.manualRockerTop, 'rockerTop', 2);
            drawGizmosForCurve(this.boardState.manualRockerBottom, 'rockerBottom', 2);
            
            if (this.boardState.manualCrossSections) {
                this.boardState.manualCrossSections.forEach((cs, idx) => {
                    drawGizmosForCurve(cs, `crossSection_${idx}`, 3);
                });
            }
        }
        
        // --- STEP 6.5: Ghosted Slices (Foil Flow View) ---
        while (this.sliceLinesGroup.children.length > 0) {
            const child = this.sliceLinesGroup.children[0] as THREE.Line;
            if (child.geometry) child.geometry.dispose();
            if (child.material) (child.material as THREE.Material).dispose();
            this.sliceLinesGroup.remove(child);
        }

        let crossSections: BezierCurveData[] =[];
        if (this.boardState.editMode === "manual" && this.boardState.manualCrossSections) {
            crossSections = this.boardState.manualCrossSections;
        } else {
            crossSections = extractCrossSectionsSS9000(this.boardState, curves);
        }

        const sampleBezierCurveData = (bezier: BezierCurveData, steps: number = 40): THREE.Vector3[] => {
            const pts: THREE.Vector3[] =[];
            const numSegments = bezier.controlPoints.length - 1;
            if (numSegments <= 0) return pts;
            
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const scaledT = t * numSegments;
                let segmentIdx = Math.floor(scaledT);
                if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
                const localT = scaledT - segmentIdx;
                
                const P0 = bezier.controlPoints[segmentIdx]!;
                const P1 = bezier.controlPoints[segmentIdx + 1]!;
                const T0 = bezier.tangents2[segmentIdx]!;
                const T1 = bezier.tangents1[segmentIdx + 1]!;
                
                const u = 1 - localT;
                const tt = localT * localT;
                const uu = u * u;
                const uuu = uu * u;
                const ttt = tt * localT;
                
                const x = uuu * P0[0] + 3 * uu * localT * T0[0] + 3 * u * tt * T1[0] + ttt * P1[0];
                const y = uuu * P0[1] + 3 * uu * localT * T0[1] + 3 * u * tt * T1[1] + ttt * P1[1];
                const z = uuu * P0[2] + 3 * uu * localT * T0[2] + 3 * u * tt * T1[2] + ttt * P1[2];
                
                pts.push(new THREE.Vector3(x * scale, y * scale, z * scale));
            }
            return pts;
        };

        crossSections.forEach((cs, idx) => {
            const rightPts = sampleBezierCurveData(cs);
            // Mirror across X-axis to create the left side of the slice
            const leftPts = rightPts.map(p => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
            
            // Remove duplicate bottom stringer point where the two halves meet
            leftPts.pop(); 
            const fullPts = [...leftPts, ...rightPts];
            if (fullPts[0]) fullPts.push(fullPts[0].clone()); // Close the loop precisely at the deck stringer

            const geo = new THREE.BufferGeometry().setFromPoints(fullPts);
            
            // Calculate gradient from Blue (Nose) to Red (Tail)
            const hue = 0.66 * (1 - (idx / (crossSections.length - 1)));
            const color = new THREE.Color().setHSL(hue, 0.8, 0.6);
            
            const mat = new THREE.LineBasicMaterial({ 
                color: color, 
                transparent: true, 
                opacity: 0.6,
                depthWrite: false
            });
            
            const line = new THREE.Line(geo, mat);
            line.layers.set(3); // Render only to Perspective & Profile cameras
            line.userData = { isSlice: true, curveName: `crossSection_${idx}`, defaultColor: color.getHex() };
            this.sliceLinesGroup.add(line);
        });

        this.updateGizmoVisibility();
        this.updateGizmoHighlights();

        // --- STEP 8: Dynamic Dimension Annotations ---
        while (this.annotationGroup.children.length > 0) {
            const child = this.annotationGroup.children[0] as THREE.Line | THREE.Sprite;
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (child instanceof THREE.Sprite && child.material.map) child.material.map.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
            this.annotationGroup.remove(child);
        }

        const createTextSprite = (text: string) => {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 128;
            const ctx = canvas.getContext('2d')!;
            ctx.font = 'bold 42px monospace';
            ctx.fillStyle = '#60a5fa'; // Tailwind blue-400
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, 128, 64);
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.minFilter = THREE.LinearFilter;
            const spriteMaterial = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(1.5, 0.75, 1.0);
            // Attach metadata for E2E testing
            sprite.userData = { isAnnotation: true, text };
            return sprite;
        };

        const createDimLine = (p1: THREE.Vector3, p2: THREE.Vector3, tickDir: THREE.Vector3, tickLen: number) => {
            const pts =[
                new THREE.Vector3().copy(p1).addScaledVector(tickDir, tickLen),
                new THREE.Vector3().copy(p1).addScaledVector(tickDir, -tickLen),
                p1,
                p2,
                new THREE.Vector3().copy(p2).addScaledVector(tickDir, tickLen),
                new THREE.Vector3().copy(p2).addScaledVector(tickDir, -tickLen)
            ];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false, transparent: true, opacity: 0.6 });
            return new THREE.Line(geo, mat);
        };

        const addDim = (text: string, p1: THREE.Vector3, p2: THREE.Vector3, tickDir: THREE.Vector3, layer: number, textOffset: THREE.Vector3) => {
            const line = createDimLine(p1, p2, tickDir, 0.5 * scale);
            line.layers.set(layer);
            this.annotationGroup.add(line);

            const sprite = createTextSprite(text);
            const midPoint = new THREE.Vector3().lerpVectors(p1, p2, 0.5).add(textOffset);
            sprite.position.copy(midPoint);
            sprite.layers.set(layer);
            this.annotationGroup.add(sprite);
        };

        const L = this.boardState.length * scale;
        const W = this.boardState.width * scale;
        const T = this.boardState.thickness * scale;
        const pad = 4.0 * scale; // 4 inches padding off the board edge

        // Top View (Layer 6) - Length & Width
        addDim(`${this.boardState.length.toFixed(1)}"`, new THREE.Vector3(W/2 + pad, 0, -L/2), new THREE.Vector3(W/2 + pad, 0, L/2), new THREE.Vector3(1, 0, 0), 6, new THREE.Vector3(1.2 * scale, 0, 0));
        addDim(`${this.boardState.width.toFixed(2)}"`, new THREE.Vector3(-W/2, 0, L/2 + pad), new THREE.Vector3(W/2, 0, L/2 + pad), new THREE.Vector3(0, 0, 1), 6, new THREE.Vector3(0, 0, 1.0 * scale));

        // Side View (Layer 7) - Length & Thickness
        addDim(`${this.boardState.length.toFixed(1)}"`, new THREE.Vector3(0, -T/2 - pad, -L/2), new THREE.Vector3(0, -T/2 - pad, L/2), new THREE.Vector3(0, 1, 0), 7, new THREE.Vector3(0, -1.0 * scale, 0));
        // Side view is looking down X axis (from +X), so -Z is to the Right. Shift text Right.
        addDim(`${this.boardState.thickness.toFixed(2)}"`, new THREE.Vector3(0, -T/2, 0), new THREE.Vector3(0, T/2, 0), new THREE.Vector3(0, 0, 1), 7, new THREE.Vector3(0, 0, -1.5 * scale));

        // Profile View (Layer 8) - Width & Thickness
        addDim(`${this.boardState.width.toFixed(2)}"`, new THREE.Vector3(-W/2, -T/2 - pad, 0), new THREE.Vector3(W/2, -T/2 - pad, 0), new THREE.Vector3(0, 1, 0), 8, new THREE.Vector3(0, -1.0 * scale, 0));
        addDim(`${this.boardState.thickness.toFixed(2)}"`, new THREE.Vector3(W/2 + pad, -T/2, 0), new THREE.Vector3(W/2 + pad, T/2, 0), new THREE.Vector3(1, 0, 0), 8, new THREE.Vector3(1.5 * scale, 0, 0));
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.animationId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.renderer) this.renderer.dispose();
    if (this.controls) this.controls.dispose();

    if (this.canvas) {
      this.canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
      this.canvas.removeEventListener("pointermove", this.onPointerMove);
      this.canvas.removeEventListener("pointerup", this.onPointerUp);
      this.canvas.removeEventListener("pointercancel", this.onPointerUp);
      this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    }
  }

  private initThree() {
    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090b); // matches zinc-950

    // 2. Camera setup
    // Each quadrant will have half the width and half the height, so the aspect ratio of a quadrant is the same as the full canvas.
    const aspect = this.clientWidth / this.clientHeight;
    this.perspectiveCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    // Look down the Nose (-Z axis) so the front of the board is in the foreground
    this.perspectiveCamera.position.set(-6, 4, -6);

    const frustumSize = 10;
    const orthoLeft = -frustumSize * aspect / 2;
    const orthoRight = frustumSize * aspect / 2;
    const orthoTop = frustumSize / 2;
    const orthoBottom = -frustumSize / 2;

    this.topCamera = new THREE.OrthographicCamera(orthoLeft, orthoRight, orthoTop, orthoBottom, 0.1, 1000);
    this.topCamera.position.set(0, 10, 0);
    this.topCamera.up.set(0, 0, -1);
    this.topCamera.lookAt(0, 0, 0);
    // Layer 1 (Outline Gizmos) + Layer 5 (Blueprint Mesh) + Layer 6 (Top Grid)
    this.topCamera.layers.disableAll();
    this.topCamera.layers.enable(1);
    this.topCamera.layers.enable(5);
    this.topCamera.layers.enable(6);

    this.sideCamera = new THREE.OrthographicCamera(orthoLeft, orthoRight, orthoTop, orthoBottom, 0.1, 1000);
    this.sideCamera.position.set(10, 0, 0);
    this.sideCamera.up.set(0, 1, 0);
    this.sideCamera.lookAt(0, 0, 0);
    // Layer 2 (Rocker Gizmos) + Layer 5 (Blueprint Mesh) + Layer 7 (Side Grid)
    this.sideCamera.layers.disableAll();
    this.sideCamera.layers.enable(2);
    this.sideCamera.layers.enable(5);
    this.sideCamera.layers.enable(7);

    this.profileCamera = new THREE.OrthographicCamera(orthoLeft, orthoRight, orthoTop, orthoBottom, 0.1, 1000);
    this.profileCamera.position.set(0, 0, -10);
    this.profileCamera.up.set(0, 1, 0);
    this.profileCamera.lookAt(0, 0, 0);
    // Layer 3 (Slice Lines & Gizmos) + Layer 8 (Profile Grid)
    // We explicitly exclude Layer 5 so the Ghosted Slices are fully visible without the solid mesh blocking them
    this.profileCamera.layers.disableAll();
    this.profileCamera.layers.enable(3);
    this.profileCamera.layers.enable(8);

    // Perspective Camera sees everything EXCEPT the blueprint layer and CAD grids
    this.perspectiveCamera.layers.enableAll();
    this.perspectiveCamera.layers.disable(5);
    this.perspectiveCamera.layers.disable(6);
    this.perspectiveCamera.layers.disable(7);
    this.perspectiveCamera.layers.disable(8);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.clientWidth, this.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 4. Environment & Lighting
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 8, -5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 50;
    dirLight.shadow.camera.left = -5;
    dirLight.shadow.camera.right = 5;
    dirLight.shadow.camera.top = 5;
    dirLight.shadow.camera.bottom = -5;
    dirLight.shadow.bias = -0.001;
    this.scene.add(dirLight);

    // 5. Shadow Catcher Floor
    const floorGeo = new THREE.PlaneGeometry(50, 50);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.5 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.0; // Place floor roughly 12 inches below origin to catch shadows without clipping rails
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 6. Controls
    this.controls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    // 7. Groups & Grid
    this.scene.add(this.wireframeGroup);
    this.scene.add(this.solidGroup);
    this.scene.add(this.finGroup);
    this.scene.add(this.gizmoGroup);
    this.scene.add(this.annotationGroup);
    this.scene.add(this.sliceLinesGroup);

    const createCADGrid = (layer: number, rotationX: number, rotationZ: number, positionOffset: THREE.Vector3) => {
        const group = new THREE.Group();
        
        // 20 ft board area (scale is 1 unit = 1 foot)
        const major = new THREE.GridHelper(20, 20, 0x3f3f46, 0x27272a); 
        const minor = new THREE.GridHelper(20, 80, 0x27272a, 0x18181b); // 3-inch increments
        
        // Push grids behind transparent objects to prevent depth-fighting
        major.renderOrder = -1;
        minor.renderOrder = -1;
        
        const majorMat = major.material;
        const minorMat = minor.material;
        
        majorMat.depthWrite = false;
        minorMat.depthWrite = false;
        majorMat.transparent = true;
        minorMat.transparent = true;
        majorMat.opacity = 0.5;
        minorMat.opacity = 0.3;
        
        group.add(major);
        group.add(minor);
        
        group.rotation.x = rotationX;
        group.rotation.z = rotationZ;
        group.position.copy(positionOffset);
        
        group.traverse(child => {
            child.layers.set(layer);
        });
        
        return group;
    };

    // Top Grid (Layer 6) - Faces Y, sits below the board
    const topGrid = createCADGrid(6, 0, 0, new THREE.Vector3(0, -2, 0));
    
    // Side Grid (Layer 7) - Faces X, sits behind the board from sideCamera (X=10 looking at X=0)
    const sideGrid = createCADGrid(7, 0, Math.PI / 2, new THREE.Vector3(-2, 0, 0));
    
    // Profile Grid (Layer 8) - Faces Z, sits behind the board from profileCamera (Z=-10 looking at Z=0)
    const profileGrid = createCADGrid(8, Math.PI / 2, 0, new THREE.Vector3(0, 0, 5));

    this.scene.add(topGrid);
    this.scene.add(sideGrid);
    this.scene.add(profileGrid);

    // 8. Handle Resize
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this);

    // 9. Event Listeners for Gizmos
    // Use capture for pointerdown so we can disable OrbitControls before it handles the event
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);

    // 10. Start Loop
    this.renderLoop();
  }

  private getQuadrantCameraAndMouse(e: PointerEvent): { camera: THREE.Camera, mouse: THREE.Vector2 } {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const w = rect.width / 2;
    const h = rect.height / 2;

    let camera: THREE.Camera;
    let localX: number;
    let localY: number;

    if (x < w && y >= h) { // Bottom Left
        camera = this.sideCamera;
        localX = (x / w) * 2 - 1;
        localY = -((y - h) / (rect.height - h)) * 2 + 1;
    } else if (x >= w && y >= h) { // Bottom Right
        camera = this.profileCamera;
        localX = ((x - w) / (rect.width - w)) * 2 - 1;
        localY = -((y - h) / (rect.height - h)) * 2 + 1;
    } else if (x < w && y < h) { // Top Left
        camera = this.topCamera;
        localX = (x / w) * 2 - 1;
        localY = -(y / h) * 2 + 1;
    } else { // Top Right
        camera = this.perspectiveCamera;
        localX = ((x - w) / (rect.width - w)) * 2 - 1;
        localY = -(y / h) * 2 + 1;
    }

    return { camera, mouse: new THREE.Vector2(localX, localY) };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.dragStartPos.set(e.clientX, e.clientY);

    const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
    
    // Only allow orbiting if clicking in the perspective quadrant
    this.controls.enabled = (camera === this.perspectiveCamera);

    if (this.boardState?.editMode !== 'manual' || this.boardState?.showGizmos === false) return;

    this.mouse.copy(mouse);
    this.raycaster.setFromCamera(this.mouse, camera);
    this.raycaster.layers.mask = camera.layers.mask;
    
    // Intersect only with gizmos
    const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
    const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isGizmo);

    if (hit) {
      this.draggedGizmo = hit.object as THREE.Mesh;
      this.activeDragCamera = camera;
      this.controls.enabled = false; // Disable camera orbit while dragging
      
      // Calculate a mathematical plane based on the curve type to prevent projection slipping
      const curveName = this.draggedGizmo.userData.curve as string;
      const planeNormal = new THREE.Vector3();
      
      if (curveName === 'outline') {
        planeNormal.set(0, 1, 0); // XZ plane
      } else if (curveName.startsWith('rocker')) {
        planeNormal.set(1, 0, 0); // YZ plane
      } else if (curveName.startsWith('crossSection')) {
        planeNormal.set(0, 0, 1); // XY plane
      } else {
        camera.getWorldDirection(planeNormal).negate(); // Fallback
      }
      
      this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.draggedGizmo.position);
      
      // Calculate the exact click offset from the center of the gizmo to prevent snapping
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragOffset)) {
        this.dragOffset.sub(this.draggedGizmo.position);
      }
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.draggedGizmo || !this.activeDragCamera) return;
    
    // To make dragging smooth even if the mouse leaves the original quadrant, 
    // we recalculate the local coords relative to the activeDragCamera's quadrant bounds.
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width / 2;
    const h = rect.height / 2;
    
    if (this.activeDragCamera === this.topCamera) {
      this.mouse.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    } else if (this.activeDragCamera === this.perspectiveCamera) {
      this.mouse.set(((x - w) / (rect.width - w)) * 2 - 1, -(y / h) * 2 + 1);
    } else if (this.activeDragCamera === this.sideCamera) {
      this.mouse.set((x / w) * 2 - 1, -((y - h) / (rect.height - h)) * 2 + 1);
    } else { // profileCamera
      this.mouse.set(((x - w) / (rect.width - w)) * 2 - 1, -((y - h) / (rect.height - h)) * 2 + 1);
    }

    this.raycaster.setFromCamera(this.mouse, this.activeDragCamera);
    const target = new THREE.Vector3();
    
    if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
      target.sub(this.dragOffset);
      
      // Scale coordinates back from Three.js World (Feet) to Application Logic (Inches)
      const inInches = target.clone().multiplyScalar(12);

      // --- STEP 4: Planar & Stringer UX Locks ---
      const userData = this.draggedGizmo.userData as {
        isGizmo: boolean;
        type: 'anchor' | 'tangent1' | 'tangent2';
        curve: string;
        index: number;
        maxIndex: number;
        origZ: number;
      };
      const curveName = userData.curve;
      const isEndNode = userData.index === 0 || userData.index === userData.maxIndex;

      if (curveName === 'outline') inInches.y = 0;
      if (curveName === 'rockerTop' || curveName === 'rockerBottom') inInches.x = 0;
      if (curveName.startsWith('crossSection_')) inInches.z = userData.origZ;

      if ((curveName === 'rockerTop' || curveName === 'rockerBottom') && isEndNode) {
        inInches.x = 0; // Lock nose/tail to stringer for rockers only (allow wide tails in outline)
      }

      // Apply constrained coordinates back to visual target
      target.copy(inInches).multiplyScalar(1/12);
      
      // Update gizmo position instantly for fluid UI feedback
      this.draggedGizmo.position.copy(target);
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    const dist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);

    if (this.draggedGizmo) {
      if (dist >= 5) {
        // It was a drag. Get the final position and dispatch the single state update.
        const finalPosInches = this.draggedGizmo.position.clone().multiplyScalar(12);
        this.dispatchEvent(new CustomEvent('gizmo-dragged', {
          detail: {
            userData: this.draggedGizmo.userData,
            position: [finalPosInches.x, finalPosInches.y, finalPosInches.z]
          },
          bubbles: true, composed: true
        }));
        
        // Now dispatch the event to save the history snapshot.
        this.dispatchEvent(new CustomEvent('gizmo-drag-ended', {
          bubbles: true, composed: true
        }));
      }
      
      this.draggedGizmo = null;
      this.activeDragCamera = null;
    }
    
    // Always re-enable controls if mouse goes up (though we dynamically restrict it on pointer down anyway)
    this.controls.enabled = true;

    // Click detection for selection (if mouse barely moved)
    if (this.boardState?.editMode === 'manual') {
      if (dist < 5) {
        const { camera, mouse } = this.getQuadrantCameraAndMouse(e);
        this.mouse.copy(mouse);
        this.raycaster.setFromCamera(this.mouse, camera);
        this.raycaster.layers.mask = camera.layers.mask;
        
        const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
        const hit = intersects.find((i: THREE.Intersection) => i.object.userData?.isGizmo);
        
        this.dispatchEvent(new CustomEvent('node-selected', {
          detail: { node: hit ? hit.object.userData : null },
          bubbles: true, composed: true
        }));
      }
    }
  };

  private onResize() {
    if (!this.perspectiveCamera || !this.topCamera || !this.renderer) return;
    const width = this.clientWidth;
    const height = this.clientHeight;
    // Each quadrant is half width, half height, so aspect ratio remains width / height
    const aspect = width / height;

    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const frustumSize = 10; // Fits up to a 10ft board
    const orthoLeft = -frustumSize * aspect / 2;
    const orthoRight = frustumSize * aspect / 2;
    const orthoTop = frustumSize / 2;
    const orthoBottom = -frustumSize / 2;

    const updateOrtho = (cam: THREE.OrthographicCamera) => {
      cam.left = orthoLeft;
      cam.right = orthoRight;
      cam.top = orthoTop;
      cam.bottom = orthoBottom;
      cam.updateProjectionMatrix();
    };

    updateOrtho(this.topCamera);
    updateOrtho(this.sideCamera);
    updateOrtho(this.profileCamera);

    this.renderer.setSize(width, height);
  }

    private updateGizmoHighlights() {
        const selected = this.boardState?.selectedNode;
        
        // Highlight Gizmos
        this.gizmoGroup.children.forEach(child => {
            const ud = child.userData as { isGizmo?: boolean; curve?: string; index?: number; type?: string };
            if (!ud || !ud.isGizmo) return;
            
            if (child instanceof THREE.Mesh) {
                const isSelected = selected && 
                                   ud.curve === selected.curve && 
                                   ud.index === selected.index && 
                                   ud.type === selected.type;
                
                if (isSelected) {
                    child.material = this.matSelected;
                } else {
                    child.material = ud.type === 'anchor' ? this.matAnchor : this.matHandle;
                }
            }
        });

        // Highlight Ghosted Slice Lines
        this.sliceLinesGroup.children.forEach(child => {
            const ud = child.userData as { isSlice?: boolean; curveName?: string; defaultColor?: number };
            if (ud && ud.isSlice) {
                const mat = (child as THREE.Line).material as THREE.LineBasicMaterial;
                if (selected && selected.curve.startsWith('crossSection_')) {
                    if (selected.curve === ud.curveName) {
                        mat.color.setHex(0xffffff);
                        mat.opacity = 1.0;
                        child.renderOrder = 999; // Draw selected slice on top
                    } else {
                        mat.color.setHex(ud.defaultColor!);
                        mat.opacity = 0.15; // Dim inactive slices
                        child.renderOrder = 0;
                    }
                } else {
                    mat.color.setHex(ud.defaultColor!);
                    mat.opacity = 0.6; // Default state
                    child.renderOrder = 0;
                }
            }
        });
    }

  private updateGizmoVisibility() {
    const show = this.boardState?.showGizmos !== false;

    this.gizmoGroup.children.forEach(child => {
      child.visible = show;
    });
  }

  private renderLoop = () => {
    this.animationId = requestAnimationFrame(this.renderLoop);
    this.controls.update();

    // Enable scissor test to restrict drawing to quadrants
    this.renderer.setScissorTest(true);

    const w = Math.floor(this.clientWidth / 2);
    const h = Math.floor(this.clientHeight / 2);
    const w2 = this.clientWidth - w;
    const h2 = this.clientHeight - h;

    // Bottom Left: Side View
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.render(this.scene, this.sideCamera);

    // Bottom Right: Profile View
    this.renderer.setViewport(w, 0, w2, h);
    this.renderer.setScissor(w, 0, w2, h);
    this.renderer.render(this.scene, this.profileCamera);

    // Top Left: Top View
    this.renderer.setViewport(0, h, w, h2);
    this.renderer.setScissor(0, h, w, h2);
    this.renderer.render(this.scene, this.topCamera);

    // Top Right: Perspective View
    this.renderer.setViewport(w, h, w2, h2);
    this.renderer.setScissor(w, h, w2, h2);
    this.renderer.render(this.scene, this.perspectiveCamera);

    // Restore default state
    this.renderer.setScissorTest(false);
  };

  override render() {
    // The view buttons have been removed. We now have a permanent 4-way split.
    return html`
      <canvas></canvas>
    `;
  }
}

