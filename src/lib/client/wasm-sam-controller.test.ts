import { expect } from "@open-wc/testing";
import { WasmSamController } from "./wasm-sam-controller";
import type { ReactiveControllerHost } from "lit";

// A mock Lit host
class MockHost implements ReactiveControllerHost {
  updateComplete = Promise.resolve(true);
  addController() {}
  removeController() {}
  requestUpdate() {}
}

describe("WasmSamController (FFI Integration)", () => {
  it("initializes and receives the shadow state from the Rust worker", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);

    // Wait for the worker to initialize the WASM module and post back the INITIAL_STATE
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(controller.model).to.exist;
        expect(controller.model!.length).to.equal(70.0); // Default Rust model length
    expect(controller.mesh).to.exist;
    expect(controller.mesh?.vertices).to.exist;
    // Assert the new properties from the adaptive mesh step
    expect(controller.mesh?.vertexCount).to.be.a('number').and.greaterThan(0);
        expect(controller.mesh?.triangleCount).to.be.a('number').and.greaterThan(0);
    expect(controller.curvatureCombs).to.exist;
    expect(controller.foilData).to.exist;
    expect(controller.foilData).to.be.instanceOf(Float32Array);
    expect(controller.foilData!.length).to.be.greaterThan(0);

    // Terminate worker to prevent hanging tests
    controller.hostDisconnected();
  });

  it("updates state and receives new mesh when an action is proposed", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);

    // Wait for init
    await new Promise((resolve) => setTimeout(resolve, 500));
    const initialVertexCount = controller.mesh?.vertexCount;

    // Propose a change
    controller.propose({
      type: "UPDATE_NUMBER",
      param: "length",
      value: 85.0
    });

    // Wait for round trip
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(controller.model!.length).to.equal(85.0);
    expect(controller.curvatureCombs).to.exist;
    expect(controller.foilData).to.exist;
    // The vertex count should change as the adaptive algorithm responds to new geometry
        expect(controller.mesh?.vertexCount).to.not.equal(initialVertexCount);
    
    controller.hostDisconnected();
  });

  it("returns a valid Float32Array of 2D coordinates for a given Z-slice", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host) as any;
    
    await new Promise((resolve) => setTimeout(resolve, 500));

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
});
