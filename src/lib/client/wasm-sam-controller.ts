import type { ReactiveController, ReactiveControllerHost } from "lit";

export class WasmSamController<T extends ReactiveControllerHost> implements ReactiveController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public model: any = null;
  public mesh: Float32Array | null = null;
  private worker: Worker;

  constructor(private host: T) {
    this.host.addController(this);
    this.worker = new Worker(new URL("./workers/board-worker.ts", import.meta.url), { type: "module" });
    
    this.worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === "STATE_UPDATED") {
        this.model = e.data.state;
        this.mesh = e.data.mesh;
        
        console.log("🌊 [WasmSamController] Shadow State Updated!", {
          model: this.model,
          meshLength: this.mesh ? this.mesh.length : 0
        });
        
        this.host.requestUpdate();
      }
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  propose(action: any) {
    this.worker.postMessage({ type: "PROPOSE", action });
  }

  hostConnected() {}
  
  hostDisconnected() {
    this.worker.terminate();
  }
}
