import { expect } from "@open-wc/testing";
import { bakeToManual, extractCrossSectionsSS9000 } from "./manual-baker";
import { INITIAL_STATE } from "../../../components/pages/board-builder-page.logic";
import { runClientPromise } from "../runtime";
import type { BoardCurves } from "./board-curves";

describe("manual-baker", () => {
  it("preserves tangent angles when applying stringer locks to the tips", async () => {
    // Generate a board with a very sharp pintail (forces a sharp entry angle to the tail)
    const pintailState = { ...INITIAL_STATE, tailType: "pintail" as const };
    
    const result = await runClientPromise(bakeToManual(pintailState));
    
    const outline = result.outline;
    const tailIdx = outline.controlPoints.length - 1;
    
    const tailAnchor = outline.controlPoints[tailIdx]!;
    const tailTangent1 = outline.tangents1[tailIdx]!; // Incoming handle from the rail

    // 1. The anchor itself MUST be locked to X=0 (the stringer) to be watertight
    expect(tailAnchor[0]).to.equal(0);

    // 2. The tangent handle MUST NOT be zeroed out in X, otherwise it forms a corner.
    // If it was correctly shifted rather than zeroed, it should have a non-zero X value (because of the pintail slope).
    expect(tailTangent1[0]).to.not.equal(0);
    
    // 3. Ensure no coordinates became NaN during Catmull-Rom calculations
    expect(Number.isFinite(tailTangent1[0])).to.be.true;
    expect(Number.isFinite(tailTangent1[1])).to.be.true;
    expect(Number.isFinite(tailTangent1[2])).to.be.true;
  });

  it("extracts exactly 8 cross sections at standard S3DX fractions", () => {
    // Minimal mocked curves to bypass Rhino dependency in this test
    const mockCurves: BoardCurves = {
      outline: [[0, 0, -35], [9.375, 0, 0], [0, 0, 35]],
      rockerTop: [[0, 1.25, -35], [0, 1.25, 0], [0, 1.25, 35]],
      rockerBottom: [[0, -1.25, -35], [0, -1.25, 0], [0, -1.25, 35]]
    };

    const slices = extractCrossSectionsSS9000(INITIAL_STATE, mockCurves);
    
    // Should generate exactly 8 cross-sections as required by standard S3DX spec
    expect(slices.length).to.equal(8);

    // Each slice should have exactly 5 anchors representing standard surfboard topology
    // (bottom stringer, bottom tuck, rail apex, deck shoulder, deck stringer)
    slices.forEach(slice => {
      expect(slice.controlPoints.length).to.equal(5);
      expect(slice.tangents1.length).to.equal(5);
      expect(slice.tangents2.length).to.equal(5);
    });
  });

  it("bakes parametric model into full manual curves", async () => {
    // Using runPromise to resolve the Effect, which internally calls generateBoardCurves
    const result = await runClientPromise(bakeToManual(INITIAL_STATE));
    
    // Check that outline and rockers are populated with mathematical anchor points
    expect(result.outline.controlPoints.length).to.be.greaterThan(3);
    expect(result.rockerTop.controlPoints.length).to.be.greaterThan(3);
    expect(result.rockerBottom.controlPoints.length).to.be.greaterThan(3);
    
    // Check that exactly 8 manual cross sections were extracted for editing
    expect(result.crossSections.length).to.equal(8);
  });
});
