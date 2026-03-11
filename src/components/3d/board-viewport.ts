import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { BoardModel } from "../pages/board-builder-page.logic";
import { generateBoardCurves } from "../../lib/client/geometry/board-curves";

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
      const oldState = changedProperties.get("boardState") as BoardModel | undefined;
      
      // Prevent infinite loops and lag: If ONLY the volume changed, do not rebuild the 3D mesh.
      if (oldState) {
        let onlyVolumeChanged = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const key in this.boardState) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (key !== "volume" && (this.boardState as any)[key] !== (oldState as any)[key]) {
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
    
    const { 
        bottomContour, apexRatio, hardEdgeLength, railFullness,
        veeDepth, concaveDepth, channelDepth, channelLength 
    } = this.boardState;

    // Helper to compute dynamic apex ratio based on precise CAD parameters
    const getApexRatio = (zInches: number) => {
        const maxZ = curves.outline[curves.outline.length-1][2];
        const distFromTail = maxZ - zInches;
        
        let currentApex = apexRatio;
        
        // Drop apex to the bottom edge if within the hardEdgeLength
        if (distFromTail < hardEdgeLength) {
            const blendZone = 6.0; // Blend from soft to hard over 6 inches
            const blendEnd = Math.max(0, hardEdgeLength - blendZone);
            
            if (distFromTail <= blendEnd) {
                currentApex = 0.02; // Hard sharp tucked edge
            } else {
                const t = (distFromTail - blendEnd) / blendZone;
                currentApex = 0.02 + t * (apexRatio - 0.02);
            }
        }
        return currentApex;
    };

    // Helper to find the Y height of a rocker curve at a specific Z length
    const getRockerY = (zInches: number, isTop: boolean) => {
        const pts = isTop ? curves.rockerTop : curves.rockerBottom;
        if (!pts.length) return 0;
        
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i]!;
            const p2 = pts[i+1]!;
            const z1 = p1[2];
            const z2 = p2[2];
            if (zInches >= z1 && zInches <= z2) {
                const tCurve = (zInches - z1) / (z2 - z1);
                return p1[1] + tCurve * (p2[1] - p1[1]);
            }
        }
        // Fallback for bevels that slightly overhang the exact length
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        return zInches <= first[2] ? first[1] : last[1];
    };

    const buildLine = (pts: [number, number, number][], mat: THREE.LineBasicMaterial, mirrorX = false, followRocker = false) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            const zInches = p[2];
            vertices[i*3] = (mirrorX ? -p[0] : p[0]) * scale;
            
            if (followRocker) {
                // Wrap the 2D outline along the rail profile (matching solid mesh rail apex)
                const topY = getRockerY(zInches, true);
                const bottomY = getRockerY(zInches, false);
                const thickness = topY - bottomY;
                
                const minZ = curves.outline[0][2];
                const maxZ = curves.outline[curves.outline.length-1][2];
                const nz = (zInches - minZ) / (maxZ - minZ);
                
                const dynamicRailApexRatio = getApexRatio(zInches);
                const apexY = bottomY + thickness * dynamicRailApexRatio;
                vertices[i*3+1] = apexY * scale;
            } else {
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
        // 🚀 100% Native Frontend Procedural Surfboard Mesh Generation
        const segmentsZ = curves.outline.length;
        const segmentsRadial = 36;
        
        const vertices = [];
        const indices = [];
        const uvs =[];
        
        // Shaper specific tuning parameters
        const deckCurve = this.boardState.deckDome; // Dynamic deck dome from slider
        const bottomCurve = 0.5; // Flattish bottom

        const minZ = curves.outline[0][2];
        const maxZ = curves.outline[segmentsZ-1][2];
        const totalZ = maxZ - minZ;

        for (let i = 0; i < segmentsZ; i++) {
            const p = curves.outline[i];
            const halfWidth = p[0];
            const zInches = p[2];
            const nz = (zInches - minZ) / totalZ; // 0 (Nose) to 1 (Tail)
            
            // Apply exact user-defined rail fullness
            const railCurve = railFullness;

            let topY = getRockerY(zInches, true);
            let botY = getRockerY(zInches, false);
            
            // Prevent degenerate pinch at the absolute tips
            if (topY - botY < 0.01) {
                topY = botY + 0.01;
            }

            const thickness = topY - botY;
            const dynamicRailApexRatio = getApexRatio(zInches);
            const apexY = botY + thickness * dynamicRailApexRatio;

            // --- Exact CAD Contour Z-Blends (Calculated once per cross-section) ---
            const smoothStep = (edge0: number, edge1: number, x: number) => {
                const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
                return t * t * (3 - 2 * t);
            };

            const tailDist = Math.max(0, maxZ - zInches);
            const noseDist = Math.max(0, zInches - minZ);

            // Entry Vee: Fades out completely by the wide point
            const blendVee = 1 - smoothStep(0.05, 0.4, nz);
            
            // Single Concave: Starts after the Vee, runs ALL the way out the tail (Quad-Inside-Single)
            const blendConcave = smoothStep(0.15, 0.3, nz);
            
            // Channels: Precise start based on channelLength (fade in over 6 inches)
            let blendChannels = 0;
            if (tailDist <= channelLength + 6.0) {
                blendChannels = 1.0 - smoothStep(channelLength, channelLength + 6.0, tailDist);
            }
            
            // Prevent sharp creases at the absolute tips
            const smoothFade = (dist: number, fadeLength: number) => {
                if (dist >= fadeLength) return 1;
                if (dist <= 0) return 0;
                const t = dist / fadeLength;
                return t * t * (3 - 2 * t);
            };
            const fadeTailNose = smoothFade(tailDist, 12) * smoothFade(noseDist, 18);

            for (let j = 0; j <= segmentsRadial; j++) {
                const angle = (j / segmentsRadial) * Math.PI * 2;
                const cx = Math.cos(angle);
                const cy = Math.sin(angle);
                
                const abs_cx = Math.abs(cx);
                const abs_cy = Math.abs(cy);
                const signX = cx < 0 ? -1 : 1;

                // Shape the X cross-section (rail fullness)
                const px = signX * Math.pow(abs_cx, railCurve) * halfWidth;

                let py = 0;
                if (cy >= 0) {
                    // Shape the Top Deck
                    py = apexY + Math.pow(abs_cy, deckCurve) * (topY - apexY);
                } else {
                    // Shape the Bottom and Rail Tuck
                    py = apexY - Math.pow(abs_cy, bottomCurve) * (apexY - botY);
                        
                    if (halfWidth > 0.001) {
                        const nx = px / halfWidth;
                        const abs_nx = Math.abs(nx);
                        let contourOffset = 0;
                            
                        if (bottomContour === "vee_to_quad_channels") {
                            // Precise Depth Injection
                            const veeOffset = veeDepth * abs_nx * blendVee;
                            const concaveOffset = concaveDepth * (1 - nx * nx) * blendConcave;

                            let channelProfile = 0;
                            // Channels sit inside the concave (0.2 to 0.8 rail fraction)
                            if (abs_nx >= 0.2 && abs_nx <= 0.8) {
                                const u = (abs_nx - 0.2) / 0.6;
                                channelProfile = Math.pow(Math.sin(u * Math.PI * 2), 2);
                            }
                            // Channels carve upwards (into the board)
                            const channelOffset = channelDepth * channelProfile * blendChannels;

                            contourOffset = (veeOffset + concaveOffset + channelOffset) * fadeTailNose;
                        } else if (bottomContour === "single_to_double") {
                            const single = concaveDepth * (1 - nx * nx);
                            const double = concaveDepth * 0.8 * Math.pow(Math.sin(abs_nx * Math.PI), 2);
                            contourOffset = (single * (1 - nz) + double * nz) * fadeTailNose;
                        } else if (bottomContour === "single") {
                            contourOffset = concaveDepth * (1 - nx * nx) * fadeTailNose;
                        }

                        // GUARANTEE MESH CONTINUITY AT APEX (cy = 0)
                        // This ensures that whatever bottom contour is applied, it smoothly
                        // fades to 0 right at the rail edge to prevent tearing/notches in the mesh.
                        contourOffset *= Math.abs(cy);

                        py += contourOffset;
                    }
                }

                vertices.push(px * scale, py * scale, zInches * scale);
                uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
            }
        }

        // Generate Triangle Indices
        for (let i = 0; i < segmentsZ - 1; i++) {
            for (let j = 0; j < segmentsRadial; j++) {
                const a = i * (segmentsRadial + 1) + j;
                const b = i * (segmentsRadial + 1) + (j + 1);
                const c = (i + 1) * (segmentsRadial + 1) + j;
                const d = (i + 1) * (segmentsRadial + 1) + (j + 1);

                indices.push(a, b, d);
                indices.push(a, d, c);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        // --- STEP 5: Real-Time Volume Calculation ---
        let volumeCubicFeet = 0;
        const posAttr = geom.attributes.position;
        const idxAttr = geom.index;
        if (idxAttr) {
            const p1 = new THREE.Vector3();
            const p2 = new THREE.Vector3();
            const p3 = new THREE.Vector3();
            const pCross = new THREE.Vector3();
            
            for (let i = 0; i < idxAttr.count; i += 3) {
                p1.fromBufferAttribute(posAttr, idxAttr.getX(i));
                p2.fromBufferAttribute(posAttr, idxAttr.getX(i+1));
                p3.fromBufferAttribute(posAttr, idxAttr.getX(i+2));
                // Signed volume of tetrahedron from origin
                pCross.crossVectors(p2, p3);
                volumeCubicFeet += p1.dot(pCross) / 6.0;
            }
        }
        
        // Our Three.js mesh is scaled in feet (1/12 scale). 
        // Convert back to cubic inches (12^3), then multiply by 0.0163871 to get Liters.
        const volumeCubicInches = Math.abs(volumeCubicFeet) * 1728; 
        const volumeLiters = isNaN(volumeCubicInches) ? 0 : volumeCubicInches * 0.0163871;

        // Secondary safety net: Only dispatch if volume changed significantly
        if (Math.abs(this.boardState.volume - volumeLiters) > 0.05) {
            this.dispatchEvent(new CustomEvent("volume-calculated", {
                detail: { volume: volumeLiters },
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
            const height = isSmall ? 3.75 * scale : 4.5 * scale;
            const rake = 2.0 * scale;
            
            shape.moveTo(0, 0); // Trailing base
            shape.quadraticCurveTo(0, height * 0.2, rake, height); // Tip
            shape.quadraticCurveTo(base * 0.8, height * 0.5, base, 0); // Leading base
            shape.lineTo(0, 0);

            const geom = new THREE.ExtrudeGeometry(shape, { 
                depth: 0.2 * scale, bevelEnabled: true, 
                bevelThickness: 0.02 * scale, bevelSize: 0.02 * scale, bevelSegments: 2 
            });
            
            // Center the fin's base horizontally, but leave Y at 0 so it mounts flush to the hull
            geom.translate(-base / 2, 0, -0.1 * scale);
            
            // Bright frosted fiberglass material to pop against the dark background
            const mat = new THREE.MeshPhysicalMaterial({ 
                color: 0xffffff, 
                roughness: 0.1, 
                transmission: 0.8, // Glass-like transparency
                thickness: 0.2,
                ior: 1.5
            });
            const finMesh = new THREE.Mesh(geom, mat);
            
            // Orient flat and pointing down relative to bottom
            finMesh.rotation.y = -Math.PI / 2;
            finMesh.rotation.x = Math.PI;
            finMesh.castShadow = true;
            return finMesh;
        };

        const getOutlineWidthAtZ = (zInches: number) => {
            for (let i = 0; i < curves.outline.length - 1; i++) {
                const p1 = curves.outline[i]!;
                const p2 = curves.outline[i+1]!;
                if (zInches >= p1[2] && zInches <= p2[2]) {
                    const t = (zInches - p1[2]) / (p2[2] - p1[2]);
                    return p1[0] + t * (p2[0] - p1[0]);
                }
            }
            return 0;
        };

        const mountFin = (zFromTail: number, railOffset: number, isRight: boolean, isCenter: boolean, isSmall: boolean) => {
            const fin = createFinMesh(isSmall);
            const zLoc = (this.boardState!.length / 2) - zFromTail;
            const halfWidth = getOutlineWidthAtZ(zLoc);
            
            const xPos = isCenter ? 0 : (halfWidth - railOffset);
            const yPos = getRockerY(zLoc, false);

            fin.position.set(isRight ? xPos * scale : -xPos * scale, yPos * scale, zLoc * scale);
            
            if (!isCenter) {
                // Apply Cant (Tilt outward) and Toe (Point towards nose)
                const cantRad = this.boardState!.cantAngle * Math.PI / 180;
                const toeRad = this.boardState!.toeAngle * Math.PI / 180;
                fin.rotation.z += isRight ? -cantRad : cantRad;
                fin.rotation.y += isRight ? toeRad : -toeRad;
            }
            this.finGroup.add(fin);
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

    const gridHelper = new THREE.GridHelper(10, 10, 0x27272a, 0x18181b);
    gridHelper.position.y = -0.99; // Offset slightly above the shadow floor to prevent Z-fighting
    this.scene.add(gridHelper);

    // 8. Handle Resize
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this);

    // 8. Start Loop
    this.renderLoop();
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
