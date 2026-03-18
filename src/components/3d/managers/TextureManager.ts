import * as THREE from "three";

export class TextureManager {
  private _boardTexture: THREE.CanvasTexture | null = null;
  private _bumpTexture: THREE.CanvasTexture | null = null;
  private _zebraTexture: THREE.CanvasTexture | null = null;
  private zebraCanvas: HTMLCanvasElement | null = null;

  getZebraTexture(): THREE.CanvasTexture {
    if (this._zebraTexture) return this._zebraTexture;

    this.zebraCanvas = document.createElement("canvas");
    this.zebraCanvas.width = 1024;
    this.zebraCanvas.height = 512;

    this._zebraTexture = new THREE.CanvasTexture(this.zebraCanvas);
    this._zebraTexture.mapping = THREE.EquirectangularReflectionMapping;
    this._zebraTexture.colorSpace = THREE.SRGBColorSpace;
    this._zebraTexture.magFilter = THREE.LinearFilter;
    this._zebraTexture.minFilter = THREE.LinearMipmapLinearFilter;

    this.updateZebraCanvas(0);

    return this._zebraTexture;
  }

  updateZebraCanvas(offset: number) {
    if (!this.zebraCanvas || !this._zebraTexture) return;
    const ctx = this.zebraCanvas.getContext("2d");
    if (!ctx) return;

    // Fill white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 512);

    // Draw horizontal black stripes (equator rings in equirectangular projection)
    ctx.fillStyle = "#000000";
    const stripeCount = 48; // High frequency bands to spot tiny surface bumps
    const stripeHeight = 512 / stripeCount;
    
    // Render slightly out of bounds to seamlessly handle the wrapping offset
    for (let i = -2; i <= stripeCount + 2; i += 2) {
      const y = (i * stripeHeight) + (offset % (stripeHeight * 2));
      ctx.fillRect(0, y, 1024, stripeHeight);
    }

    this._zebraTexture.needsUpdate = true;
  }

  getBoardTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
    if (this._boardTexture && this._bumpTexture) {
      return { map: this._boardTexture, bumpMap: this._bumpTexture };
    }

    // 1. Color & Stringer Map
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    
    if (ctx) {
      // Warm white foam core
      ctx.fillStyle = "#fdfcf8";
      ctx.fillRect(0, 0, 1024, 1024);

      // Dark wood stringer (U=0.25 and U=0.75 mappings)
      ctx.fillStyle = "#4a3320";
      ctx.fillRect(256 - 3, 0, 6, 1024);
      ctx.fillRect(768 - 3, 0, 6, 1024);

      // Subtle brushed lines (foam cell texture direction)
      ctx.fillStyle = "rgba(0,0,0,0.02)";
      for (let i = 0; i < 1024; i += 4) {
        ctx.fillRect(0, i, 1024, 1 + Math.random() * 2);
      }
    }

    this._boardTexture = new THREE.CanvasTexture(canvas);
    this._boardTexture.wrapS = THREE.RepeatWrapping;
    this._boardTexture.wrapT = THREE.RepeatWrapping;
    this._boardTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. Bump Map (Micro Foam Cells)
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext("2d");
    
    if (bCtx) {
      bCtx.fillStyle = "#808080";
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
    }

    this._bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    this._bumpTexture.wrapS = THREE.RepeatWrapping;
    this._bumpTexture.wrapT = THREE.RepeatWrapping;

    return { map: this._boardTexture, bumpMap: this._bumpTexture };
  }

  dispose() {
    if (this._boardTexture) this._boardTexture.dispose();
    if (this._bumpTexture) this._bumpTexture.dispose();
    if (this._zebraTexture) this._zebraTexture.dispose();
  }
}
import * as THREE from "three";

export class TextureManager {
  private _boardTexture: THREE.CanvasTexture | null = null;
  private _bumpTexture: THREE.CanvasTexture | null = null;
  private _zebraTexture: THREE.CanvasTexture | null = null;
  private zebraCanvas: HTMLCanvasElement | null = null;

  getZebraTexture(): THREE.CanvasTexture {
    if (this._zebraTexture) return this._zebraTexture;

    this.zebraCanvas = document.createElement("canvas");
    this.zebraCanvas.width = 1024;
    this.zebraCanvas.height = 512;

    this._zebraTexture = new THREE.CanvasTexture(this.zebraCanvas);
    this._zebraTexture.mapping = THREE.EquirectangularReflectionMapping;
    this._zebraTexture.colorSpace = THREE.SRGBColorSpace;
    this._zebraTexture.magFilter = THREE.LinearFilter;
    this._zebraTexture.minFilter = THREE.LinearMipmapLinearFilter;

    this.updateZebraCanvas(0);

    return this._zebraTexture;
  }

  updateZebraCanvas(offset: number) {
    if (!this.zebraCanvas || !this._zebraTexture) return;
    const ctx = this.zebraCanvas.getContext("2d");
    if (!ctx) return;

    // Fill white background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 512);

    // Draw horizontal black stripes (equator rings in equirectangular projection)
    ctx.fillStyle = "#000000";
    const stripeCount = 48; // High frequency bands to spot tiny surface bumps
    const stripeHeight = 512 / stripeCount;
    
    // Render slightly out of bounds to seamlessly handle the wrapping offset
    for (let i = -2; i <= stripeCount + 2; i += 2) {
      const y = (i * stripeHeight) + (offset % (stripeHeight * 2));
      ctx.fillRect(0, y, 1024, stripeHeight);
    }

    this._zebraTexture.needsUpdate = true;
  }

  getBoardTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
    if (this._boardTexture && this._bumpTexture) {
      return { map: this._boardTexture, bumpMap: this._bumpTexture };
    }

    // 1. Color & Stringer Map
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    
    if (ctx) {
      // Warm white foam core
      ctx.fillStyle = "#fdfcf8";
      ctx.fillRect(0, 0, 1024, 1024);

      // Dark wood stringer (U=0.25 and U=0.75 mappings)
      ctx.fillStyle = "#4a3320";
      ctx.fillRect(256 - 3, 0, 6, 1024);
      ctx.fillRect(768 - 3, 0, 6, 1024);

      // Subtle brushed lines (foam cell texture direction)
      ctx.fillStyle = "rgba(0,0,0,0.02)";
      for (let i = 0; i < 1024; i += 4) {
        ctx.fillRect(0, i, 1024, 1 + Math.random() * 2);
      }
    }

    this._boardTexture = new THREE.CanvasTexture(canvas);
    this._boardTexture.wrapS = THREE.RepeatWrapping;
    this._boardTexture.wrapT = THREE.RepeatWrapping;
    this._boardTexture.colorSpace = THREE.SRGBColorSpace;

    // 2. Bump Map (Micro Foam Cells)
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext("2d");
    
    if (bCtx) {
      bCtx.fillStyle = "#808080";
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
    }

    this._bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    this._bumpTexture.wrapS = THREE.RepeatWrapping;
    this._bumpTexture.wrapT = THREE.RepeatWrapping;

    return { map: this._boardTexture, bumpMap: this._bumpTexture };
  }

  dispose() {
    if (this._boardTexture) this._boardTexture.dispose();
    if (this._bumpTexture) this._bumpTexture.dispose();
    if (this._zebraTexture) this._zebraTexture.dispose();
  }
}
