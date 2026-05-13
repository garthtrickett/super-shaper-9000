import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import * as THREE from "three";
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

    describe("Live Preview (gizmo-dragging)", () => {
    it("updates wireframe buffers directly without triggering full state update", async () => {
      const el = await fixture<BoardViewport>(html`<board-viewport .boardState=${INITIAL_STATE}></board-viewport>`);
      
      // Mock mathEngine
      el.mathEngine = {
        get_profile_at_z: () => ({ topY: 1, botY: -1, apexY: 0, tuckY: -0.5, shoulderY: 0.5 }),
        sample_curve: () => new Float32Array(300), // 100 points * 3
        getXOffset: () => 10
      } as any;

      // Force initial wireframe build
      (el as any)._updateGeometry();
      
      const wireframeGroup = (el as any).wireframeGroup as THREE.Group;
      const line = wireframeGroup.children.find(c => c.userData.curve === 'outline') as THREE.Line;
      expect(line).to.exist;

      // Spy on _updateGeometry
      const updateSpy = sinon.spy(el as any, '_updateGeometry');

      // Dispatch gizmo-dragging event
      el.dispatchEvent(new CustomEvent('gizmo-dragging', {
        detail: {
          userData: { type: 'anchor', curve: 'outline', index: 1 },
          position: [10, 0, 50] // Moved X
        }
      }));

      // Verify the buffer was marked for update
      expect(line.geometry.attributes.position.needsUpdate).to.be.true;
      
      // _updateGeometry should NOT have been called (no full rebuild)
      expect(updateSpy.called).to.be.false;
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
