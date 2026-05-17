import { expect, fixture, html } from "@open-wc/testing";
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
});
