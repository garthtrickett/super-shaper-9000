import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./export-modal";
import type { ExportModal } from "./export-modal";

describe("ExportModal", () => {
  it("renders the provided JSON string in a readonly textarea", async () => {
    const json = '{"test": 123}';
    const el = await fixture<ExportModal>(html`<export-modal .jsonString=${json}></export-modal>`);
    
    const textarea = el.querySelector("textarea")!;
    expect(textarea).to.exist;
    expect(textarea.value).to.equal(json);
    expect(textarea.hasAttribute("readonly")).to.be.true;
  });

  it("emits a close event when Close is clicked", async () => {
    const el = await fixture<ExportModal>(html`<export-modal></export-modal>`);
    const closeButton = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.includes("Close"))!;
    
    const spy = sinon.spy();
    el.addEventListener("close", spy);
    
    closeButton.click();
    expect(spy.calledOnce).to.be.true;
  });

  it("writes to clipboard and emits close event when Copy to Clipboard is clicked", async () => {
    const json = '{"test": 123}';
    const el = await fixture<ExportModal>(html`<export-modal .jsonString=${json}></export-modal>`);
    const copyButton = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.includes("Copy to Clipboard"))!;
    
    // Stub navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {}
      },
      configurable: true
    });
    const writeTextSpy = sinon.spy(navigator.clipboard, "writeText");
    
    const spy = sinon.spy();
    el.addEventListener("close", spy);
    
    copyButton.click();
    
    expect(writeTextSpy.calledOnceWith(json)).to.be.true;
    expect(spy.calledOnce).to.be.true;
  });
});
