import * as THREE from "three";

export class CurvatureBuilder {
  static build(group: THREE.Group, curvatureCombs: Float32Array | undefined, scale: number) {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Object3D;
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
      group.remove(child);
    }
    if (!curvatureCombs || curvatureCombs.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(curvatureCombs, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xd946ef, transparent: true, opacity: 0.6 });
    const line = new THREE.LineSegments(geometry, material);
    group.add(line);
  }
}
