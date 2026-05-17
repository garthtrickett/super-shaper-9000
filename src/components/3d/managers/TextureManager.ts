import * as THREE from "three";

export class TextureManager {
  private zebraCanvas = document.createElement('canvas');
  private zebraCtx: CanvasRenderingContext2D;
  private zebraTexture: THREE.CanvasTexture;

  constructor() {
    this.zebraCanvas.width = 512;
    this.zebraCanvas.height = 512;
    this.zebraCtx = this.zebraCanvas.getContext('2d')!;
    this.zebraTexture = new THREE.CanvasTexture(this.zebraCanvas);
    this.zebraTexture.wrapS = THREE.RepeatWrapping;
    this.zebraTexture.wrapT = THREE.RepeatWrapping;
  }

  getBoardTextures() {
    return { map: null, bumpMap: null };
  }

  getZebraTexture() {
    return this.zebraTexture;
  }

  updateZebraCanvas(offset: number) {
    const ctx = this.zebraCtx;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = '#000000';
    const stripeWidth = 32;
    for (let i = -1; i < 512 / stripeWidth + 1; i++) {
      ctx.fillRect(i * stripeWidth * 2 + (offset % (stripeWidth * 2)), 0, stripeWidth, 512);
    }
    this.zebraTexture.needsUpdate = true;
  }
}
