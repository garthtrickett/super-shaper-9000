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
  public foilData?: Float32Array;
  
  public worker: Worker;
  public currentSequence = 0;

  constructor(private host: ReactiveControllerHost) {
    this.host.addController(this);
    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", this.onMessage);
  }

  public hostConnected() {}

  public hostDisconnected() {
    this.worker.terminate();
  }

  private onMessage = (e: MessageEvent<unknown>) => {
    const msg = e.data as WorkerMessage;
    if (!msg || typeof msg !== 'object') return;
    
    if (msg.seq !== undefined && msg.seq < this.currentSequence) {
      runClientUnscoped(clientLog("info", "Dropped stale worker message"));
      return;
    }

    if (msg.type === "STATE_UPDATED") {
      this.model = msg.state;
      this.mesh = msg.mesh;
      this.curvatureCombs = msg.curvatureCombs;
      this.foilData = msg.foilData;
      this.host.requestUpdate();
    }
  };

  public propose(action: BoardAction) {
    this.currentSequence++;
    this.worker.postMessage({
      type: "PROPOSE",
      seq: this.currentSequence,
      action
    });
  }
}
