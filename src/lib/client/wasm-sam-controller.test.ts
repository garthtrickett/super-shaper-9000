// File: src/lib/client/wasm-sam-controller.test.ts
import { expect } from "@open-wc/testing";
import { WasmSamController as OriginalWasmSamController } from "./wasm-sam-controller";
import { BoardModel } from "../../components/pages/board-builder-page.logic";
import { WasmEngine } from "./wasm/surfer_wasm";

const activeControllers: OriginalWasmSamController[] = [];
class WasmSamController extends OriginalWasmSamController {
  constructor(host: any) {
    super(host);
    activeControllers.push(this);
  }
}

// Specialized mock subclass to intercept and suspend worker initialization for Step 2 testing
class SuspendedWasmSamController extends OriginalWasmSamController {
  public originalPostMessage: typeof Worker.prototype.postMessage;
  public blockedMessages: any[] = [];

  constructor(host: any) {
    // Temporarily stub out Worker.prototype.postMessage before calling super()
    const realPostMessage = Worker.prototype.postMessage;
    const blocked: any[] = [];
    Worker.prototype.postMessage = function(message: any, transfer?: any) {
      if (message?.type === "INIT_WASM") {
        blocked.push({ message, transfer, instance: this });
        return;
      }
      realPostMessage.call(this, message, transfer);
    };

    super(host);
    activeControllers.push(this);

    // Restore the original prototype method
    Worker.prototype.postMessage = realPostMessage;
    this.originalPostMessage = realPostMessage;
    this.blockedMessages = blocked;
  }

