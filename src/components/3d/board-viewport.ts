import { LitElement, html, css } from "lit";
import { customElement, query } from "lit/decorators.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

@customElement("board-viewport")
export class BoardViewport extends LitElement {
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

  override firstUpdated() {
    this.initThree();
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

    // 6. Placeholder Blank (A stretched box resembling a shortboard blank)
    // Generic units: Length(Z)=6, Width(X)=1.6, Thickness(Y)=0.2
    const geometry = new THREE.BoxGeometry(1.6, 0.2, 6);
    const material = new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      roughness: 0.3,
      metalness: 0.1,
    });
    const blank = new THREE.Mesh(geometry, material);
    this.scene.add(blank);

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
    return html`<canvas></canvas>`;
  }
}
