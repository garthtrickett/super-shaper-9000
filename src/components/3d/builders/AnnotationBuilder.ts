import * as THREE from "three";
import { BoardModel } from "../../pages/board-builder-page.logic";

export class AnnotationBuilder {
  static build(group: THREE.Group, state: BoardModel | undefined, scale: number) {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Object3D;
      group.remove(child);
    }
  }
}
