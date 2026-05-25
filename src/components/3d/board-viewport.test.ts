import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import { INITIAL_STATE } from "../pages/board-builder-page.logic";
import "./board-viewport";
import type { BoardViewport } from "./board-viewport";

describe("BoardViewport (3D Component)", () => {
  it("receives the mesh data directly from the parent (sovereign projection) without dispatching sync events", async () => {
    const el = await fixture<BoardViewport>(
      html`<board-viewport .boardState=${INITIAL_STATE} .meshData=${{ vertexCount: 100, triangleCount: 50, volumeLiters: 28.5 } as any}></board-viewport>`
    );
    expect(el.meshData).to.exist;
    expect(el.meshData?.volumeLiters).to.equal(28.5);
  });

  it("should render a wgpu-canvas element in the light DOM", async () => {
    const el = await fixture<BoardViewport>(
      html`<board-viewport></board-viewport>`
    );
    
    const canvas = el.querySelector("canvas#wgpu-canvas");
    expect(canvas).to.exist;
    expect(canvas?.tagName.toLowerCase()).to.equal("canvas");
  });

  it("shows processing spinner when isProcessing is true", async () => {
    const el = await fixture<BoardViewport>(html`<board-viewport .isProcessing=${true}></board-viewport>`);
    
    const spinner = Array.from(el.querySelectorAll('div')).find(div => div.textContent?.includes('Computing'));
    expect(spinner).to.exist;
  });

  describe("Camera & Viewport Controls", () => {
    it("renders profile slice selector and updates active profile slice", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);
      
      // Mock the quad view layout (which renders the selector)
      (el as any).maximizedView = null;
      await el.updateComplete;

      const select = el.querySelector('select');
      expect(select).to.exist;
      
      // By default it should be on slice 0
      expect((el as any).activeProfileSlice).to.equal(0);
      
      // Add a dummy second slice to state to allow selection
      el.boardState = { ...INITIAL_STATE, crossSections: [INITIAL_STATE.crossSections[0], INITIAL_STATE.crossSections[0]] } as any;
      await el.updateComplete;

            select!.value = "1";
      select!.dispatchEvent(new Event("change"));

      expect((el as any).activeProfileSlice).to.equal(1);
    });

    it("clears selected node when active profile slice is changed via select", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${{
        ...INITIAL_STATE,
        selectedNode: { curve: "crossSection_0", index: 0, type: "anchor" },
        crossSections: [INITIAL_STATE.crossSections[0], INITIAL_STATE.crossSections[0]]
      } as any}></board-viewport>`);

      (el as any).maximizedView = null;
      await el.updateComplete;

      const select = el.querySelector('select')!;
      const spy = sinon.spy();
      el.addEventListener("node-selected", spy);

      select.value = "1";
      select.dispatchEvent(new Event("change"));

      expect(spy.calledOnce).to.be.true;
      expect(spy.firstCall.args[0].detail.node).to.be.null;
    });

    it("flips the board container when Flip button is clicked", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);

      const buttons = Array.from(el.querySelectorAll('button'));
      const flipBtn = buttons.find(b => b.title?.includes('Flip'));
      expect(flipBtn).to.exist;

      // Initial state
      expect((el as any).isFlipped).to.be.false;

      // Click flip
      flipBtn!.click();
      await el.updateComplete;

              // Flipped state
        expect((el as any).isFlipped).to.be.true;
      });
    });

      it("renders Fins & Plugs option in Top display settings and toggles it", async () => {
    const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);
    (el as any).maximizedView = null;
    await el.updateComplete;

    const perspectiveCog = el.querySelector('button[title="Display Settings"]') as HTMLButtonElement;
    expect(perspectiveCog).to.exist;
    perspectiveCog.click();
    await el.updateComplete;

    const spans = Array.from(el.querySelectorAll('span'));
    const finSpan = spans.find(s => s.textContent?.includes("Fins & Plugs"));
    expect(finSpan).to.exist;

    const finRow = finSpan!.parentElement;
    expect(finRow).to.exist;

    const checkboxes = finRow!.querySelectorAll('input[type="checkbox"]');
    const checkbox = checkboxes[0] as HTMLInputElement;
    expect(checkbox.checked).to.be.true;

    checkbox.click();
    await el.updateComplete;
    expect(checkbox.checked).to.be.false;
  });
});
