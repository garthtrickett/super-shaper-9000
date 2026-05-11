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
  public worker: Worker;
  public model?: BoardModel;
  public mesh?: RustMesh;
  public curvatureCombs?: Float32Array;
  public foilData?: Float32Array;

  public currentSequence = 0;
  private lastAcceptedSequence = 0;

  constructor(private host: ReactiveControllerHost) {
    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    this.host.addController(this);
    
    this.worker.addEventListener("message", (e: MessageEvent) => {
      const data = e.data;
      
      if (data.seq !== undefined) {
        if (data.seq < this.lastAcceptedSequence) {
          console.warn(`[WasmSamController] Dropped stale message seq: ${data.seq} (current: ${this.lastAcceptedSequence})`);
          return;
        }
        this.lastAcceptedSequence = data.seq;
      }
      
      if (data.type === "STATE_UPDATED") {
        this.model = data.state;
        this.mesh = data.mesh;
        this.curvatureCombs = data.curvatureCombs;
        this.foilData = data.foilData;
        this.host.requestUpdate();
      }
    });
  }

  propose(action: BoardAction) {
    this.currentSequence++;
    this.worker.postMessage({ type: "PROPOSE", action, seq: this.currentSequence });
  }

  hostConnected() {}
  hostDisconnected() {
    this.worker.terminate();
  }
}
