import { expect } from "@open-wc/testing";
import { Effect } from "effect";
import { MeshGeneratorService, calculateBottomContourOffset } from "./mesh-generator";
import { bakeToManual } from "./manual-baker";
import { generateBoardCurves } from "./board-curves";
import { INITIAL_STATE, type BoardModel } from "../../../components/pages/board-builder-page.logic";

describe("Mesh Generator Service", () => {
  describe("Contour Compositing", () => {
    it("yields 0 offset for flat bottom contour", () => {
      const model: BoardModel = { ...INITIAL_STATE, bottomContour: "flat" };
      const offset = calculateBottomContourOffset(model, 0.5, 35, 0, 1);
      expect(offset).to.equal(0);
    });

    it("yields maximum concave depth at the stringer (nx=0) for single concave", () => {
      const model: BoardModel = { ...INITIAL_STATE, bottomContour: "single", concaveDepth: 0.25 };
      const offset = calculateBottomContourOffset(model, 0.5, 35, 0, 1.0);
      expect(offset).to.equal(0.25);
    });

    it("yields 0 depth at the rails (nx=1) for single concave, fading out correctly", () => {
      const model: BoardModel = { ...INITIAL_STATE, bottomContour: "single", concaveDepth: 0.25 };
      const offset = calculateBottomContourOffset(model, 0.5, 35, 1.0, 1.0);
      expect(offset).to.equal(0);
    });
  });

  describe("Volume Consistency (Parametric vs Manual)", () => {
    it("calculates roughly the same volume when converting from parametric to manual mode", async () => {
      const curves = await generateBoardCurves(INITIAL_STATE);
      
      // 1. Generate Parametric Mesh
      const paramMesh = MeshGeneratorService.generateMesh(INITIAL_STATE, curves);
      const paramVol = paramMesh.volumeLiters;

      // 2. Bake to Manual Mode (extract the curves into bezier points)
      const manualCurves = await Effect.runPromise(bakeToManual(INITIAL_STATE));
      const manualState: BoardModel = {
        ...INITIAL_STATE,
        editMode: "manual",
        manualOutline: manualCurves.outline,
        manualRockerTop: manualCurves.rockerTop,
        manualRockerBottom: manualCurves.rockerBottom,
        manualCrossSections: manualCurves.crossSections
      };

      // 3. Generate Manual Mesh (utilizes Bezier formulas rather than raw points)
      const manualMesh = MeshGeneratorService.generateMesh(manualState, curves);
      const manualVol = manualMesh.volumeLiters;

      // 4. Expect volumes to be within ~0.5L (acceptable margin of error for mathematical bezier interpolation vs NURBS sampling)
      const diff = Math.abs(paramVol - manualVol);
      expect(diff).to.be.lessThan(0.5);
    });
  });
});
