import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./board-controls";
import type { BoardControls } from "./board-controls";

describe("BoardControls (UI Component)", () => {
  describe("Event Dispatching", () => {
    it("should emit number-changed event when length slider is moved", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("number-changed", spy);

      // Robustly find the length slider by its associated label
      const labels = Array.from(el.querySelectorAll('label'));
      const lengthLabel = labels.find(l => l.textContent?.includes("Length"));
      expect(lengthLabel, "Could not find a label for 'Length'").to.exist;

      const lengthInput = lengthLabel!.parentElement!.parentElement!.querySelector('input[type="range"]') as HTMLInputElement;
      expect(lengthInput, "Could not find range input associated with 'Length' label").to.exist;
      
      lengthInput.value = "72";
      lengthInput.dispatchEvent(new Event("input"));

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "length", value: 72 });
    });

    it("should emit string-changed event when fin setup select is changed", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("string-changed", spy);

      const selects = Array.from(el.querySelectorAll("select")) as HTMLSelectElement[];
      const setupSelect = selects.find(s => s.innerHTML.includes("Thruster"));
      expect(setupSelect).to.exist;

      setupSelect!.value = "thruster";
      setupSelect!.dispatchEvent(new Event("change"));

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

    it("should emit boolean-changed event when Curvature toggle is clicked", async () => {
      const el = await fixture<BoardControls>(html`<board-controls></board-controls>`);
      const spy = sinon.spy();
      el.addEventListener("boolean-changed", spy);

      const labels = Array.from(el.querySelectorAll("label"));
      const curveLabel = labels.find(l => l.textContent?.includes("Curvature"));
      expect(curveLabel, "Could not find a label for 'Curvature'").to.exist;

      const curveInput = curveLabel!.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(curveInput, "Could not find checkbox input associated with 'Curvature' label").to.exist;

      curveInput.checked = true;
      curveInput.dispatchEvent(new Event("change"));

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].detail).to.deep.equal({ param: "showCurvature", value: true });
    });
  });

  describe("Rendering", () => {
    it("should display vertex and triangle counts when properties are set", async () => {
      const el = await fixture<BoardControls>(html`
        <board-controls
          .vertexCount=${12345}
          .triangleCount=${23456}
        ></board-controls>
      `);
      await el.updateComplete;

      const vertexText = el.querySelector('div.text-xl.font-black.text-zinc-400.tracking-tighter');
      const triangleText = el.querySelectorAll('div.text-xl.font-black.text-zinc-400.tracking-tighter')[1];

      // Test that "12.3k" and "23.5k" are rendered correctly
      expect(vertexText?.textContent).to.include('12.3');
      expect(triangleText?.textContent).to.include('23.5');
    });
  });
});
