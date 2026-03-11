import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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

  override firstUpdated() {
    this.initThree();
  }

  override updated(changedProperties: PropertyValues<this>) {
    if (changedProperties.has("boardState") && this.boardState) {
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

    const matOutline = new THREE.LineBasicMaterial({ color: 0x3b82f6 });
    const matRocker = new THREE.LineBasicMaterial({ color: 0x10b981 });

    const scale = 1 / 12; // Inches to Feet for Three.js coordinates

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
                // Wrap the 2D outline along the rail profile (center of thickness)
                const topY = getRockerY(zInches, true);
                const bottomY = getRockerY(zInches, false);
                vertices[i*3+1] = ((topY + bottomY) / 2) * scale;
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
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
        } else {
            child.material.dispose();
        }
        this.solidGroup.remove(child);
    }

    if (this.boardState.meshData) {
        // 🚀 100% Native Frontend Procedural Surfboard Mesh Generation
        const segmentsZ = curves.outline.length;
        const segmentsRadial = 36;
        
        const vertices =[];
        const indices = [];
        const uvs =[];
        
        // Shaper specific tuning parameters
        const railApexRatio = 0.35; // Rails tucked under slightly
        const railCurve = 0.75; // Boxy rails
        const deckCurve = 0.6; // Flattish deck dome
        const bottomCurve = 0.5; // Flattish bottom
        const concaveDepth = 0.18; // Inches of single concave

        for (let i = 0; i < segmentsZ; i++) {
            const p = curves.outline[i];
            const halfWidth = p[0];
            const zInches = p[2];

            let topY = getRockerY(zInches, true);
            let botY = getRockerY(zInches, false);
            
            // Prevent degenerate pinch at the absolute tips
            if (topY - botY < 0.01) {
                topY = botY + 0.01;
            }

            const thickness = topY - botY;
            const apexY = botY + thickness * railApexRatio;

            for (let j = 0; j < segmentsRadial; j++) {
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
                    
                    // Apply Single Concave (peaks at stringer, fades to rail)
                    if (halfWidth > 0.1) {
                        const nx = px / halfWidth;
                        const concave = concaveDepth * (1 - nx * nx);
                        
                        // Fade concave out at the nose and tail tips (last 12 inches)
                        const tailDist = Math.max(0, curves.outline[segmentsZ-1][2] - zInches);
                        const noseDist = Math.max(0, zInches - curves.outline[0][2]);
                        const tailFade = Math.min(1, tailDist / 12);
                        const noseFade = Math.min(1, noseDist / 12);
                        
                        py += concave * tailFade * noseFade;
                    }
                }

                vertices.push(px * scale, py * scale, zInches * scale);
                uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
            }
        }

        // Generate Triangle Indices
        for (let i = 0; i < segmentsZ - 1; i++) {
            for (let j = 0; j < segmentsRadial; j++) {
                const a = i * segmentsRadial + j;
                const b = i * segmentsRadial + ((j + 1) % segmentsRadial);
                const c = (i + 1) * segmentsRadial + j;
                const d = (i + 1) * segmentsRadial + ((j + 1) % segmentsRadial);

                indices.push(a, b, d);
                indices.push(a, d, c);
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);
        geom.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({ 
            color: 0xf8f9fa, // Zinc-50 Foam White
            roughness: 0.8, 
            metalness: 0.05,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geom, mat);
        this.solidGroup.add(mesh);
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
    this.camera.position.set(5, 5, 5);

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.clientWidth, this.clientHeight);

    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 5);
    this.scene.add(dirLight);

    // 6. Wireframe Group for Real-time Curves
    this.scene.add(this.wireframeGroup);
    this.scene.add(this.solidGroup);

    // Grid helper for scale reference
    const gridHelper = new THREE.GridHelper(10, 10, 0x27272a, 0x18181b);
    this.scene.add(gridHelper);

    // 7. Handle Resize
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
