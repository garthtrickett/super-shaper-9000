import { expect, fixture, html } from "@open-wc/testing";
import sinon from "sinon";
import "./bottom-contour-editor";
import type { BottomContourEditor } from "./bottom-contour-editor";
import { INITIAL_STATE } from "../pages/board-builder-page.logic";

describe("BottomContourEditor", () => {
  it("renders contour path and handles node drag", async () => {
    const boardState = {
      ...INITIAL_STATE,
      bottomChannels:[{
        name: "Test",
        isSymmetric: true,
        leftOutline: { controlPoints: [[-2, 0, 50]], tangents1: [], tangents2: [], weights:[] },
        rightOutline: { controlPoints: [[2, 0, 50]], tangents1: [], tangents2:[], weights: [] },
        leftDepth: { controlPoints: [[-1, 1, 50]], tangents1: [], tangents2: [], weights: [] },
        rightDepth: { controlPoints: [[1, 1, 50]], tangents1: [], tangents2: [], weights:[] },
      }]
    };

    const sliceData = new Float32Array([2, -5, 0, 5, 0]); // 2 points, (-5,0) and (5,0)

    const el = await fixture<BottomContourEditor>(html`
      <bottom-contour-editor .boardState=${boardState} .sliceData=${sliceData} .zPosition=${50}></bottom-contour-editor>
    `);

    await el.updateComplete;

        const path = el.querySelector("g#transform-group path");
    expect(path).to.exist;
    expect(path!.getAttribute("d")).to.include("M -5 0 L 5 0");

    const circles = el.querySelectorAll("circle");
    expect(circles.length).to.equal(4); // 4 control points

                const spy = sinon.spy();
    el.addEventListener("update-node-position", spy);

            const pointerMoveEvent = new PointerEvent("pointermove", { pointerId: 1, clientX: -3, clientY: 0.5, bubbles: true });

    (el as any).activeDrag = { curve: "channel_0_left_outline", index: 0, origZ: 50, pointerId: 1 };
    await el.updateComplete;

    const svg = el.querySelector("svg")!;
    const gEl = el.querySelector('#transform-group') as any;
    gEl.getScreenCTM = () => new DOMMatrix();
    svg.createSVGPoint = () => ({
      x: 0, y: 0,
      matrixTransform: () => ({ x: -3, y: 0.5 })
    }) as any;

    // Call handler directly to bypass DOM event flakiness
    (el as any)._handlePointerMove(pointerMoveEvent);

    expect(spy.called).to.be.true;
    const detail = spy.firstCall.args[0].detail;
    expect(detail.curve).to.equal("channel_0_left_outline");
    expect(detail.position[0]).to.equal(-3);
    expect(detail.position[1]).to.equal(0.5);
    expect(detail.position[2]).to.equal(50);
  });
});