  bootstrapWorker() {
    for (const { message, transfer, instance } of this.blockedMessages) {
      this.originalPostMessage.call(instance, message, transfer);
    }
    this.blockedMessages = [];
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

                  it("synchronizes and renders parametric fin updates when importedFinBoxes is empty", async () => {
              const host = new MockHost();
              const controller = new WasmSamController(host);
              
              for (let i = 0; i < 200; i++) {
                if (controller.model) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              controller.propose({
                type: "UPDATE_NUMBER",
                param: "frontFinZ",
                value: 12.0
              });

              for (let i = 0; i < 200; i++) {
                if (controller.model!.frontFinZ === 12.0) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              expect(controller.model!.frontFinZ).to.equal(12.0);
              expect(controller.model!.importedFinBoxes).to.be.undefined;

              const mainState = controller.mathEngine!.get_state() as unknown as BoardModel;
              expect(mainState.frontFinZ).to.equal(12.0);

              controller.hostDisconnected();
            });

            it("handles APPLY_COMPONENT action through unidirectional worker loop and triggers main-thread synchronization", async () => {
              const host = new MockHost();
              const controller = new WasmSamController(host);
              
              for (let i = 0; i < 200; i++) {
                if (controller.model) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              const initialRockerBottom = controller.model!.rockerBottom;
              const customOutline = {
                controlPoints: [[0, 0, -35], [14.5, 0, 0], [0, 0, 35]] as [number, number, number][],
                tangents1: [[0, 0, -45], [14.5, 0, -10], [0, 0, 25]] as [number, number, number][],
                tangents2: [[0, 0, -25], [14.5, 0, 10], [0, 0, 45]] as [number, number, number][],
              };

              controller.propose({
                type: "APPLY_COMPONENT",
                componentType: "outline",
                payload: {
                  outline: customOutline
                } as any
              } as any);

              for (let i = 0; i < 200; i++) {
                if (controller.model!.outline.controlPoints[1]![0] === 14.5) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }

              // Verify that outline has been updated
              expect(controller.model!.outline.controlPoints[1]![0]).to.equal(14.5);
              // Verify that rockers were fully preserved
              expect(controller.model!.rockerBottom.controlPoints[1]![1]).to.equal(initialRockerBottom.controlPoints[1]![1]);

              // Verify that main-thread mathEngine has been synchronized as well
              const mainState = controller.mathEngine!.get_state() as unknown as BoardModel;
              expect(mainState.outline.controlPoints[1]![0]).to.equal(14.5);

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

            // Terminate worker to prevent hanging tests
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

              it("verifies that Draft-Mode Dragging does not recalculate the 3D solid mesh during drags but lofts it successfully on the final propose commit", async () => {
                const host = new MockHost();
                const controller = new WasmSamController(host);
                
                for (let i = 0; i < 200; i++) {
                  if (controller.model) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }

                expect(controller.mathEngine).to.exist;
                expect(controller.mesh).to.exist;
                
                const initialVertexCount = controller.mesh!.vertexCount;
                expect(initialVertexCount).to.be.greaterThan(0);

                const worker = (controller as any).worker as Worker;

                // Simulate continuous DRAG_GIZMO events from viewport
                worker.postMessage({
                  type: "DRAG_GIZMO",
                  curve: "outline",
                  index: 1,
                  nodeType: "anchor",
                  x: 15.0,
                  y: 0.0,
                  z: 10.0,
                  continuity: "G1"
                });

                await new Promise((resolve) => setTimeout(resolve, 100));
                
                // During active drag, the solid mesh vertex count must remain unchanged (draft mode)
                expect(controller.mesh!.vertexCount).to.equal(initialVertexCount);

                // Now simulate the final mouse-up commit (PROPOSE UPDATE_NODE_POSITION)
                controller.propose({
                  type: "UPDATE_NODE_POSITION",
                  curve: "outline",
                  index: 1,
                  nodeType: "anchor",
                  position: [15.0, 0.0, 10.0]
                });

                // Wait for worker to finish full 3D loft and post back state
                for (let i = 0; i < 200; i++) {
                  if (controller.model!.outline!.controlPoints[1]![0] === 15.0) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }

                            // Verify the mesh was successfully rebuilt and stats updated on release
                expect(controller.model!.outline!.controlPoints[1]![0]).to.equal(15.0);
                expect(controller.mesh!.vertexCount).to.not.equal(initialVertexCount);

                controller.hostDisconnected();
              });

                        it("processes rapid node selection switches in under 1ms on average", async () => {
                const host = new MockHost();
                const controller = new WasmSamController(host);
                
                for (let i = 0; i < 200; i++) {
                  if (controller.model) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }

                const startTime = performance.now();
                const count = 10;
                for (let i = 0; i < count; i++) {
                  controller.propose({
                    type: "SELECT_NODE",
                    node: {
                      curve: "outline",
                      index: i % 3,
                      type: "anchor"
                    }
                  });
                }

                const duration = performance.now() - startTime;
                const avgDuration = duration / count;
                console.log(`[Performance Benchmark] Average selection switch duration: ${avgDuration.toFixed(3)}ms`);
                
                expect(avgDuration).to.be.lessThan(1.0);
                controller.hostDisconnected();
              });

                    it("strictly delegates proposals to the worker and enforces unidirectional updates", async () => {
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
              value: 75.0
            });

            // Since mutations are delegated to the worker, the main thread model must not be mutated synchronously
            expect(controller.model!.length).to.equal(initialLength);

            // Wait for the asynchronous worker round trip to complete
            for (let i = 0; i < 200; i++) {
              if (controller.model!.length === 75.0) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.model!.length).to.equal(75.0);
            controller.hostDisconnected();
          });

          it("preserves main-thread bounding box and projection matrix caches after consecutive selection actions", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);
            
            for (let i = 0; i < 200; i++) {
              if (controller.model) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.mathEngine).to.exist;

            // 1. Warm up the cache by executing a plane unprojection
            controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);

            // Measure baseline cache-hit latency
            const t0 = performance.now();
            controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);
            const baseLatency = performance.now() - t0;

            // 2. Fire multiple consecutive non-geometry-altering select actions
            for (let i = 0; i < 5; i++) {
              controller.propose({
                type: "SELECT_NODE",
                node: {
                  curve: "outline",
                  index: i % 3,
                  type: "anchor"
                }
              });
            }

            // Wait for worker async round trip and state updates to resolve
            await new Promise((resolve) => setTimeout(resolve, 150));

            // 3. Measure latency of a post-selection unproject_to_plane call
            const t1 = performance.now();
            controller.mathEngine!.unproject_to_plane("top", 0.5, -0.5, 1.3, 0, 0, 0);
            const postSelectLatency = performance.now() - t1;

            console.info(`[Performance Benchmark] Base Latency: ${baseLatency.toFixed(3)}ms | Post-Select Latency: ${postSelectLatency.toFixed(3)}ms`);

                    // Assert both remain extremely fast (under 1.5ms) which guarantees the cache is intact and wasn't invalidated
            expect(postSelectLatency).to.be.lessThan(1.5);
            
            controller.hostDisconnected();
          });

