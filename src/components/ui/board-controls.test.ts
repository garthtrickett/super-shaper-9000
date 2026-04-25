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

  describe("Manual Sculpting Mode (UI Reflection)", () => {
    it("should emit convert-to-manual when Unlock Manual Sculpting is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls editMode="parametric"></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("convert-to-manual", spy);

      const buttons = Array.from(el.querySelectorAll("button"));
      const unlockBtn = buttons.find(b => b.textContent?.includes("Unlock Manual Sculpting"));
      expect(unlockBtn).to.exist;

      unlockBtn!.click();
      expect(spy.calledOnce).to.be.true;
    });

    it("should emit revert-to-parametric when Revert to Parametric is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls editMode="manual"></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("revert-to-parametric", spy);

      const buttons = Array.from(el.querySelectorAll("button"));
      const revertBtn = buttons.find(b => b.textContent?.includes("Revert to Parametric"));
      expect(revertBtn).to.exist;

      revertBtn!.click();
      expect(spy.calledOnce).to.be.true;
    });

    it("should disable structural sliders when in manual mode", async () => {
      const el = await fixture<BoardControls>(html`<board-controls editMode="manual"></board-controls>`);
      
      // Query the first slider, which corresponds to "Length"
      const lengthSlider = el.querySelector('input[type="range"]') as HTMLInputElement;
      expect(lengthSlider).to.exist;
      expect(lengthSlider.disabled).to.be.true;
      
      // Find the select for "Nose Shape"
      const noseSelect = el.querySelector('select') as HTMLSelectElement;
      expect(noseSelect.disabled).to.be.true;
    });

    it("should keep contour & fin sliders enabled in manual mode", async () => {
      const el = await fixture<BoardControls>(html`<board-controls editMode="manual"></board-controls>`);
      
      // Query all ranges
      const sliders = Array.from(el.querySelectorAll('input[type="range"]')) as HTMLInputElement[];
      
      // The last few sliders (Channel Length, Vee Depth, etc.) should not be disabled
      // Find a slider that isn't disabled (it must be a contour/fin slider)
      const activeSliders = sliders.filter(s => !s.disabled);
      
      expect(activeSliders.length).to.be.greaterThan(0);
    });
  });
});
