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
    expect(controller.model.length).to.equal(70.0); // Default Rust model length
    expect(controller.mesh).to.exist;
    expect(controller.mesh?.vertices).to.exist;

    // Terminate worker to prevent hanging tests
    controller.hostDisconnected();
  });

  it("updates state and receives new mesh when an action is proposed", async () => {
    const host = new MockHost();
    const controller = new WasmSamController(host);

    // Wait for init
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Propose a change
    controller.propose({
      type: "UPDATE_NUMBER",
      param: "length",
      value: 85.0
    });

    // Wait for round trip
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(controller.model.length).to.equal(85.0);
    
    controller.hostDisconnected();
  });
});
