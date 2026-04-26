// File: src/lib/client/geometry/mesh-generator.test.ts
import { expect } from "@open-wc/testing";
import { MeshGeneratorService } from "./mesh-generator";
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
        controlPoints: [[0, 0, -10],[5, 0, 0],[0, 0, 10]],
        tangents1: [[0, 0, -10],[5, 0, 0],[0, 0, 10]],
        tangents2: [[0, 0, -10],[5, 0, 0], [0, 0, 10]],
      },
      rockerTop: {
        controlPoints: [[0, 1, -10],[0, 1, 0],[0, 1, 10]],
        tangents1: [[0, 1, -10], [0, 1, 0],[0, 1, 10]],
        tangents2: [[0, 1, -10],[0, 1, 0],[0, 1, 10]],
      },
      rockerBottom: {
        controlPoints: [[0, 0.999, -10],[0, 0.999, 0],[0, 0.999, 10]], // EXTREMELY thin
        tangents1: [[0, 0.999, -10],[0, 0.999, 0],[0, 0.999, 10]],
        tangents2: [[0, 0.999, -10],[0, 0.999, 0],[0, 0.999, 10]],
      },
      crossSections:[{
        controlPoints: [[0, 1.5, 0],[1, 1.5, 0],[2, 2, 0],[1, 2.5, 0],[0, 2.5, 0]], // Concave pushes bot up
        tangents1: [[0, 1.5, 0],[1, 1.5, 0], [2, 2, 0],[1, 2.5, 0],[0, 2.5, 0]],
        tangents2: [[0, 1.5, 0], [1, 1.5, 0],[2, 2, 0],[1, 2.5, 0],[0, 2.5, 0]],
      }]
    };

    // Using an empty fallback for the parametric curves since we are forcing manual mode
    const mesh = MeshGeneratorService.generateMesh(manualState, {
      outline: [], rockerTop: [], rockerBottom:[]
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
        outline:[], rockerTop: [], rockerBottom:[]
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
});
