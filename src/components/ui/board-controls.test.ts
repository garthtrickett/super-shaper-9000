import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./board-controls";
import type { BoardControls } from "./board-controls";

describe("BoardControls", () => {
  it("should emit number-changed event when slider is moved", async () => {
    const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
    const spy = sinon.spy();
    el.addEventListener("number-changed", spy);

    const input = el.querySelector('input[type="range"]') as HTMLInputElement;
    expect(input).to.exist;
    
    input.value = "80";
    input.dispatchEvent(new Event("input"));

    expect(spy.calledOnce).to.be.true;
    expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "length", value: 80 });
  });

  it("should emit string-changed event when select is changed", async () => {
    const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
    const spy = sinon.spy();
    el.addEventListener("string-changed", spy);

    const select = el.querySelector("select") as HTMLSelectElement;
    expect(select).to.exist;

    select.value = "pointy";
    select.dispatchEvent(new Event("change"));

    expect(spy.calledOnce).to.be.true;
    expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "noseShape", value: "pointy" });
  });
});
