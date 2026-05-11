import type { ReactiveController, ReactiveControllerHost } from "lit";
import { type BoardModel, type BoardAction, INITIAL_STATE } from "../../components/pages/board-builder-page.logic";
import type { RustMesh } from "../../components/3d/board-viewport";
import init, { WasmEngine } from './wasm/surfer_wasm.js';
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
  public mathEngine: WasmEngine | null = null;

  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
    
    // Initialize synchronous math engine for the UI (Instant calculations like Gizmo snapping)
    init().then(() => {
      this.mathEngine = new WasmEngine();
      this.mathEngine.propose({ type: "LOAD_DESIGN", state: INITIAL_STATE });
      this.host.requestUpdate();
    });

    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (e: MessageEvent) => {
      if (e.data.type === "STATE_UPDATED") {
        if (e.data.seq !== undefined && e.data.seq < this.currentSequence) return;
        this.model = e.data.state;
        this.mesh = e.data.mesh;
        this.curvatureCombs = e.data.curvatureCombs;
        this.foilData = e.data.foilData;
        this.host.requestUpdate();
      }
    });
  }

  propose(action: BoardAction) {
    this.currentSequence++;
    
    // Keep local math engine perfectly in sync with the worker's reality
    if (this.mathEngine) {
      try {
        this.mathEngine.propose(action);
      } catch (e) {
        console.error("Math engine failed to process action:", e);
      }
    }

    this.worker.postMessage({ type: "PROPOSE", action, seq: this.currentSequence });
  }

  hostConnected() {}

  hostDisconnected() {
    this.worker.terminate();
    if (this.mathEngine) {
      this.mathEngine.free();
    }
  }
}
