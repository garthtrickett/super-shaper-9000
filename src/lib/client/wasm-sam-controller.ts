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
    console.info("[WasmSamController] Starting main-thread synchronous mathEngine init...");
    
    // Initialize synchronous math engine for the UI (Instant calculations like Gizmo snapping)
    init().then(() => {
      runClientUnscoped(clientLog("info", "[WasmSamController] Synchronous WASM initialized. Instantiating main-thread WasmEngine..."));
      console.info("[WasmSamController] Synchronous WASM initialized. Instantiating main-thread WasmEngine...");
      this.mathEngine = new WasmEngine();
      this.mathEngine.propose({ type: "LOAD_DESIGN", state: INITIAL_STATE });
      runClientUnscoped(clientLog("info", "[WasmSamController] Main-thread WasmEngine instantiated and synchronized."));
      console.info("[WasmSamController] Main-thread WasmEngine instantiated and synchronized.");
      this.host.requestUpdate();
    }).catch(err => { 
      runClientUnscoped(clientLog("error", "[WasmSamController] Main-thread mathEngine init failed!", err));
      console.error("[WasmSamController] Main-thread mathEngine init failed!", err);
    });

    runClientUnscoped(clientLog("info", "[WasmSamController] Instantiating Web Worker thread..."));
    console.info("[WasmSamController] Instantiating Web Worker thread...");
    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    
        this.worker.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data;
      
      try {
          if (msg.type === "STATE_UPDATED") {
            if (msg.seq !== undefined && msg.seq < this.currentSequence) {
              return;
            }

            if (this.mathEngine) {
              try {
                this.mathEngine.propose_state_only({ type: "LOAD_DESIGN", state: msg.state });
              } catch (e) {
                console.error("[WasmSamController] Failed to sync main-thread mathEngine with worker state:", e);
              }
            }

            this.model = msg.state;
            this.mesh = msg.stats;
            this.foilData = msg.foilData;
            this.host.requestUpdate();
          } else if (msg.type === "ERROR") {
            runClientUnscoped(clientLog("error", `[WasmSamController] Error received from Web Worker thread: ${msg.error}`));
            console.error(`[WasmSamController] Error received from Web Worker thread: ${msg.error}`);
          }
      } catch (err) {
          console.error("[WasmSamController] CRITICAL EXCEPTION in main thread message listener!", err);
      } 
    });
    runClientUnscoped(clientLog("info", "[WasmSamController] Web Worker instantiated. Handlers registered."));
    console.info("[WasmSamController] Web Worker instantiated. Handlers registered.");
  }

  private _isGeometryAltering(action: BoardAction): boolean {
    if (action.type === "SELECT_NODE" || action.type === "SAVE_HISTORY_SNAPSHOT" || action.type === "UPDATE_BOOLEAN") {
      return false;
    }
    if (action.type === "UPDATE_NUMBER" && action.param === "mriSlicePosition") {
      return false;
    }
    return true;
  }

    propose(action: BoardAction) {
    this.currentSequence++;
    
    // Optimistically apply non-geometry-altering actions on the main thread for instantaneous UI response
    if (!this._isGeometryAltering(action) && this.mathEngine) {
      try {
        if ((this.mathEngine as any).propose_state_only) {
          (this.mathEngine as any).propose_state_only(action);
          this.model = (this.mathEngine as any).get_state();
          this.host.requestUpdate();
        }
      } catch (err) {
        console.error("[WasmSamController] Failed to optimistically apply action on main thread:", err);
      }
    }

    this.worker.postMessage({ type: "PROPOSE", action, seq: this.currentSequence });
  }

  hostConnected() {}

  hostDisconnected() {
    runClientUnscoped(clientLog("info", "[WasmSamController] Component disconnecting. Terminating Web Worker..."));
    console.info("[WasmSamController] Component disconnecting. Terminating Web Worker...");
    this.worker.terminate();
    if (this.mathEngine) { 
      runClientUnscoped(clientLog("info", "[WasmSamController] Freeing synchronous main-thread mathEngine..."));
      console.info("[WasmSamController] Freeing synchronous main-thread mathEngine...");
      this.mathEngine.free();
      this.mathEngine = null;
    }
  }
}
