// FILE: src/components/3d/managers/SceneManager.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export class SceneManager {
  public readonly scene: THREE.Scene;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly controls: {
    perspective: OrbitControls;
  };
    public readonly cameras: {
    perspective: THREE.PerspectiveCamera | THREE.OrthographicCamera;
    top: THREE.OrthographicCamera;
    side: THREE.OrthographicCamera;
    profile: THREE.OrthographicCamera;
  };

  public isOrtho3d = false;
  private perspCam: THREE.PerspectiveCamera;
  private orthoCam: THREE.OrthographicCamera;

  public maximizedView: 'perspective' | 'top' | 'side' | 'profile' | null = null;
  private animationId: number = 0;
  private resizeObserver: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, groups: THREE.Group[]) {
    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf1f5f9); // slate-100 for high contrast with white board

        // 2. Camera setup
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.perspCam = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.orthoCam = this.createOrthoCamera(aspect);

    this.cameras = {
      perspective: this.perspCam,
      top: this.createOrthoCamera(aspect),
      side: this.createOrthoCamera(aspect),
      profile: this.createOrthoCamera(aspect),
    };

    this.configureCameras();

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;

    // 4. Environment & Lighting
    this.setupLighting();

    // 5. Controls
    this.controls = {
      perspective: new OrbitControls(this.cameras.perspective, this.renderer.domElement),
    };

    this.controls.perspective.enableDamping = true;
    this.controls.perspective.dampingFactor = 0.05;
    this.controls.perspective.target.set(0, 0, 0);
    this.controls.perspective.enabled = true;

    // 6. Add initial groups & grids
    groups.forEach(group => this.scene.add(group));
    this.setupGrids();

    // 7. Handle Resize
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.canvas);
  }

  private createOrthoCamera(aspect: number): THREE.OrthographicCamera {
    const frustumSize = 10;
    const orthoLeft = -frustumSize * aspect / 2;
    const orthoRight = frustumSize * aspect / 2;
    const orthoTop = frustumSize / 2;
    const orthoBottom = -frustumSize / 2;
    return new THREE.OrthographicCamera(orthoLeft, orthoRight, orthoTop, orthoBottom, 0.1, 1000);
  }

    private configureCameras() {
    this.perspCam.position.set(-6, 4, -6);
    this.orthoCam.position.set(-6, 4, -6);

    this.cameras.top.position.set(0, 10, 0);
    this.cameras.top.up.set(0, 0, -1);
    this.cameras.top.lookAt(0, 0, 0);
        this.cameras.top.layers.disableAll();
    this.cameras.top.layers.enable(1); this.cameras.top.layers.enable(6);

    this.cameras.side.position.set(10, 0, 0);
    this.cameras.side.up.set(0, 1, 0);
    this.cameras.side.lookAt(0, 0, 0);
    this.cameras.side.layers.disableAll();
    this.cameras.side.layers.enable(2); this.cameras.side.layers.enable(7);

    this.cameras.profile.position.set(0, 0, -10);
    this.cameras.profile.up.set(0, 1, 0);
    this.cameras.profile.lookAt(0, 0, 0);
    this.cameras.profile.layers.disableAll();
        this.cameras.profile.layers.enable(3); this.cameras.profile.layers.enable(8);

    this.perspCam.layers.enableAll();
    this.perspCam.layers.disable(6);
    this.perspCam.layers.disable(7); this.perspCam.layers.disable(8);

    this.orthoCam.layers.enableAll();
    this.orthoCam.layers.disable(6);
    this.orthoCam.layers.disable(7); this.orthoCam.layers.disable(8);
  }

  private setupLighting() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment()).texture;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(3, 8, -5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    this.scene.add(dirLight);

    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.6);
    bottomLight.position.set(-3, -8, 5);
    this.scene.add(bottomLight);

    const floorGeo = new THREE.PlaneGeometry(50, 50);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.0;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

    public setMaximizedView(view: 'perspective' | 'top' | 'side' | 'profile' | null) {
    this.maximizedView = view;
  }

  public toggleOrtho() {
    this.isOrtho3d = !this.isOrtho3d;
    
    if (this.isOrtho3d) {
      const target = this.controls.perspective.target;
      const pos = this.perspCam.position;
      const dist = pos.distanceTo(target);
      
      this.orthoCam.position.copy(pos);
      this.orthoCam.quaternion.copy(this.perspCam.quaternion);
      this.orthoCam.zoom = 1;
      
      const fov = this.perspCam.fov;
      const frustumSize = 2 * dist * Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      
      this.orthoCam.left = -frustumSize * aspect / 2;
      this.orthoCam.right = frustumSize * aspect / 2;
      this.orthoCam.top = frustumSize / 2;
      this.orthoCam.bottom = -frustumSize / 2;
      this.orthoCam.updateProjectionMatrix();

      this.cameras.perspective = this.orthoCam;
      this.controls.perspective.object = this.orthoCam;
    } else {
      const target = this.controls.perspective.target;
      const pos = this.orthoCam.position;
      const dist = pos.distanceTo(target);
      const zoom = this.orthoCam.zoom;
      
      const newDist = dist / zoom;
      const dir = new THREE.Vector3().subVectors(pos, target).normalize();
      
      this.perspCam.position.copy(target).addScaledVector(dir, newDist);
      this.perspCam.quaternion.copy(this.orthoCam.quaternion);
      
      this.cameras.perspective = this.perspCam;
      this.controls.perspective.object = this.perspCam;
    }
  }

  private setupGrids() {
    const createCADGrid = (layer: number, rotationX: number, rotationZ: number, positionOffset: THREE.Vector3) => {
      const group = new THREE.Group();
      const major = new THREE.GridHelper(20, 20, 0x94a3b8, 0xcbd5e1);
      const minor = new THREE.GridHelper(20, 80, 0xcbd5e1, 0xe2e8f0);
      [major, minor].forEach(grid => {
        grid.renderOrder = -1;
        (grid.material as THREE.Material).depthWrite = false;
        (grid.material as THREE.Material).transparent = true;
      });
      (major.material as THREE.Material).opacity = 0.5;
      (minor.material as THREE.Material).opacity = 0.3;
      group.add(major, minor);
      group.rotation.set(rotationX, 0, rotationZ);
      group.position.copy(positionOffset);
      group.traverse(child => child.layers.set(layer));
      return group;
    };

    this.scene.add(createCADGrid(6, 0, 0, new THREE.Vector3(0, -2, 0)));
    this.scene.add(createCADGrid(7, 0, Math.PI / 2, new THREE.Vector3(-2, 0, 0)));
    this.scene.add(createCADGrid(8, Math.PI / 2, 0, new THREE.Vector3(0, 0, 5)));
  }

  public startRenderLoop(onLoop: () => void) {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      this.controls.perspective.update();
      onLoop(); // Callback for external updates like zebra animation

      this.renderer.setScissorTest(true);

      if (this.maximizedView) {
        this.renderer.setViewport(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.setScissor(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.render(this.scene, this.cameras[this.maximizedView]);
      } else {
        const w = Math.floor(this.canvas.clientWidth / 2);
        const h = Math.floor(this.canvas.clientHeight / 2);
        const w2 = this.canvas.clientWidth - w;
        const h2 = this.canvas.clientHeight - h;

        this.renderer.setViewport(0, 0, w, h);
        this.renderer.setScissor(0, 0, w, h);
        this.renderer.render(this.scene, this.cameras.side);

        this.renderer.setViewport(w, 0, w2, h);
        this.renderer.setScissor(w, 0, w2, h);
        this.renderer.render(this.scene, this.cameras.profile);

        this.renderer.setViewport(0, h, w, h2);
        this.renderer.setScissor(0, h, w, h2);
        this.renderer.render(this.scene, this.cameras.top);

        this.renderer.setViewport(w, h, w2, h2);
        this.renderer.setScissor(w, h, w2, h2);
        this.renderer.render(this.scene, this.cameras.perspective);
      }

      this.renderer.setScissorTest(false);
    };
    loop();
  }

  public dispose() {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.controls.perspective.dispose();
  }

  private onResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;

        this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();

    const frustumSize = 10;
    const orthoLeft = -frustumSize * aspect / 2;
    const orthoRight = frustumSize * aspect / 2;
    const orthoTop = frustumSize / 2;
    const orthoBottom = -frustumSize / 2;

    [this.cameras.top, this.cameras.side, this.cameras.profile].forEach(cam => {
      cam.left = orthoLeft;
      cam.right = orthoRight;
      cam.top = orthoTop;
      cam.bottom = orthoBottom;
      cam.updateProjectionMatrix();
        });

    if (this.isOrtho3d) {
      const dist = this.orthoCam.position.distanceTo(this.controls.perspective.target);
      const fSize = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspCam.fov / 2));
      this.orthoCam.left = -fSize * aspect / 2;
      this.orthoCam.right = fSize * aspect / 2;
      this.orthoCam.top = fSize / 2;
      this.orthoCam.bottom = -fSize / 2;
      this.orthoCam.updateProjectionMatrix();
    }

    this.renderer.setSize(width, height);
  }
}
