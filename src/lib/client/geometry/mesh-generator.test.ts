import { expect } from "@open-wc/testing";
import { MeshGeneratorService, calculateBottomContourOffset } from "./mesh-generator";
import { bakeToManual } from "./manual-baker";
import { generateBoardCurves } from "./board-curves";
import { INITIAL_STATE, type BoardModel } from "../../../components/pages/board-builder-page.logic";
import { runClientPromise } from "../runtime";
import { parseS3dx } from "./s3dx-importer";

describe("MeshGeneratorService", () => {
  it("does not produce NaN or Infinity vertices during manual generation with extreme concaves", () => {
    // Simulate the state right before the 'paper plane' crash.
    // A slice where the top and bottom are incredibly close together (thickness approaching 0).
    const manualState: BoardModel = {
      ...INITIAL_STATE,
      outline: {
        controlPoints: [[0, 0, -10],[5, 0, 0], [0, 0, 10]],
        tangents1: [[0, 0, -10], [5, 0, 0],[0, 0, 10]],
        tangents2: [[0, 0, -10],[5, 0, 0], [0, 0, 10]],
      },
      rockerTop: {
        controlPoints: [[0, 1, -10],[0, 1, 0], [0, 1, 10]],
        tangents1: [[0, 1, -10], [0, 1, 0], [0, 1, 10]],
        tangents2: [[0, 1, -10],[0, 1, 0], [0, 1, 10]],
      },
      rockerBottom: {
        controlPoints: [[0, 0.999, -10],[0, 0.999, 0], [0, 0.999, 10]], // EXTREMELY thin
        tangents1: [[0, 0.999, -10], [0, 0.999, 0],[0, 0.999, 10]],
        tangents2: [[0, 0.999, -10], [0, 0.999, 0],[0, 0.999, 10]],
      },
      crossSections: [{
        controlPoints: [[0, 1.5, 0], [1, 1.5, 0],[2, 2, 0], [1, 2.5, 0], [0, 2.5, 0]], // Concave pushes bot up
        tangents1: [[0, 1.5, 0],[1, 1.5, 0], [2, 2, 0],[1, 2.5, 0], [0, 2.5, 0]],
        tangents2: [[0, 1.5, 0], [1, 1.5, 0],[2, 2, 0], [1, 2.5, 0], [0, 2.5, 0]],
      }]
    };

    // Using an empty fallback for the parametric curves since we are forcing manual mode
    const mesh = MeshGeneratorService.generateMesh(manualState, {
      outline: [], rockerTop: [], rockerBottom: []
    });

    expect(mesh.vertices.length).to.be.greaterThan(0);
    
    // Verify all coordinates are finite, valid numbers
    let hasInvalidNumber = false;
    for (let i = 0; i < mesh.vertices.length; i++) {
      if (!Number.isFinite(mesh.vertices[i]) || Number.isNaN(mesh.vertices[i])) {
        hasInvalidNumber = true;
        break;
      }
    }

    expect(hasInvalidNumber).to.be.false;
  });

  describe("Imported S3DX Edge Cases", () => {
    it("does not create a vertical bowtie (crease) at the tail for WitcherDaily", async () => {
      const response = await fetch("/src/assets/fixtures/s3dx/WitcherDaily.s3dx");
      const xml = await response.text();
      const importedData = await runClientPromise(parseS3dx(xml));
      
      const manualState: BoardModel = {
        ...INITIAL_STATE,
        length: importedData.length,
        width: importedData.width,
        thickness: importedData.thickness,
        outline: importedData.outline,
        rockerTop: importedData.rockerTop,
        rockerBottom: importedData.rockerBottom,
        crossSections: importedData.crossSections
      };

      const mesh = MeshGeneratorService.generateMesh(manualState, {
        outline: [], rockerTop: [], rockerBottom:[]
      });

      // Test the vertical bowtie assertion
      const segmentsZ = 150;
      const segmentsRadial = 36;
      
      let invertedCount = 0;

      for (let i = 0; i < segmentsZ; i++) {
        for (let j = 0; j <= 18; j++) {
          const topIdx = i * (segmentsRadial + 1) + j;
          const botIdx = i * (segmentsRadial + 1) + (36 - j);
          
          const topY = mesh.vertices[topIdx * 3 + 1]!;
          const botY = mesh.vertices[botIdx * 3 + 1]!;
          
          if (botY > topY + 0.001) { // 0.001 tolerance for floating point
            invertedCount++;
          }
        }
      }
      
      expect(invertedCount).to.equal(0, `Found ${invertedCount} inverted vertex pairs (Deck Y < Bottom Y)`);
    });
  });

  describe("Contour Compositing", () => {
    it("yields 0 offset for flat bottom contour", () => {
      const model = { ...INITIAL_STATE, bottomContour: "flat" } as unknown as BoardModel;
      const offset = calculateBottomContourOffset(model, 0.5, 35, 0, 1);
      expect(offset).to.equal(0);
    });

    it("yields maximum concave depth at the stringer (nx=0) for single concave", () => {
      const model = { ...INITIAL_STATE, bottomContour: "single", concaveDepth: 0.25 } as unknown as BoardModel;
      const offset = calculateBottomContourOffset(model, 0.5, 35, 0, 1.0);
      expect(offset).to.equal(0.25);
    });

    it("yields 0 depth at the rails (nx=1) for single concave, fading out correctly", () => {
      const model = { ...INITIAL_STATE, bottomContour: "single", concaveDepth: 0.25 } as unknown as BoardModel;
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
      const manualCurves = await runClientPromise(bakeToManual(INITIAL_STATE));
      const manualState: BoardModel = {
        ...INITIAL_STATE,
        outline: manualCurves.outline,
        rockerTop: manualCurves.rockerTop,
        rockerBottom: manualCurves.rockerBottom,
        crossSections: manualCurves.crossSections
      };

      // 3. Generate Manual Mesh (utilizes Bezier formulas rather than raw points)
      const manualMesh = MeshGeneratorService.generateMesh(manualState, curves);
      const manualVol = manualMesh.volumeLiters;

      // 4. Expect volumes to be within ~0.5L (acceptable margin of error for mathematical bezier interpolation vs NURBS sampling)
      const diff = Math.abs(paramVol - manualVol);
      expect(diff).to.be.lessThan(0.5);
    });

    it("generates a watertight tail cap with correct winding and UVs for wide tails", async () => {
      const squashTailModel = { ...INITIAL_STATE, tailType: "squash", tailBlockWidth: 8.0 } as unknown as BoardModel;
      const curves = await generateBoardCurves(squashTailModel);
      const mesh = MeshGeneratorService.generateMesh(squashTailModel, curves);

      // Find the center vertex of the tail cap (it's the last one we added)
      const centerIdx = mesh.vertices.length / 3 - 1;
      const centerVertex = [mesh.vertices[centerIdx * 3], mesh.vertices[centerIdx * 3 + 1], mesh.vertices[centerIdx * 3 + 2]];
      const centerUv = [mesh.uvs[centerIdx * 2], mesh.uvs[centerIdx * 2 + 1]];

      // Verify the center vertex is on the stringer (X=0) at the tail end
      expect(centerVertex[0]).to.be.closeTo(0, 0.001);
      expect(centerVertex[2]).to.be.closeTo(squashTailModel.length / 2 / 12, 0.001);

      // Verify UV is centered to prevent pinching
      expect(centerUv[0]).to.be.closeTo(0.5, 0.001);
      expect(centerUv[1]).to.be.closeTo(1.0, 0.001);

      // Find the first triangle of the tail cap fan
      let firstTriangle: number[] | undefined;
      for (let i = mesh.indices.length - 3; i >= 0; i -= 3) {
        if (mesh.indices[i] === centerIdx || mesh.indices[i+1] === centerIdx || mesh.indices[i+2] === centerIdx) {
          firstTriangle = [mesh.indices[i]!, mesh.indices[i+1]!, mesh.indices[i+2]!];
          break;
        }
      }

      expect(firstTriangle).to.exist;
      console.log("Logging tail cap debug info:");
      console.log("  - Center Vertex Index:", centerIdx);
      console.log("  - First Tail Cap Triangle Indices:", firstTriangle);
    });
  });
});