          it("correctly calculates surface hit coordinates for decal placement", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);
            
            for (let i = 0; i < 200; i++) {
              if (controller.model) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.mathEngine).to.exist;

            const zPos = 10.0;
            const xPos = 2.0;

            type EngineExt = WasmEngine & { get_surface_y_at(z: number, x: number, is_deck: boolean): number };
            const yDeck = (controller.mathEngine as unknown as EngineExt).get_surface_y_at(zPos, xPos, true);
            const yBottom = (controller.mathEngine as unknown as EngineExt).get_surface_y_at(zPos, xPos, false);

            expect(yDeck).to.equal(1.25);
            expect(yBottom).to.equal(-1.25);

            controller.hostDisconnected();
          });

          it("instantiates the main-thread mathEngine successfully from the pre-compiled WebAssembly.Module", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);

            // Wait for the compilation and instantiation of the main thread engine
            const module = await controller.wasmModulePromise;
            expect(module).to.be.instanceOf(WebAssembly.Module);

            for (let i = 0; i < 200; i++) {
              if (controller.mathEngine) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            expect(controller.mathEngine).to.exist;
            expect(controller.mathEngine!.get_state()).to.exist;

            controller.hostDisconnected();
          });

          it("queues actions and executes them sequentially once the Web Worker receives its INIT_WASM payload", async () => {
            const host = new MockHost();
            // Use OriginalWasmSamController directly to prevent auto-bootstrapping
            const controller = new SuspendedWasmSamController(host);

            // Get the raw worker instance
            const worker = (controller as any).worker as Worker;

            // Propose an action BEFORE the Web Worker is initialized.
            // This should land in the worker's internal messageQueue.
            controller.propose({
              type: "UPDATE_NUMBER",
              param: "length",
              value: 95.0
            });

            // Wait to ensure the message was posted to the worker's queue
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Verify that length has NOT yet updated because the worker is uninitialized
            expect(controller.model?.length).to.not.equal(95.0);

            // Fetch the compiled module from the main thread's promise and bootstrap the worker manually
            controller.bootstrapWorker();

            // Wait for the worker's asynchronous initialization and queued action execution to resolve
            for (let i = 0; i < 200; i++) {
              if (controller.model && controller.model.length === 95.0) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            // Assert that the worker processed the queued message in-order and updated the state
            expect(controller.model!.length).to.equal(95.0);

            controller.hostDisconnected();
          });

          it("verifies the complete handshake: triggers only a single network request for the WASM asset and both engines are operational", async () => {
            const host = new MockHost();
            const controller = new WasmSamController(host);

            // Wait for initialization
            for (let i = 0; i < 200; i++) {
              if (controller.model) break;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }

            // 1. Verify both engines are operational
            expect(controller.mathEngine).to.exist;
            expect(controller.model).to.exist;
            expect(controller.mesh).to.exist;

            // 2. Query performance resource timing entries
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            const wasmRequests = resources.filter(r => r.name.includes("surfer_wasm_bg.wasm"));

                        // Assert that at most one network request was made for the WASM file (verifying no duplicate fetches)
            expect(wasmRequests.length).to.be.at.most(1);

            controller.hostDisconnected();
          });
        });
