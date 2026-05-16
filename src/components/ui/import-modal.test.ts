import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./import-modal";
import type { ImportModal } from "./import-modal";

describe("ImportModal", () => {
  it("shows an error for invalid JSON", async () => {
    const el = await fixture<ImportModal>(html`<import-modal></import-modal>`);
    const textarea = el.querySelector("textarea")!;
    const applyButton = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.includes("Apply Design"))!;
    
    textarea.value = "{ invalid json";
    textarea.dispatchEvent(new Event("input"));
    
    applyButton.click();
    await el.updateComplete;
    
    expect(el.textContent).to.include("Invalid JSON format");
  });

  it("emits import-json event for valid BoardModel JSON", async () => {
    const el = await fixture<ImportModal>(html`<import-modal></import-modal>`);
    const textarea = el.querySelector("textarea")!;
    const applyButton = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.includes("Apply Design"))!;
    
    const validJson = JSON.stringify({
      length: 70, width: 20, thickness: 2.5,
      finSetup: "quad",
      frontFinZ: 11, frontFinX: 1.25, rearFinZ: 6, rearFinX: 1.5,
      toeAngle: 3, cantAngle: 6,
      tailType: "squash", swallowDepth: 4,
      coreMaterial: "pu", glassingSchedule: "heavy",
      outline: { controlPoints: [], tangents1: [], tangents2: [] },
      rockerTop: { controlPoints: [], tangents1: [], tangents2: [] },
      rockerBottom: { controlPoints: [], tangents1: [], tangents2: [] },
      crossSections: []
    });
    
    textarea.value = validJson;
    textarea.dispatchEvent(new Event("input"));
    
    const spy = sinon.spy();
    el.addEventListener("import-json", spy);
    
    applyButton.click();
    await el.updateComplete;
    
    expect(spy.calledOnce).to.be.true;
    expect(spy.firstCall.args[0].detail.state).to.exist;
  });

  it("emits close event when Cancel is clicked", async () => {
    const el = await fixture<ImportModal>(html`<import-modal></import-modal>`);
    const cancelButton = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.includes("Cancel"))!;
    
    const spy = sinon.spy();
    el.addEventListener("close", spy);
    
    cancelButton.click();
    expect(spy.calledOnce).to.be.true;
  });
});
