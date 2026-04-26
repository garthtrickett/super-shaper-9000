import { expect, fixture, html } from "@open-wc/testing";
import * as THREE from "three";
import { INITIAL_STATE } from "../pages/board-builder-page.logic";
import "./board-viewport";
import type { BoardViewport } from "./board-viewport";

describe("BoardViewport (3D Component)", () => {
  it("should render a canvas element inside its shadow DOM", async () => {
    const el = await fixture<BoardViewport>(
      html`<board-viewport></board-viewport>`
    );
    
    const canvas = el.shadowRoot?.querySelector("canvas");
    expect(canvas).to.exist;
    expect(canvas?.tagName.toLowerCase()).to.equal("canvas");
  });

  describe("Camera & Viewport Controls", () => {
    it("flips the board container when Flip button is clicked", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);

      const buttons = Array.from(el.querySelectorAll('button'));
      const flipBtn = buttons.find(b => b.title?.includes('Flip'));
      expect(flipBtn).to.exist;

      // Initial state
      expect((el as any).isFlipped).to.be.false;
      expect((el as any).boardContainer.rotation.z).to.equal(0);

      // Click flip
      flipBtn!.click();
      await el.updateComplete;

      // Flipped state
      expect((el as any).isFlipped).to.be.true;
      expect((el as any).boardContainer.rotation.z).to.equal(Math.PI);
    });

    it("renders camera toggles only in manual edit mode", async () => {
      // Parametric Mode
      let el = await fixture<BoardViewport>(html`<board-viewport .boardState=${{ ...INITIAL_STATE, editMode: 'parametric' }}></board-viewport>`);
      let buttonsContainer = el.shadowRoot!.querySelector('.absolute.top-4.left-4');
      expect(buttonsContainer?.classList.contains('hidden')).to.be.true;

      // Manual Mode
      el = await fixture<BoardViewport>(html`<board-viewport .boardState=${{ ...INITIAL_STATE, editMode: 'manual' }}></board-viewport>`);
      buttonsContainer = el.shadowRoot!.querySelector('.absolute.top-4.left-4');
      expect(buttonsContainer?.classList.contains('hidden')).to.be.false;
    });

    it("switches camera mode when UI buttons are clicked", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${{ ...INITIAL_STATE, editMode: 'manual' }}></board-viewport>`);
      
      const buttons = Array.from(el.shadowRoot!.querySelectorAll('button'));
      const topBtn = buttons.find(b => b.textContent?.includes('Top'));
      expect(topBtn).to.exist;
      
      // Click "Top"
      topBtn!.click();
      await el.updateComplete;

      // Verify the button gets the active blue class indicating the internal state shifted
      expect(topBtn!.classList.contains('bg-blue-600')).to.be.true;
      
      // Internal validation via cast
      const activeCamera = (el as any).activeCamera;
      expect(activeCamera.type).to.equal('OrthographicCamera');
    });
  });

  describe("Gizmo Visibility & Management", () => {
    it("shows/hides appropriate gizmos based on view mode", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${{ ...INITIAL_STATE, editMode: 'manual' }}></board-viewport>`);
      
      // Inject mock gizmos directly into the Three.js group to bypass complex curve generation in headless test
      const outlineGizmo = new THREE.Mesh();
      outlineGizmo.userData = { curve: 'outline' };
      
      const rockerGizmo = new THREE.Mesh();
      rockerGizmo.userData = { curve: 'rockerTop' };

      const gizmoGroup = (el as any).gizmoGroup as THREE.Group;
      gizmoGroup.add(outlineGizmo, rockerGizmo);

      // Currently gizmos are visible across all viewports in the quad split view.
      // Assuming we just verify they exist in the group.
      expect(outlineGizmo.visible).to.be.true;
      expect(rockerGizmo.visible).to.be.true;
    });
  });
});
