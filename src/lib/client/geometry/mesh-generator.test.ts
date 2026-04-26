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

  describe("Mesh Watertightness and Topology (Holes at Tip/Tail)", () => {
    it("should generate a watertight mesh (no boundary edges or holes at tip and tail)", async () => {
      const curves = await generateBoardCurves(INITIAL_STATE);
      const mesh = MeshGeneratorService.generateMesh(INITIAL_STATE, curves);

      const edgeCounts = new Map<string, number>();

      // Since multiple vertices can exist at the exact same spatial coordinate (e.g., collapsed tip),
      // we must check watertightness by spatial position, not just array index.
      // We will hash the coordinates with a small tolerance.
      const getVertexHash = (index: number) => {
        const x = mesh.vertices[index * 3]!.toFixed(4);
        const y = mesh.vertices[index * 3 + 1]!.toFixed(4);
        const z = mesh.vertices[index * 3 + 2]!.toFixed(4);
        return `${x},${y},${z}`;
      };

      const getEdgeKey = (idx1: number, idx2: number) => {
        const hash1 = getVertexHash(idx1);
        const hash2 = getVertexHash(idx2);
        // Sort to ensure undirected edge matching
        return hash1 < hash2 ? `${hash1}::${hash2}` : `${hash2}::${hash1}`;
      };

      for (let i = 0; i < mesh.indices.length; i += 3) {
        const a = mesh.indices[i]!;
        const b = mesh.indices[i+1]!;
        const c = mesh.indices[i+2]!;

        // Ignore degenerate triangles (where 2 or more vertices share the same spatial position)
        const hashA = getVertexHash(a);
        const hashB = getVertexHash(b);
        const hashC = getVertexHash(c);

        if (hashA === hashB || hashB === hashC || hashC === hashA) continue;

        const edges =[
          getEdgeKey(a, b),
          getEdgeKey(b, c),
          getEdgeKey(c, a)
        ];

        for (const edge of edges) {
          edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
        }
      }

      const boundaryEdges =[];
      for (const [edge, count] of edgeCounts.entries()) {
        if (count === 1) {
          boundaryEdges.push(edge);
        }
      }

      if (boundaryEdges.length > 0) {
        console.warn(`\n🚨 WATERTIGHTNESS FAILURE: Detected ${boundaryEdges.length} boundary edges!`);
        console.warn("These edges only belong to 1 face, meaning there is a hole in the mesh.");
        
        // Group boundary edges by their Z coordinate to see if they are clustered at tip/tail
        const zCounts = new Map<string, number>();
        boundaryEdges.forEach(edge => {
          const[v1, v2] = edge.split("::");
          if (v1 && v2) {
             const z1 = v1.split(",")[2];
             const z2 = v2.split(",")[2];
             if (z1) zCounts.set(z1, (zCounts.get(z1) || 0) + 1);
             if (z2 && z2 !== z1) zCounts.set(z2, (zCounts.get(z2) || 0) + 1);
          }
        });

        console.warn("Boundary edge Z-coordinate distribution:");
        for (const [z, count] of zCounts.entries()) {
           console.warn(`  Z = ${z} : ${count} edges involving this Z`);
        }

        console.warn("Sample of boundary edges (First 5):");
        for (let i = 0; i < Math.min(5, boundaryEdges.length); i++) {
          console.warn(`  ${boundaryEdges[i]}`);
        }
        console.warn("\n");
      }

      // If this fails, the mesh is missing end-caps at the nose/tail, 
      // or the loops don't perfectly converge into a point!
      expect(boundaryEdges.length).to.equal(0, `Found ${boundaryEdges.length} boundary edges indicating holes in the mesh.`);
    });

    it("should collapse the tip and tail into single points if thickness is forced to 0", async () => {
      // By forcing thickness to 0 at the nose and tail, we can check if the generator converges them properly.
      const pinchedState = {
        ...INITIAL_STATE,
        rockerTop: {
          ...INITIAL_STATE.rockerTop,
          controlPoints: [
[0, 0, -35], // Pinched Nose
            INITIAL_STATE.rockerTop.controlPoints[1]!,
            [0, 0, 35]   // Pinched Tail
          ] as [number, number, number][]
        },
        rockerBottom: {
          ...INITIAL_STATE.rockerBottom,
          controlPoints: [
            [0, 0, -35], // Pinched Nose
            INITIAL_STATE.rockerBottom.controlPoints[1]!,
[0, 0, 35]   // Pinched Tail
          ] as [number, number, number][]
        }
      };

      const curves = await generateBoardCurves(pinchedState);
      const mesh = MeshGeneratorService.generateMesh(pinchedState, curves);
      
      const segmentsZ = 150;
      const segmentsRadial = 36;
      
      // Check Nose (First ring, Z index 0)
      const noseRingY = mesh.vertices[1]; // y coord of first vertex
      let nosePinched = true;
      for (let j = 0; j <= segmentsRadial; j++) {
        const y = mesh.vertices[j * 3 + 1];
        if (Math.abs(y! - noseRingY!) > 0.001) nosePinched = false;
      }
      expect(nosePinched).to.be.true;

      // Check Tail (Last ring, Z index segmentsZ - 1)
      const tailRingStartIndex = (segmentsZ - 1) * (segmentsRadial + 1);
      const tailRingY = mesh.vertices[tailRingStartIndex * 3 + 1];
      let tailPinched = true;
      for (let j = 0; j <= segmentsRadial; j++) {
        const y = mesh.vertices[(tailRingStartIndex + j) * 3 + 1];
        if (Math.abs(y! - tailRingY!) > 0.001) tailPinched = false;
      }
      expect(tailPinched).to.be.true;
    });
  });

    it("should use independent vertices for end-caps to prevent smooth-shading 'X' artifacts", async () => {
      // Create a squash tail state so we have a flat surface to test
      const squashState = {
        ...INITIAL_STATE,
        outline: {
          ...INITIAL_STATE.outline,
          controlPoints: [
[0, 0, -35], 
            INITIAL_STATE.outline.controlPoints[1]!,
[3, 0, 35] // 6 inch wide squash tail
          ] as [number, number, number][]
        }
      };
      const curves = await generateBoardCurves(squashState);
      const mesh = MeshGeneratorService.generateMesh(squashState, curves);

      const segmentsZ = 150;
      const segmentsRadial = 36;
      const expectedHullVertices = segmentsZ * (segmentsRadial + 1);
      const actualVerticesCount = mesh.vertices.length / 3;

      // Currently, it only adds 2 center vertices and reuses the hull's boundary rings.
      // This causes normals to be averaged across the 90-degree edge, creating a nasty "X" shadow.
      expect(actualVerticesCount).to.be.greaterThan(
        expectedHullVertices + 2, 
        "End-caps must use duplicated vertices to maintain sharp 90-degree edges. Sharing vertices causes smooth-shading 'X' artifacts."
      );
    });

    it("should not generate degenerate (zero-area) triangles when the tip is pinched to 0 width", async () => {
      // INITIAL_STATE has exactly 0 width at both the nose and tail.
      // Creating a triangle fan on a 1D vertical line produces zero-area triangles.
      const curves = await generateBoardCurves(INITIAL_STATE);
      const mesh = MeshGeneratorService.generateMesh(INITIAL_STATE, curves);

      let degenerateCount = 0;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const idxA = mesh.indices[i]! * 3;
        const idxB = mesh.indices[i+1]! * 3;
        const idxC = mesh.indices[i+2]! * 3;

        const a = [mesh.vertices[idxA]!, mesh.vertices[idxA+1]!, mesh.vertices[idxA+2]!];
        const b = [mesh.vertices[idxB]!, mesh.vertices[idxB+1]!, mesh.vertices[idxB+2]!];
        const c = [mesh.vertices[idxC]!, mesh.vertices[idxC+1]!, mesh.vertices[idxC+2]!];

        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [
          ab[1]*ac[2] - ab[2]*ac[1],
          ab[2]*ac[0] - ab[0]*ac[2],
          ab[0]*ac[1] - ab[1]*ac[0]
        ];
        const area = 0.5 * Math.sqrt(cross[0]*cross[0] + cross[1]*cross[1] + cross[2]*cross[2]);

        if (area < 1e-6) { // Tolerance for floating point
          degenerateCount++;
        }
      }
      
      expect(degenerateCount).to.equal(0, `Found ${degenerateCount} degenerate (zero-area) triangles. The generator should skip end-caps if the ring is completely pinched.`);
    });
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

    it("generates a wide tail for WitcherDaily instead of a point", async () => {
        const response = await fetch("/src/assets/fixtures/s3dx/WitcherDaily.s3dx");
        const xml = await response.text();
        const importedData = await runClientPromise(parseS3dx(xml));
        const manualState: BoardModel = { ...INITIAL_STATE, ...importedData };
        const curves = await generateBoardCurves(manualState);

        const mesh = MeshGeneratorService.generateMesh(manualState, curves);

        const segmentsZ = 150;
        const segmentsRadial = 36;
        const tailRingIndex = segmentsZ - 1;
        const tailRingStartIndex = tailRingIndex * (segmentsRadial + 1);

        // Find the widest point on the tail ring
        let maxTailWidth = 0;
        for (let j = 0; j <= segmentsRadial; j++) {
            const vertexIndex = (tailRingStartIndex + j) * 3;
            const x = Math.abs(mesh.vertices[vertexIndex]!); // Width is the X coordinate
            if (x > maxTailWidth) {
                maxTailWidth = x;
            }
        }

        // The WitcherDaily tail is narrow but not a point. The half-width is ~1.56cm -> ~0.61 inches -> ~0.051 feet.
        // A value near 0 would indicate a collapsed point. We check that it's greater than a reasonable threshold.
        expect(maxTailWidth).to.be.greaterThan(0.04, "The tail should not collapse to a point.");
    });
  });
});
