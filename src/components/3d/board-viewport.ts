import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoardModel, BezierCurveData } from "../pages/board-builder-page.logic";
import { generateBoardCurves } from "../../lib/client/geometry/board-curves";
import { MeshGeneratorService } from "../../lib/client/geometry/mesh-generator";
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
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId: number = 0;
  private resizeObserver!: ResizeObserver;
  private wireframeGroup = new THREE.Group();
  private solidGroup = new THREE.Group();
  private finGroup = new THREE.Group();
  private gizmoGroup = new THREE.Group();
  
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

  override updated(changedProperties: PropertyValues<this>) {
    if (changedProperties.has("boardState") && this.boardState) {
      const oldState = changedProperties.get("boardState");
      
      // Prevent infinite loops and lag: If ONLY the volume changed, do not rebuild the 3D mesh.
      if (oldState) {
        let onlyVolumeChanged = true;
        const oldBoardState = oldState;
         
        for (const key in this.boardState) {
          const k = key as keyof BoardModel;
          if (k !== "volume" && this.boardState[k] !== oldBoardState[k]) {
            onlyVolumeChanged = false;
            break;
          }
        }
        if (onlyVolumeChanged) return;
      }

      void this._updateGeometry();
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

    const buildLine = (pts: [number, number, number][], mat: THREE.LineBasicMaterial, mirrorX = false, followRocker = false) => {
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
        return new THREE.Line(geometry, mat);
    };

    // Render outline wrapping the rails, and rocker staying normal
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, false, true));
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, true, true)); 
    this.wireframeGroup.add(buildLine(curves.rockerTop, matRocker, false, false));
    this.wireframeGroup.add(buildLine(curves.rockerBottom, matRocker, false, false));

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

        const mat = new THREE.MeshPhysicalMaterial({ 
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

        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.solidGroup.add(mesh);

        // --- STEP 6: Fin Placement & Rendering ---
        while (this.finGroup.children.length > 0) {
            const child = this.finGroup.children[0] as THREE.Mesh;
            if (child.geometry) child.geometry.dispose();
            if (child.material) (child.material as THREE.Material).dispose();
            this.finGroup.remove(child);
        }

        const createFinMesh = (isSmall: boolean = false) => {
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
            
            const mat = new THREE.MeshPhysicalMaterial({ 
                color: 0xf8fafc, 
                roughness: 0.15, 
                transmission: 0.9, // Clear frosted fiberglass
                thickness: 0.2,
                ior: 1.5
            });
            const finMesh = new THREE.Mesh(geom, mat);
            finMesh.castShadow = true;
            
            // 1. Flip upside down so tip points down into the water (-Y)
            // 2. Rotate 90deg so leading edge (+X in shape) points towards the board's nose (-Z)
            finMesh.rotation.set(Math.PI, -Math.PI / 2, 0);
            return finMesh;
        };

        const mountFin = (zFromTail: number, railOffset: number, isRight: boolean, isCenter: boolean, isSmall: boolean) => {
            // 1. Create the perfectly oriented local fin mesh
            const finMesh = createFinMesh(isSmall);
            
            // 2. Wrap it in a container so Toe and Cant rotations don't conflict
            const finContainer = new THREE.Group();
            finContainer.add(finMesh);

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
            const anchorMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false }); // Blue anchors
            const handleGeo = new THREE.BoxGeometry(0.3 * scale, 0.3 * scale, 0.3 * scale);
            const handleMat = new THREE.MeshBasicMaterial({ color: 0xa1a1aa, depthTest: false }); // Gray tangent handles
            const lineMat = new THREE.LineDashedMaterial({ color: 0x52525b, dashSize: 0.5 * scale, gapSize: 0.5 * scale, depthTest: false });

            const drawGizmosForCurve = (curve: BezierCurveData | undefined, curveName: string) => {
                if (!curve) return;
                for (let i = 0; i < curve.controlPoints.length; i++) {
                    const cp = curve.controlPoints[i]!;
                    const t1 = curve.tangents1[i];
                    const t2 = curve.tangents2[i];

                    // Draw Anchor
                    const anchorMesh = new THREE.Mesh(anchorGeo, anchorMat);
                    anchorMesh.position.set(cp[0] * scale, cp[1] * scale, cp[2] * scale);
                    anchorMesh.renderOrder = 999;
                    anchorMesh.userData = { isGizmo: true, type: 'anchor', curve: curveName, index: i };
                    this.gizmoGroup.add(anchorMesh);

                    const drawHandle = (t: [number, number, number], handleType: string) => {
                        // Don't draw handles if they are completely collapsed onto the anchor
                        if (Math.abs(t[0]-cp[0]) < 0.001 && Math.abs(t[1]-cp[1]) < 0.001 && Math.abs(t[2]-cp[2]) < 0.001) return;

                        const handleMesh = new THREE.Mesh(handleGeo, handleMat);
                        handleMesh.position.set(t[0] * scale, t[1] * scale, t[2] * scale);
                        handleMesh.renderOrder = 999;
                        handleMesh.userData = { isGizmo: true, type: handleType, curve: curveName, index: i };
                        this.gizmoGroup.add(handleMesh);

                        const lineGeo = new THREE.BufferGeometry().setFromPoints([
                            new THREE.Vector3(cp[0] * scale, cp[1] * scale, cp[2] * scale),
                            new THREE.Vector3(t[0] * scale, t[1] * scale, t[2] * scale)
                        ]);
                        const line = new THREE.Line(lineGeo, lineMat);
                        line.computeLineDistances();
                        line.renderOrder = 998;
                        this.gizmoGroup.add(line);
                    };

                    if (t1) drawHandle(t1, 'tangent1');
                    if (t2) drawHandle(t2, 'tangent2');
                }
            };

            drawGizmosForCurve(this.boardState.manualOutline, 'outline');
            drawGizmosForCurve(this.boardState.manualRockerTop, 'rockerTop');
            drawGizmosForCurve(this.boardState.manualRockerBottom, 'rockerBottom');
            
            if (this.boardState.manualCrossSections) {
                this.boardState.manualCrossSections.forEach((cs, idx) => {
                    drawGizmosForCurve(cs, `crossSection_${idx}`);
                });
            }
        }
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.animationId);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.renderer) this.renderer.dispose();
    if (this.controls) this.controls.dispose();
  }

  private initThree() {
    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x09090b); // matches zinc-950

    // 2. Camera setup
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.clientWidth / this.clientHeight,
      0.1,
      1000
    );
    // Look down the Nose (-Z axis) so the front of the board is in the foreground
    this.camera.position.set(-6, 4, -6);

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
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    // 7. Groups & Grid
    this.scene.add(this.wireframeGroup);
    this.scene.add(this.solidGroup);
    this.scene.add(this.finGroup);
    this.scene.add(this.gizmoGroup);

    const gridHelper = new THREE.GridHelper(10, 10, 0x27272a, 0x18181b);
    gridHelper.position.y = -0.99; // Offset slightly above the shadow floor to prevent Z-fighting
    this.scene.add(gridHelper);

    // 8. Handle Resize
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this);

    // 8. Start Loop
    this.renderLoop();
  }

  private onPointerDown(e: PointerEvent) {
    if (this.boardState?.editMode !== 'manual') return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Intersect only with gizmos
    const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, false);
    const hit = intersects.find(i => i.object.userData?.isGizmo);

    if (hit) {
      this.draggedGizmo = hit.object as THREE.Mesh;
      this.controls.enabled = false; // Disable camera orbit while dragging
      
      // Calculate a mathematical plane passing through the gizmo, facing the camera
      const cameraDir = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      this.dragPlane.setFromNormalAndCoplanarPoint(cameraDir, this.draggedGizmo.position);
      
      // Calculate the exact click offset from the center of the gizmo to prevent snapping
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragOffset)) {
        this.dragOffset.sub(this.draggedGizmo.position);
      }
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.draggedGizmo) return;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const target = new THREE.Vector3();
    
    if (this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
      target.sub(this.dragOffset);
      
      // Update gizmo position instantly for fluid UI feedback
      this.draggedGizmo.position.copy(target);
      
      // Scale coordinates back from Three.js World (Feet) to Application Logic (Inches)
      const inInches = target.clone().multiplyScalar(12);
      
      // Dispatch event to SAM Controller (Step 3)
      this.dispatchEvent(new CustomEvent('gizmo-dragged', {
        detail: { 
          userData: this.draggedGizmo.userData, 
          position: [inInches.x, inInches.y, inInches.z] 
        },
        bubbles: true,
        composed: true
      }));
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (this.draggedGizmo) {
      this.draggedGizmo = null;
      this.controls.enabled = true; // Re-enable camera orbit
    }
  }

  private onResize() {
    if (!this.camera || !this.renderer) return;
    const width = this.clientWidth;
    const height = this.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private renderLoop = () => {
    this.animationId = requestAnimationFrame(this.renderLoop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  override render() {
    return html`
      <canvas></canvas>
    `;
  }
}
