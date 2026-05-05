import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { BoardModel, BoardAction } from "../../components/pages/board-builder-page.logic";
import type { RustMesh } from "../../components/3d/board-viewport";
import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

interface WorkerMessage {
  type: string;
  state?: BoardModel;
  mesh?: RustMesh;
  curvatureCombs?: Float32Array;
}

export class WasmSamController implements ReactiveController {
  public model?: BoardModel;
  public mesh?: RustMesh;
  public curvatureCombs?: Float32Array;

  private worker: Worker;

  constructor(private host: ReactiveControllerHost) {
    this.host.addController(this);
    this.worker = new Worker(new URL('./workers/board-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.onMessage;
  }

  hostConnected() {}
  hostDisconnected() {
    this.worker.terminate();
  }

  propose(action: BoardAction) {
    this.worker.postMessage({ type: 'PROPOSE', action });
  }

  private onMessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;
    if (msg.type === "STATE_UPDATED" && msg.state && msg.mesh) {
      this.model = msg.state;
      this.mesh = msg.mesh;
      this.curvatureCombs = msg.curvatureCombs;
      
      runClientUnscoped(clientLog("debug", "[WasmSamController] State updated", { length: this.model.length }));
      
      this.host.requestUpdate();
    }
  }
}
