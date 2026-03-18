import * as THREE from "three";
import type { BoardModel } from "../../pages/board-builder-page.logic";

export class AnnotationBuilder {
  static build(group: THREE.Group, boardState: BoardModel, scale: number) {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Line | THREE.Sprite;
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child instanceof THREE.Sprite && child.material.map) child.material.map.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      group.remove(child);
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
      group.add(line);

      const sprite = createTextSprite(text);
      const midPoint = new THREE.Vector3().lerpVectors(p1, p2, 0.5).add(textOffset);
      sprite.position.copy(midPoint);
      sprite.layers.set(layer);
      group.add(sprite);
    };

    const L = boardState.length * scale;
    const W = boardState.width * scale;
    const T = boardState.thickness * scale;
    const pad = 4.0 * scale; // 4 inches padding off the board edge

    // Top View (Layer 6) - Length & Width
    addDim(`${boardState.length.toFixed(1)}"`, new THREE.Vector3(W/2 + pad, 0, -L/2), new THREE.Vector3(W/2 + pad, 0, L/2), new THREE.Vector3(1, 0, 0), 6, new THREE.Vector3(1.2 * scale, 0, 0));
    addDim(`${boardState.width.toFixed(2)}"`, new THREE.Vector3(-W/2, 0, L/2 + pad), new THREE.Vector3(W/2, 0, L/2 + pad), new THREE.Vector3(0, 0, 1), 6, new THREE.Vector3(0, 0, 1.0 * scale));

    // Side View (Layer 7) - Length & Thickness
    addDim(`${boardState.length.toFixed(1)}"`, new THREE.Vector3(0, -T/2 - pad, -L/2), new THREE.Vector3(0, -T/2 - pad, L/2), new THREE.Vector3(0, 1, 0), 7, new THREE.Vector3(0, -1.0 * scale, 0));
    // Side view is looking down X axis (from +X), so -Z is to the Right. Shift text Right.
    addDim(`${boardState.thickness.toFixed(2)}"`, new THREE.Vector3(0, -T/2, 0), new THREE.Vector3(0, T/2, 0), new THREE.Vector3(0, 0, 1), 7, new THREE.Vector3(0, 0, -1.5 * scale));

    // Profile View (Layer 8) - Width & Thickness
    addDim(`${boardState.width.toFixed(2)}"`, new THREE.Vector3(-W/2, -T/2 - pad, 0), new THREE.Vector3(W/2, -T/2 - pad, 0), new THREE.Vector3(0, 1, 0), 8, new THREE.Vector3(0, -1.0 * scale, 0));
    addDim(`${boardState.thickness.toFixed(2)}"`, new THREE.Vector3(W/2 + pad, -T/2, 0), new THREE.Vector3(W/2 + pad, T/2, 0), new THREE.Vector3(1, 0, 0), 8, new THREE.Vector3(1.5 * scale, 0, 0));
  }
}
