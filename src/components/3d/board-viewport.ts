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

    const buildLine = (pts: [number, number, number][], mat: THREE.LineBasicMaterial, mirrorX = false) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            vertices[i*3] = (mirrorX ? -p[0] : p[0]) * scale;
            vertices[i*3+1] = p[1] * scale;
            vertices[i*3+2] = p[2] * scale;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        return new THREE.Line(geometry, mat);
    };

    this.wireframeGroup.add(buildLine(curves.outline, matOutline, false));
    this.wireframeGroup.add(buildLine(curves.outline, matOutline, true)); 
    this.wireframeGroup.add(buildLine(curves.rockerTop, matRocker, false));
    this.wireframeGroup.add(buildLine(curves.rockerBottom, matRocker, false));

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
        if (this.boardState.meshData === "MOCK_BASE64_MESH_DATA") {
            // Build a much better mock geometry using the actual outline curves
            const shape = new THREE.Shape();
            
            // Draw right side
            curves.outline.forEach((p, i) => {
                if (i === 0) shape.moveTo(p[0] * scale, p[2] * scale);
                else shape.lineTo(p[0] * scale, p[2] * scale);
            });
            
            // Draw left side (mirrored)
            for (let i = curves.outline.length - 1; i >= 0; i--) {
                const p = curves.outline[i];
                shape.lineTo(-p[0] * scale, p[2] * scale);
            }

            // Extrude the 2D shape to give it thickness
            const geom = new THREE.ExtrudeGeometry(shape, {
                depth: this.boardState.thickness * scale,
                bevelEnabled: true,
                bevelThickness: 0.05,
                bevelSize: 0.05,
                bevelSegments: 3,
                curveSegments: 12
            });

            // ExtrudeGeometry builds along Z. Rotate to lie flat on the X-Z plane.
            geom.rotateX(Math.PI / 2);
            // Center the thickness on the Y axis
            geom.translate(0, (this.boardState.thickness * scale) / 2, 0);
            
            const mat = new THREE.MeshStandardMaterial({ 
                color: 0xeeeeee, 
                roughness: 0.2, 
                metalness: 0.1,
                transparent: true,
                opacity: 0.8
            });
            const mesh = new THREE.Mesh(geom, mat);
            this.solidGroup.add(mesh);
        } else {
            // TODO: Decode genuine base64 Rhino 3DM mesh data here.
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
      ${this.boardState?.isComputing ? html`
        <div class="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center z-10 transition-all duration-300">
          <div class="flex flex-col items-center gap-4">
            <div class="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div class="text-blue-400 font-bold tracking-widest uppercase text-sm">Shaping...</div>
          </div>
        </div>
      ` : ""}
    `;
  }
}
