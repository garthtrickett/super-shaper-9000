import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./component-library-modal";
import type { ComponentLibraryModal } from "./component-library-modal";
import { saveComponentToLibrary } from "../../lib/client/component-library-store";
import type { ComponentPayload } from "../pages/board-builder-page.logic";

describe("ComponentLibraryModal (UI Component)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders empty library message on initialization", async () => {
    const el = await fixture<ComponentLibraryModal>(html`<component-library-modal></component-library-modal>`);
    expect(el.textContent).to.include("No saved outlines");
  });

  it("toggles tabs and updates the UI empty state representation", async () => {
    const el = await fixture<ComponentLibraryModal>(html`<component-library-modal></component-library-modal>`);
    const buttons = Array.from(el.querySelectorAll("button"));
    const rockerTab = buttons.find(b => b.textContent?.trim() === "Rockers");
    expect(rockerTab).to.exist;

    rockerTab!.click();
    await el.updateComplete;

    expect(el.textContent).to.include("No saved rockers");
  });

  it("renders indexed library items and fires import event on Load click", async () => {
    const payload: ComponentPayload = {
      outline: {
        controlPoints: [[0, 0, -35], [9, 0, 0], [0, 0, 35]],
        tangents1: [[0, 0, -45], [9, 0, -10], [0, 0, 25]],
        tangents2: [[0, 0, -25], [9, 0, 10], [0, 0, 45]],
        weights: [1, 1, 1],
      },
    };
    const id = saveComponentToLibrary("My Swallow Outline", "outline", payload);

    const el = await fixture<ComponentLibraryModal>(html`<component-library-modal></component-library-modal>`);
    await el.updateComplete;

    expect(el.textContent).to.include("My Swallow Outline");

    const spy = sinon.spy();
    el.addEventListener("import-component", spy);

    const loadBtn = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.trim() === "Load");
    expect(loadBtn).to.exist;
    loadBtn!.click();

    expect(spy.calledOnce).to.be.true;
    const detail = spy.firstCall.args[0].detail;
    expect(detail.type).to.equal("outline");
    expect(detail.payload.outline.controlPoints.length).to.equal(3);
  });

  it("emits close event when Close is clicked", async () => {
    const el = await fixture<ComponentLibraryModal>(html`<component-library-modal></component-library-modal>`);
    const spy = sinon.spy();
    el.addEventListener("close", spy);

    const closeBtn = Array.from(el.querySelectorAll("button")).find(b => b.textContent?.trim() === "Close");
    expect(closeBtn).to.exist;
    closeBtn!.click();

    expect(spy.calledOnce).to.be.true;
  });
});