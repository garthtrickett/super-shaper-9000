import * as THREE from "three";
import { ViewportId } from "../board-viewport";

export class SceneManager {
  public scene = new THREE.Scene();
  public cameras: Record<ViewportId, THREE.PerspectiveCamera | THREE.OrthographicCamera>;
  public controls: any;
  private renderer: THREE.WebGLRenderer;
  private maximizedView: ViewportId | null = null;
  private renderCb?: () => void;

  constructor(canvas: HTMLCanvasElement, objects: THREE.Object3D[]) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    
    objects.forEach(obj => this.scene.add(obj));

    const aspect = canvas.clientWidth / canvas.clientHeight || 1;
    this.cameras = {
      perspective: new THREE.PerspectiveCamera(45, aspect, 0.1, 1000),
      top: new THREE.OrthographicCamera(-5*aspect, 5*aspect, 5, -5, 0.1, 1000),
      side: new THREE.OrthographicCamera(-5*aspect, 5*aspect, 5, -5, 0.1, 1000),
      profile: new THREE.OrthographicCamera(-5*aspect, 5*aspect, 5, -5, 0.1, 1000),
    };

    this.cameras.perspective.position.set(-15, 10, 20);
    this.cameras.perspective.lookAt(0, 0, 0);

    this.cameras.top.position.set(0, 20, 0);
    this.cameras.top.lookAt(0, 0, 0);
    this.cameras.top.layers.set(1);

    this.cameras.side.position.set(-20, 0, 0);
    this.cameras.side.lookAt(0, 0, 0);
    this.cameras.side.layers.set(2);

    this.cameras.profile.position.set(0, 0, 20);
    this.cameras.profile.lookAt(0, 0, 0);
    this.cameras.profile.layers.set(3);

    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    this.scene.add(amb, dir);

    window.addEventListener('resize', this.resize);
    setTimeout(() => this.resize(), 100);
  }

  setMaximizedView(view: ViewportId | null) {
    this.maximizedView = view;
    this.resize();
  }

  toggleOrtho() {}

  private resize = () => {
    const canvas = this.renderer.domElement;
    const width = canvas.parentElement?.clientWidth || window.innerWidth;
    const height = canvas.parentElement?.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
  };

  startRenderLoop(cb: () => void) {
    this.renderCb = cb;
    this.render();
  }

  private render = () => {
    requestAnimationFrame(this.render);
    this.renderCb?.();

    const canvas = this.renderer.domElement;
    const w = canvas.width;
    const h = canvas.height;

    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    if (this.maximizedView) {
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.setScissor(0, 0, w, h);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.scene, this.cameras[this.maximizedView]);
    } else {
      this.renderer.setScissorTest(true);

      this.renderer.setViewport(0, h/2, w/2, h/2);
      this.renderer.setScissor(0, h/2, w/2, h/2);
      this.renderer.render(this.scene, this.cameras.top);

      this.renderer.setViewport(w/2, h/2, w/2, h/2);
      this.renderer.setScissor(w/2, h/2, w/2, h/2);
      this.renderer.render(this.scene, this.cameras.perspective);

      this.renderer.setViewport(0, 0, w/2, h/2);
      this.renderer.setScissor(0, 0, w/2, h/2);
      this.renderer.render(this.scene, this.cameras.side);

      this.renderer.setViewport(w/2, 0, w/2, h/2);
      this.renderer.setScissor(w/2, 0, w/2, h/2);
      this.renderer.render(this.scene, this.cameras.profile);
    }
  }
}
