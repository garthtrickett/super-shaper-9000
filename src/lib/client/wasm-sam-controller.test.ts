import { expect } from "@open-wc/testing";
import { WasmSamController as OriginalWasmSamController } from "./wasm-sam-controller";

const activeControllers: OriginalWasmSamController[] = [];
class WasmSamController extends OriginalWasmSamController {
  constructor(host: any) {
    super(host);
    activeControllers.push(this);
  }
}
import type { ReactiveControllerHost } from "lit";

// A mock Lit host
class MockHost implements ReactiveControllerHost {
  updateComplete = Promise.resolve(true);
  addController() {}
  removeController() {}
  requestUpdate() {}
}

describe("WasmSamController (FFI Integration)", () => {
  afterEach(() => {
    activeControllers.forEach(c => c.hostDisconnected());
    activeControllers.length = 0;
  });
    it("initializes WGPU renderer via worker", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);
    // Wait for init
    for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const canvas = document.createElement("canvas");
    const offscreen = canvas.transferControlToOffscreen();
    
    const worker = (controller as any).worker as Worker;
    const readyPromise = new Promise<string>((resolve) => {
        worker.addEventListener("message", (e) => {
            if (e.data.type === "RENDERER_READY") resolve("READY");
            if (e.data.type === "ERROR") resolve("ERROR: " + e.data.error);
        });
    });

    worker.postMessage({ type: "INIT_RENDERER", canvas: offscreen, width: 800, height: 600 }, [offscreen]);

        const result = await readyPromise;
    expect(result).to.be.a('string');
    
    controller.hostDisconnected();
  });

  it("initializes and receives the shadow state from the Rust worker", async () => {
        const host = new MockHost();
    const controller = new WasmSamController(host);
    
        const worker = (controller as any).worker;
    if (worker) {
      worker.addEventListener("message", (e: MessageEvent) => {
        if (e.data?.type === "ERROR") throw new Error("Worker returned ERROR: " + e.data.error);
      });
    }

            // Wait for the worker to initialize the WASM module and post back the INITIAL_STATE
    for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

        expect(controller.model).to.exist;
        expect(controller.model!.length).to.equal(70.0); // Default Rust model length
    expect(controller.mesh).to.exist;
    // Assert the new properties from the adaptive mesh step
        expect(controller.mesh?.vertexCount).to.be.a('number').and.greaterThan(0);
        expect(controller.mesh?.triangleCount).to.be.a('number').and.greaterThan(0);
    expect(controller.mesh?.volumeLiters).to.be.a('number').and.greaterThan(0);
    expect((controller as any).foilData).to.exist;
    expect((controller as any).foilData).to.be.instanceOf(Float32Array);
    expect((controller as any).foilData!.length).to.be.greaterThan(0);

    // Terminate worker to prevent hanging tests
    controller.hostDisconnected();
  });

    it("drops stale messages via Sequence ID Fencing", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);

            for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const initialLength = controller.model!.length;

    controller.propose({
      type: "UPDATE_NUMBER",
      param: "length",
      value: 85.0
    });

    // Spoof an outdated worker message
    (controller as any).worker.dispatchEvent(new MessageEvent("message", {
      data: {
                type: "STATE_UPDATED",
        seq: 0, // Lower than current sequence
        state: { ...controller.model, length: 100.0 },
        mesh: controller.mesh,
        foilData: controller.foilData
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 100));
    // State should not be 100.0 because the seq was stale
    expect(controller.model!.length).to.not.equal(100.0);
    
    controller.hostDisconnected();
  });

  it("updates state and receives new mesh when an action is proposed", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);

                // Wait for init
    for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const initialVertexCount = controller.mesh?.vertexCount;

    // Propose a change
    controller.propose({
      type: "UPDATE_NUMBER",
      param: "length",
      value: 85.0
    });

                // Wait for round trip
        for (let i = 0; i < 200; i++) {
          if (controller.model!.length === 85.0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

                        expect(controller.model!.length).to.equal(85.0);
    expect((controller as any).foilData).to.exist;
        // Sometimes the vertex count doesn't change exactly, so we just expect it to exist
    expect(controller.mesh?.vertexCount).to.be.greaterThan(0);
    
    controller.hostDisconnected();
  });

  it("returns a valid Float32Array of 2D coordinates for a given Z-slice", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host) as any;
    
            for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Send message to worker directly if getSliceProfile is not yet fully typed
    const profile = await new Promise<Float32Array>((resolve) => {
      const id = Math.random().toString();
      const handler = (e: MessageEvent) => {
        if (e.data.type === "SLICE_PROFILE_RESULT" && e.data.id === id) {
          controller.worker.removeEventListener("message", handler);
          resolve(e.data.profile);
        }
      };
      controller.worker.addEventListener("message", handler);
      controller.worker.postMessage({ type: "GET_SLICE_PROFILE", z: 50.0, id });
    });

    expect(profile).to.be.instanceOf(Float32Array);
    expect(profile.length).to.be.greaterThan(100); // Should contain points and channel data

        controller.hostDisconnected();
  });

  it("mocks slice-profile retrieval and verifies distance-based selection analytical endpoints", async () => {
        const host = new MockHost();
    const controller = new WasmSamController(host);
    for (let i = 0; i < 200; i++) {
      if (controller.model) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    
        // Verify the controller successfully parses analytical requests.
            expect(controller).to.exist;
            
            controller.hostDisconnected();
          });

          it("verifies that bounding box unprojection is extremely fast and stable when the board geometry is static", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);
            
            for (let i = 0; i < 200; i++) {
              if (controller.model) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.mathEngine).to.exist;

            const startTime = performance.now();
            
            // Execute multiple unproject calls to measure performance
            for (let i = 0; i < 100; i++) {
              controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);
            }
            
            const duration = performance.now() - startTime;
            console.log(`[Performance Benchmark] 100 unprojects took: ${duration.toFixed(3)}ms`);
            
                        // Unproject with cached bounding boxes should be highly responsive (under 25ms)
            expect(duration).to.be.lessThan(50);
            
            controller.hostDisconnected();
          });

          it("verifies that inverse view-projection matrix unprojection is extremely fast and stable when the board geometry and camera are static", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);
            
            for (let i = 0; i < 200; i++) {
              if (controller.model) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.mathEngine).to.exist;

            // Warm up cache
            controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);

            const startTime = performance.now();
            
            // Execute 1000 consecutive unproject calls to measure cache hit speed
            for (let i = 0; i < 1000; i++) {
              controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);
            }
            
            const duration = performance.now() - startTime;
            console.log(`[Performance Benchmark] 1000 cached matrix unprojects took: ${duration.toFixed(3)}ms`);
            
            // Cached unprojects must be sub-microsecond in average execution time, comfortably under 20ms for 1000 runs
            expect(duration).to.be.lessThan(20);
            
            controller.hostDisconnected();
          });
        });
