import * as THREE from "three";

export class CurvatureBuilder {
    static build(group: THREE.Group, curvatureCombs: Float32Array | null | undefined, _scale: number) {
    // Clean up old geometry
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.LineSegments;
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
      group.remove(child);
    }

    if (!curvatureCombs || curvatureCombs.length === 0) return;

    // Create new geometry directly from the pre-scaled Float32Array sent by Rust
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(curvatureCombs, 3));

    // Render as high-contrast fuchsia lines
    const material = new THREE.LineBasicMaterial({
      color: 0xd946ef, // Tailwind fuchsia-500
      depthTest: false,
      transparent: true,
      opacity: 0.8
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 999;
    
    // Make visible in the Top, Side, and Profile Orthographic viewports
    lines.layers.enable(1);
    lines.layers.enable(2);
    lines.layers.enable(3);
    
    group.add(lines);
  }
}