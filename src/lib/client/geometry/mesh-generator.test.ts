// File: src/lib/client/geometry/mesh-generator.test.ts
import { expect } from "@open-wc/testing";
import * as THREE from "three";
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

      const getVertexHash = (index: number) => {
        const x = mesh.vertices[index * 3]!.toFixed(7);
        const y = mesh.vertices[index * 3 + 1]!.toFixed(7);
        const z = mesh.vertices[index * 3 + 2]!.toFixed(7);
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

        const zCounts = new Map<string, number>();
        boundaryEdges.forEach(edge => {
          const[v1, v2] = edge.split("::");
          if (!v1 || !v2) return;
          const z1 = v1.split(",")[2];
          if (z1) zCounts.set(z1, (zCounts.get(z1) || 0) + 1);
        });

        console.warn("Boundary edge Z-coordinate distribution (showing count of edges at each Z plane):");
        const sortedZ = [...zCounts.entries()].sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]));
        for (const [z, count] of sortedZ) {
           console.warn(`  Z(ft) ≈ ${z}: ${count} boundary edges`);
        }

        console.warn(`Example boundary edge: ${boundaryEdges[0]}`);
        console.warn("\n");
      }

      // If this fails, the mesh is missing end-caps at the nose/tail, 
      // or the loops don't perfectly converge into a point!
      expect(boundaryEdges.length).to.equal(0, `Found ${boundaryEdges.length} boundary edges indicating holes in the mesh.`);
    });

    it("should collapse the tip and tail into single points if thickness is forced to 0", async () => {
      // By forcing thickness to 0 at the nose and tail, we can check if the generator converges them properly.
      const pinchedState: BoardModel = {
        ...INITIAL_STATE,
        rockerTop: {
          ...INITIAL_STATE.rockerTop,
          controlPoints: [
            [0, 0, -35], // Pinched Nose
            INITIAL_STATE.rockerTop.controlPoints[1]!,
            [0, 0, 35]   // Pinched Tail
          ]
        },
        rockerBottom: {
          ...INITIAL_STATE.rockerBottom,
          controlPoints: [
            [0, 0, -35], // Pinched Nose
            INITIAL_STATE.rockerBottom.controlPoints[1]!,
            [0, 0, 35]   // Pinched Tail
          ]
        }
      };

      const curves = await generateBoardCurves(pinchedState);
      const mesh = MeshGeneratorService.generateMesh(pinchedState, curves);
      
      const segmentsZ = 180;
      const segmentsRadial = 48;
      
      // Check Nose (First ring, Z index 0)
      const noseRingY = mesh.vertices[1]!;
      let nosePinched = true;
      const noseYs = [];
      for (let j = 0; j <= segmentsRadial; j++) {
        const y = mesh.vertices[j * 3 + 1]!;
        noseYs.push(y.toFixed(5));
        if (Math.abs(y - noseRingY) > 0.001) nosePinched = false;
      }
      if (!nosePinched) {
        console.warn("Nose ring Y-coordinates are not uniform:", noseYs);
      }
      expect(nosePinched, "Nose vertices should collapse to a single Y-plane").to.be.true;

      // Check Tail (Last ring, Z index segmentsZ)
      const tailRingStartIndex = segmentsZ * (segmentsRadial + 1);
      const tailRingY = mesh.vertices[tailRingStartIndex * 3 + 1]!;
      let tailPinched = true;
      const tailYs = [];
      for (let j = 0; j <= segmentsRadial; j++) {
        const y = mesh.vertices[(tailRingStartIndex + j) * 3 + 1]!;
        tailYs.push(y.toFixed(5));
        if (Math.abs(y - tailRingY) > 0.001) tailPinched = false;
      }
      if (!tailPinched) {
        console.warn("Tail ring Y-coordinates are not uniform:", tailYs);
      }
      expect(tailPinched, "Tail vertices should collapse to a single Y-plane").to.be.true;
    });

    it("should use independent vertices for end-caps to prevent smooth-shading 'X' artifacts", async () => {
      // Create a squash tail state so we have a flat surface to test
      const squashState: BoardModel = {
        ...INITIAL_STATE,
        outline: {
          ...INITIAL_STATE.outline,
          controlPoints: [
            [0, 0, -35], 
            INITIAL_STATE.outline.controlPoints[1]!,
            [3, 0, 35] // 6 inch wide squash tail
          ]
        }
      };
      const curves = await generateBoardCurves(squashState);
      const mesh = MeshGeneratorService.generateMesh(squashState, curves);

      const segmentsZ = 180;
      const segmentsRadial = 48;
      const expectedHullVertices = (segmentsZ + 1) * (segmentsRadial + 1);
      const actualVerticesCount = mesh.vertices.length / 3;

      // Currently, it only adds 2 center vertices and reuses the hull's boundary rings.
      // This causes normals to be averaged across the 90-degree edge, creating a nasty "X" shadow.
      expect(actualVerticesCount).to.be.greaterThan(
        expectedHullVertices, 
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
        
        // Exact match check for pinched vertices
        const abSame = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        const acSame = a[0] === c[0] && a[1] === c[1] && a[2] === c[2];
        const bcSame = b[0] === c[0] && b[1] === c[1] && b[2] === c[2];

        if (abSame || acSame || bcSame) {
            degenerateCount++;
            if (degenerateCount < 5) { // Log first few offenders
              console.warn(`Degenerate triangle (collinear vertices) found at index ${i}:`, { a, b, c });
            }
            continue;
        }

        const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const ac =[c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const cross = [
          ab[1]!*ac[2]! - ab[2]!*ac[1]!,
          ab[2]!*ac[0]! - ab[0]!*ac[2]!,
          ab[0]!*ac[1]! - ab[1]!*ac[0]!
        ];
        const area = 0.5 * Math.sqrt(cross[0]!*cross[0]! + cross[1]!*cross[1]! + cross[2]!*cross[2]!);

        if (area === 0) { // Stricter check
          degenerateCount++;
           if (degenerateCount < 5) {
             console.warn(`Degenerate triangle (zero area) found at index ${i}:`, { a, b, c });
           }
        }
      }
      
      expect(degenerateCount).to.equal(0, `Found ${degenerateCount} degenerate (zero-area) triangles. The generator should skip end-caps if the ring is completely pinched.`);
    });

    it("should have correct winding order for tail-cap triangles (outward facing normals)", async () => {
      // This test specifically checks for "inside-out" polygons at the tail, which would appear as a hole.
      const squashState: BoardModel = {
        ...INITIAL_STATE,
        outline: {
          ...INITIAL_STATE.outline,
          controlPoints: [
            INITIAL_STATE.outline.controlPoints[0]!,
            INITIAL_STATE.outline.controlPoints[1]!,
            [4, 0, 35], // 8-inch wide squash tail at Z=35 (the very end of the board)
          ],
          // Make sure the tangent at the end is flat for a proper squash
          tangents1: [...INITIAL_STATE.outline.tangents1.slice(0, 2), [4, 0, 33]],
          tangents2: [...INITIAL_STATE.outline.tangents2.slice(0, 2), [4, 0, 35]],
        },
      };

      const curves = await generateBoardCurves(squashState);
      const mesh = MeshGeneratorService.generateMesh(squashState, curves);

      const tailZInFeet = squashState.length / 2 / 12; // The mesh vertices are in feet

      let inwardFacingTriangles = 0;
      const tailTriangles = [];

      for (let i = 0; i < mesh.indices.length; i += 3) {
        const idxA = mesh.indices[i]! * 3;
        const idxB = mesh.indices[i + 1]! * 3;
        const idxC = mesh.indices[i + 2]! * 3;

        const vA = new THREE.Vector3(
          mesh.vertices[idxA]!,
          mesh.vertices[idxA + 1]!,
          mesh.vertices[idxA + 2]!,
        );
        const vB = new THREE.Vector3(
          mesh.vertices[idxB]!,
          mesh.vertices[idxB + 1]!,
          mesh.vertices[idxB + 2]!,
        );
        const vC = new THREE.Vector3(
          mesh.vertices[idxC]!,
          mesh.vertices[idxC + 1]!,
          mesh.vertices[idxC + 2]!,
        );

        // A tail-cap triangle has an average Z very close to the tail end.
        const avgZ = (vA.z + vB.z + vC.z) / 3;

        if (Math.abs(avgZ - tailZInFeet) < 0.05) {
          tailTriangles.push({ vA, vB, vC });
        }
      }

      // If there are no triangles at the tail, the end cap wasn't generated at all.
      expect(tailTriangles.length).to.be.greaterThan(
        0,
        "No triangles were generated for the tail end-cap.",
      );

      for (const { vA, vB, vC } of tailTriangles) {
        // The tail cap exists on a plane. For it to be visible from the back, its normal should point in the +Z direction.
        const edge1 = new THREE.Vector3().subVectors(vB, vA);
        const edge2 = new THREE.Vector3().subVectors(vC, vA);
        const normal = new THREE.Vector3().crossVectors(edge1, edge2);

        // If the normal's Z component is negative, it's facing inward and will be culled.
        if (normal.z < 0) {
          inwardFacingTriangles++;
        }
      }

      expect(inwardFacingTriangles).to.equal(
        0,
        `Found ${inwardFacingTriangles} tail-cap triangles with incorrect winding order (inward-facing normals), which appear as holes.`,
      );
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
        crossSections: importedData.crossSections,
        railOutline: importedData.railOutline,
        apexOutline: importedData.apexOutline,
        apexRocker: importedData.apexRocker
      };

      const mesh = MeshGeneratorService.generateMesh(manualState, {
        outline:[], rockerTop: [], rockerBottom:[]
      });

      // Test the vertical bowtie assertion
      const segmentsZ = 180;
      const segmentsRadial = 48;
      
      let invertedCount = 0;

      for (let i = 0; i <= segmentsZ; i++) {
        // Loop through one side of the board (e.g., right side, excluding stringer)
        for (let j = 1; j < segmentsRadial / 2; j++) {
            // The top vertex on the radial loop
            const topIdx = i * (segmentsRadial + 1) + j;
            // The corresponding bottom vertex is mirrored on the other side of the loop
            const botIdx = i * (segmentsRadial + 1) + (segmentsRadial - j);

            const topY = mesh.vertices[topIdx * 3 + 1]!;
            const botY = mesh.vertices[botIdx * 3 + 1]!;
            
            if (botY > topY + 1e-6) {
                invertedCount++;
                if (invertedCount < 5) { // Log first few inversions
                    console.warn(`Inversion at Z-slice ${i}, radial point ${j}:`, { topY, botY });
                }
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

        const segmentsZ = 180;
        const segmentsRadial = 48;
        const tailRingIndex = segmentsZ; // The very last ring
        const tailRingStartIndex = tailRingIndex * (segmentsRadial + 1);

        // Find the widest point on the tail ring
        let maxTailWidth = 0;
        for (let j = 0; j <= segmentsRadial; j++) {
            const vertexIndex = (tailRingStartIndex + j) * 3;
            // The vertex array might not exist if generation failed
            if (vertexIndex >= mesh.vertices.length) continue;
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
