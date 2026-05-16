import { expect } from "@open-wc/testing";
import sinon from "sinon";
import { KeyboardController } from "./keyboard-controller";
import type { ReactiveControllerHost } from "lit";

class MockHost implements ReactiveControllerHost {
  addController() {}
  removeController() {}
  requestUpdate() {}
  updateComplete = Promise.resolve(true);
}

describe("KeyboardController", () => {
  it("triggers onUndo when Cmd/Ctrl+Z is pressed", () => {
    const host = new MockHost();
    const onUndo = sinon.spy();
    const onRedo = sinon.spy();
    const controller = new KeyboardController(host, { onUndo, onRedo });
    
    controller.hostConnected();
    
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true });
    window.dispatchEvent(event);
    
    expect(onUndo.calledOnce).to.be.true;
    expect(onRedo.called).to.be.false;
    
    controller.hostDisconnected();
  });

  it("triggers onRedo when Cmd/Ctrl+Shift+Z is pressed", () => {
    const host = new MockHost();
    const onUndo = sinon.spy();
    const onRedo = sinon.spy();
    const controller = new KeyboardController(host, { onUndo, onRedo });
    
    controller.hostConnected();
    
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true });
    window.dispatchEvent(event);
    
    expect(onRedo.calledOnce).to.be.true;
    expect(onUndo.called).to.be.false;
    
    controller.hostDisconnected();
  });

  it("triggers onRedo when Cmd/Ctrl+Y is pressed", () => {
    const host = new MockHost();
    const onUndo = sinon.spy();
    const onRedo = sinon.spy();
    const controller = new KeyboardController(host, { onUndo, onRedo });
    
    controller.hostConnected();
    
    const event = new KeyboardEvent("keydown", { key: "y", ctrlKey: true });
    window.dispatchEvent(event);
    
    expect(onRedo.calledOnce).to.be.true;
    expect(onUndo.called).to.be.false;
    
    controller.hostDisconnected();
  });

  it("ignores keydown events originating from INPUT or TEXTAREA", () => {
    const host = new MockHost();
    const onUndo = sinon.spy();
    const onRedo = sinon.spy();
    const controller = new KeyboardController(host, { onUndo, onRedo });
    
    controller.hostConnected();
    
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true });
    input.dispatchEvent(event);
    
    expect(onUndo.called).to.be.false;
    
    document.body.removeChild(input);
    controller.hostDisconnected();
  });
});
