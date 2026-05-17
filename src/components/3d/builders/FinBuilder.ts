import * as THREE from "three";
import { BoardModel } from "../../pages/board-builder-page.logic";
import type { WasmEngine } from "../../../lib/client/wasm/surfer_wasm.js";

export class FinBuilder {
  static build(group: THREE.Group, state: BoardModel | undefined, mathEngine: WasmEngine, scale: number) {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Object3D;
      group.remove(child);
    }
  }
}
