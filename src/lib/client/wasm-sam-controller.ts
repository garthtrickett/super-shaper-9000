/* eslint-disable */
import  type { ReactiveController, ReactiveControllerHost } from "lit";
import { type BoardModel, type BoardAction, INITIAL_STATE } from "../../components/pages/board-builder-page.logic";
import type { RustMesh } from "../../components/3d/board-viewport";
import init, { WasmEngine } from './wasm/surfer_wasm.js';

import { clientLog } from "./clientLog";
import { runClientUnscoped } from "./runtime";

interface WorkerMessage {
  type: string;
  state?: BoardModel;
  mesh?: RustMesh;
}

export class WasmSamController implements ReactiveController {
  public model?: BoardModel;
  public mesh?: { volumeLiters: number; vertexCount: number; triangleCount: number };
  public foilData?: Float32Array;
  public worker: Worker;
  public currentSequence = 0;
  public mathEngine: WasmEngine | null = null;

  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
    
    runClientUnscoped(clientLog("info", "[WasmSamController] Starting main-thread synchronous mathEngine init..."));
    
    // Initialize synchronous math engine for the UI (Instant calculations like Gizmo snapping)
    init().then(() => {
      runClientUnscoped(clientLog("info", "[WasmSamController] Synchronous WASM initialized. Instantiating main-thread WasmEngine..."));
      this.mathEngine = new WasmEngine();
      this.mathEngine.propose({ type: "LOAD_DESIGN", state: INITIAL_STATE });
      runClientUnscoped(clientLog("info", "[WasmSamController] Main-thread WasmEngine instantiated and synchronized."));
      this.host.requestUpdate();
    }).catch(err => { 
      runClientUnscoped(clientLog("error", "[WasmSamController] Main-thread mathEngine init failed!", err));
    });

    runClientUnscoped(clientLog("info", "[WasmSamController] Instantiating Web Worker thread..."));
    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    
    this.worker.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "STATE_UPDATED") {
        if (msg.seq !== undefined && msg.seq < this.currentSequence) {
          runClientUnscoped(clientLog("debug", `[WasmSamController] Discarded stale worker update (seq ${msg.seq} < current ${this.currentSequence})`));
          return;
        }
        runClientUnscoped(clientLog("debug", `[WasmSamController] Applying state update for sequence: ${msg.seq}`));
        this.model = msg.state;
        this.mesh = msg.stats;
        this.foilData = msg.foilData;
        this.host.requestUpdate();
      } else if (msg.type === "RENDERER_READY") {
        runClientUnscoped(clientLog("info", "[WasmSamController] Received RENDERER_READY event from Web Worker."));
      } else if (msg.type === "GIZMO_DRAG_COMPLETE") {
        runClientUnscoped(clientLog("debug", "[WasmSamController] Received GIZMO_DRAG_COMPLETE confirmation from Web Worker."));
      } else if (msg.type === "ERROR") {
        runClientUnscoped(clientLog("error", `[WasmSamController] Error received from Web Worker thread: ${msg.error}`));
      } 
    });
    runClientUnscoped(clientLog("info", "[WasmSamController] Web Worker instantiated. Handlers registered."));
  }

  propose(action: BoardAction) {
    this.currentSequence++;
    runClientUnscoped(clientLog("info", `[WasmSamController] Proposing action ${this.currentSequence}: ${action.type}`));
    
    // Keep local math engine perfectly in sync with the worker's reality
    if (this.mathEngine) {
      try {
        if ((this.mathEngine as any).propose_state_only) {
            (this.mathEngine as any).propose_state_only(action);
            // Optimistically update the UI model to prevent input bouncing
            this.model = (this.mathEngine as any).get_state();
            this.host.requestUpdate();
        } else {
            this.mathEngine.propose(action);
        }
      } catch (e) { 
        runClientUnscoped(clientLog("error", "[WasmSamController] Local mathEngine failed to process proposed action!", e));
      }
    }

    this.worker.postMessage({ type: "PROPOSE", action, seq: this.currentSequence });
  }

  hostConnected() {}

  hostDisconnected() {
    runClientUnscoped(clientLog("info", "[WasmSamController] Component disconnecting. Terminating Web Worker..."));
    this.worker.terminate();
    if (this.mathEngine) {
      runClientUnscoped(clientLog("info", "[WasmSamController] Freeing synchronous main-thread mathEngine..."));
      this.mathEngine.free();
      this.mathEngine = null;
    }
  }
}
