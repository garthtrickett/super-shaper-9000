import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./board-controls";
import type { BoardControls } from "./board-controls";

describe("BoardControls (UI Component)", () => {
  describe("Event Dispatching", () => {
    it("should emit number-changed event when slider is moved", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("number-changed", spy);

      // We query for a specific generic slider (e.g. Length) because Fin sliders map to update-fin-dimension now
      const inputs = Array.from(el.querySelectorAll('input[type="range"]')) as HTMLInputElement[];
      const lengthInput = inputs.find(i => i.max === "120" || i.step === "0.5"); // Length slider properties
      expect(lengthInput).to.exist;
      
      lengthInput!.value = "72";
      lengthInput!.dispatchEvent(new Event("input"));

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "length", value: 72 });
    });

    it("should emit string-changed event when select is changed", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("string-changed", spy);

      const select = el.querySelector("select") as HTMLSelectElement;
      expect(select).to.exist;

      select.value = "thruster";
      select.dispatchEvent(new Event("change"));

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "finSetup", value: "thruster" });
    });

    it("should emit import-design event when Import JSON button is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("import-design", spy);

      const buttons = Array.from(el.querySelectorAll("button"));
      const btn = buttons.find(b => b.textContent?.includes("Import Design"));
      expect(btn).to.exist;

      btn!.click();
      expect(spy.calledOnce).to.be.true;
    });

    it("should emit export-design event when Export JSON button is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("export-design", spy);

      const buttons = Array.from(el.querySelectorAll("button"));
      const btn = buttons.find(b => b.textContent?.includes("Export JSON"));
      expect(btn).to.exist;

      btn!.click();
      expect(spy.calledOnce).to.be.true;
    });

    it("should emit export-s3dx event when Export .s3dx button is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("export-s3dx", spy);

      const buttons = Array.from(el.querySelectorAll("button"));
      const btn = buttons.find(b => b.textContent?.includes("Export .s3dx"));
      expect(btn).to.exist;

      btn!.click();
      expect(spy.calledOnce).to.be.true;
    });
  });

});
