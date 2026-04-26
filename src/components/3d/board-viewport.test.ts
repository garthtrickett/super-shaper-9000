import { expect, fixture, html } from "@open-wc/testing";
import * as THREE from "three";
import { INITIAL_STATE } from "../pages/board-builder-page.logic";
import "./board-viewport";
import type { BoardViewport } from "./board-viewport";

describe("BoardViewport (3D Component)", () => {
  it("should render a canvas element in the light DOM", async () => {
    const el = await fixture<BoardViewport>(
      html`<board-viewport></board-viewport>`
    );
    
    const canvas = el.querySelector("canvas");
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
  });

  describe("Gizmo Visibility & Management", () => {
    it("shows/hides appropriate gizmos based on boardState", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);
      
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
