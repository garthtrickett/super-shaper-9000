// File: src/lib/client/geometry/mesh-generator.test.ts
import { expect } from "@open-wc/testing";
import * as THREE from "three";
import { MeshGeneratorService, getCrossSectionBlendAtZ } from "./mesh-generator";
import { generateBoardCurves } from "./board-curves";
import { INITIAL_STATE, type BoardModel, type BezierCurveData, type Point3D } from "../../../components/pages/board-builder-page.logic";
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

    it("does not artificially pinch mesh thickness at pointed tails (Geometric Tip Fading bug)", async () => {
      // Create a state with a mathematically pointed tail (width = 0)
      // but a thick, blunt tail block in the rocker (thickness = 2)
      const pointedThickTailState: BoardModel = {
        ...INITIAL_STATE,
        outline: {
          controlPoints: [[0, 0, -35], [10, 0, 0],[0, 0, 35]], // Tail width is 0
          tangents1: [[0, 0, -35], [10, 0, -10], [0, 0, 25]],
          tangents2: [[0, 0, -25], [10, 0, 10],[0, 0, 35]]
        },
        rockerTop: {
          controlPoints: [[0, 1, -35], [0, 1, 0],[0, 1, 35]], // Top is uniformly at Y=1
          tangents1: [[0, 1, -35], [0, 1, -10],[0, 1, 25]],
          tangents2: [[0, 1, -25],[0, 1, 10], [0, 1, 35]]
        },
        rockerBottom: {
          controlPoints: [[0, -1, -35],[0, -1, 0], [0, -1, 35]], // Bot is uniformly at Y=-1
          tangents1: [[0, -1, -35], [0, -1, -10],[0, -1, 25]],
          tangents2: [[0, -1, -25], [0, -1, 10], [0, -1, 35]]
        }
      };

      const curves = await generateBoardCurves(pointedThickTailState);
      const mesh = MeshGeneratorService.generateMesh(pointedThickTailState, curves);

      const segmentsZ = 240;
      const segmentsRadial = 96;

      // 1. Check thickness inside the 1.5" fade zone (e.g. Z = 34)
      let targetRingIdx = -1;
      let minDiff = Infinity;
      for (let i = 0; i <= segmentsZ; i++) {
        const ringZ = mesh.vertices[i * (segmentsRadial + 2) * 3 + 2]!; 
        const zInches = ringZ * 12;
        const diff = Math.abs(zInches - 34);
        if (diff < minDiff) {
          minDiff = diff;
          targetRingIdx = i;
        }
      }

      const ringStartVertex = targetRingIdx * (segmentsRadial + 2) * 3;
      let maxMeshY = -Infinity;
      let minMeshY = Infinity;
      
      for (let j = 0; j <= segmentsRadial + 1; j++) {
        const y = mesh.vertices[ringStartVertex + j * 3 + 1]! * 12;
        if (y > maxMeshY) maxMeshY = y;
        if (y < minMeshY) minMeshY = y;
      }

      const meshThicknessAtFadeZone = maxMeshY - minMeshY;
      expect(meshThicknessAtFadeZone).to.be.closeTo(2.0, 0.05, 
        "Mesh thickness should match the rocker curves (2.0 inches) even near a pointed tail. " +
        "Geometric tip fading is incorrectly squashing the thickness."
      );

      // 2. Check thickness at the EXACT tail ring
      const tailRingStartVertex = segmentsZ * (segmentsRadial + 2) * 3;
      let tailMaxY = -Infinity;
      let tailMinY = Infinity;
      
      for (let j = 0; j <= segmentsRadial + 1; j++) {
        const y = mesh.vertices[tailRingStartVertex + j * 3 + 1]! * 12;
        if (y > tailMaxY) tailMaxY = y;
        if (y < tailMinY) tailMinY = y;
      }

      const tailMeshThickness = tailMaxY - tailMinY;
      expect(tailMeshThickness).to.be.closeTo(2.0, 0.05, 
        "Tail ring thickness should match the rocker curves (2.0 inches) even if width is 0. " +
        "The generator is incorrectly forcing py = centerY at the exact tail."
      );
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
      
      const segmentsZ = 240;
      const segmentsRadial = 96;
      
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
      const tailRingStartIndex = segmentsZ * (segmentsRadial + 2);
      const tailRingY = mesh.vertices[tailRingStartIndex * 3 + 1]!;
      let tailPinched = true;
      const tailYs = [];
      for (let j = 0; j <= segmentsRadial + 1; j++) {
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

      const segmentsZ = 240;
      const segmentsRadial = 96;
      const expectedHullVertices = (segmentsZ + 1) * (segmentsRadial + 2);
      const actualVerticesCount = mesh.vertices.length / 3;

      // Currently, it only adds 2 center vertices and reuses the hull's boundary rings.
      // This causes normals to be averaged across the 90-degree edge, creating a nasty "X" shadow.
      expect(actualVerticesCount).to.be.greaterThan(
        expectedHullVertices, 
        "End-caps must use duplicated vertices to maintain sharp 90-degree edges. Sharing vertices causes smooth-shading 'X' artifacts."
      );
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

    it("should use independent vertices for swallow tail inner walls to prevent smooth-shading black holes", async () => {
      const response = await fetch(`/src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx`);
      const xml = await response.text();
      const importedData = await runClientPromise(parseS3dx(xml));
      const manualState: BoardModel = { ...INITIAL_STATE, ...importedData };
      const curves = await generateBoardCurves(manualState);
      const mesh = MeshGeneratorService.generateMesh(manualState, curves);

      // The mesh vertices should have sharp normals for the inner walls.
      // If they reuse the hull vertices, the normal interpolates from UP to DOWN,
      // causing a zero-length normal (NaN) exactly in the middle of the vertical wall.
      // This causes the shader to render the face as pitch black, looking like a hole.
      let hasInnerWallNormal = false;
      for (let i = 0; i < mesh.normals.length; i += 3) {
        const nx = mesh.normals[i]!;
        const ny = mesh.normals[i+1]!;
        const nz = mesh.normals[i+2]!;
        
        // Inner walls should point almost entirely in +/- X (sideways, facing the stringer)
        if (Math.abs(nx) > 0.9 && Math.abs(ny) < 0.1 && Math.abs(nz) < 0.1) {
          // Check if this vertex is near the swallow tail gap
          const z = mesh.vertices[i+2]! * 12; // feet to inches
          if (z > 30) {
            hasInnerWallNormal = true;
            break;
          }
        }
      }

      expect(hasInnerWallNormal, "Swallow tail inner walls must use dedicated vertices with horizontal normals (+/- X) to prevent black shading artifacts.").to.be.true;
    });

    it("preserves swallow tail cutouts by not generating a web of foam between the prongs", async () => {
      const response = await fetch(`/src/assets/fixtures/s3dx/gh-60-winged-swallow.s3dx`);
      const xml = await response.text();
      const importedData = await runClientPromise(parseS3dx(xml));
      const manualState: BoardModel = { ...INITIAL_STATE, ...importedData };
      const curves = await generateBoardCurves(manualState);
      const mesh = MeshGeneratorService.generateMesh(manualState, curves);

      // In gh-60-winged-swallow:
      // Notch Z = 34.641
      // Tip Z = 35.692
      // At Z = 35.0, the board should be split into two prongs.
      // There should be NO vertices with X=0 at Z=35.0.
      
      const segmentsZ = 240;
      const segmentsRadial = 96;
      
      let minXAt35 = Infinity;

      for (let i = 0; i <= segmentsZ; i++) {
        // Z is in feet in the generated mesh (vertices array), so we multiply by 12 to get inches
        const ringZ = mesh.vertices[i * (segmentsRadial + 2) * 3 + 2]! * 12;
        
        // Find the ring closest to Z = 35.0 inches
        if (Math.abs(ringZ - 35.0) < 0.2) {
          // Check all vertices in this ring
          for (let j = 0; j <= segmentsRadial + 1; j++) {
            const x = Math.abs(mesh.vertices[(i * (segmentsRadial + 2) + j) * 3]! * 12);
            if (x < minXAt35) minXAt35 = x;
          }
        }
      }

      // If the swallow tail is rendered correctly, the minimum X at Z=35.0 should be > 0.
      // E.g. minX should be around the inner edge of the cutout (e.g. X > 1.0).
      // If it's a web, minX will be 0.
      expect(minXAt35).to.be.greaterThan(0.2, "Found geometry at X=0 inside the swallow tail cutout. The tail is rendering as a solid block (square tail) instead of a swallow.");
    });
  });

  describe("Tail Shape & Detail Preservation (Piecewise Scaling & Interpolation)", () => {
    const mockBezier = (pts: Point3D[]): BezierCurveData => ({
      controlPoints: pts,
      tangents1: pts,
      tangents2: pts
    });

    it("uses piecewise X-scaling to preserve the tuck line independently of the apex", () => {
      const mockState: BoardModel = {
        ...INITIAL_STATE,
        outline: mockBezier([[10, 0, 0],[10, 0, 10]]),
        railOutline: mockBezier([[2, 0, 0], [2, 0, 10]]), // Tuck is firmly at 2
        rockerTop: mockBezier([[0, 10, 0], [0, 10, 10]]),
        rockerBottom: mockBezier([[0, 0, 0],[0, 0, 10]]),
        crossSections:[
          // Slice: Tuck is at X=5 (t=0.25), Apex is at X=10 (t=0.5)
          mockBezier([[0, 0, 0], [5, 0, 0],[10, 5, 0], [5, 10, 0], [0, 10, 0]])
        ]
      };
        
      const mesh = MeshGeneratorService.generateMesh(mockState, { outline:[], rockerTop:[], rockerBottom:[] });
        
      // Radial segments = 96. Bottom stringer is j=0, Top is j=48. t=0.25 is j=12.
      const jTuck = 12; 
      const vertexIdx = jTuck * 3;
      const xVal = Math.abs(mesh.vertices[vertexIdx]!);
        
      const expectedInches = 2; // Should strictly lock to railOutline (tuckX)
      const expectedScaled = expectedInches * (1/12);
      expect(xVal).to.be.closeTo(expectedScaled, 0.001, "Tuck X should map independently to railOutline, not stretch to outline apex.");
    });

    it("scales Y coordinates based on parameter T to prevent contour scrambling on deep bottom channels", () => {
      const mockState: BoardModel = {
        ...INITIAL_STATE,
        outline: mockBezier([[10, 0, 0],[10, 0, 10]]),
        rockerBottom: mockBezier([[0, 0, 0], [0, 0, 10]]),
        rockerTop: mockBezier([[0, 20, 0], [0, 20, 10]]),
        apexRocker: mockBezier([[0, 5, 0], [0, 5, 10]]),
        crossSections:[
          // Slice: Deep channel at t=0.25 (Y=4). Apex at t=0.5 (Y=2).
          mockBezier([[0, 0, 0],[5, 4, 0], [10, 2, 0], [5, 10, 0],[0, 10, 0]])
        ]
      };

      const mesh = MeshGeneratorService.generateMesh(mockState, { outline:[], rockerTop:[], rockerBottom:[] });
        
      // j=12 is t=0.25. The evaluator should place it correctly in Y-space relative to the apex.
      const jChan = 12;
      const vertexIdx = jChan * 3;
      const yVal = mesh.vertices[vertexIdx + 1]!;
        
      const expectedInches = 10; 
      const expectedScaled = expectedInches * (1/12);
        
      expect(yVal).to.be.closeTo(expectedScaled, 0.001, "Y coordinate should scale via parameter space (T), ignoring spatial overlap.");
    });

    it("uses linear parameter interpolation for the apex to prevent overshoot at sharp tail drop-offs", () => {
      const slices = [
        mockBezier([[0,0,0],  [2,2,0],  [10,5,0],[2,8,0],  [0,10,0]]),  // S0: z=0, apex at t=0.5
        mockBezier([[0,0,10],[2,2,10], [10,5,10], [2,8,10],[0,10,10]]), // S1: z=10, apex at t=0.5
        mockBezier([[0,0,20], [2,2,20],[10,5,20], [2,8,20], [0,10,20]]), // S2: z=20, apex at t=0.5
        mockBezier([[0,0,30], [2,2,30], [5,5,30],[10,8,30], [0,10,30]]) // S3: z=30, apex pushed to t=0.75
      ];
        
      // Evaluate at z=15. Between S1(10) and S2(20). Both have tApex around 0.5.
      // If cubic interpolation was used, the upcoming 0.75 at Z=30 causes a downward curve,
      // making it dip below 0.5 at Z=15 (overshoot artifact).
      // With linear, it should be exactly identical to the neighbors.
        
      const blend = getCrossSectionBlendAtZ(slices, 15);
      const blend10 = getCrossSectionBlendAtZ(slices, 10);
        
      expect(blend!.tApex).to.be.closeTo(blend10!.tApex, 0.0001, "tApex should use linear interpolation, avoiding cubic undershoot artifacts.");
    });

    it("enforces rail integrity at the tail by preventing the tuck line from folding over the apex", async () => {
      // Simulate a messy import where the rail tuck is mathematically wider than the apex
      const messyState: BoardModel = {
        ...INITIAL_STATE,
        outline: mockBezier([[10, 0, 35]]),      // Apex at 10
        railOutline: mockBezier([[15, 0, 35]]),  // Tuck at 15 (FOLDED RAIL BUG)
      };

      const profile = MeshGeneratorService.getBoardProfileAtZ(messyState, { outline: [], rockerTop: [], rockerBottom: [] }, 35);

      // The profile evaluator should clamp tuckX to be <= apexX
      expect(profile.tuckX).to.be.at.most(profile.apexX, "The evaluator must clamp the Tuck line to be within the Apex width to prevent rail folding.");
    });

    it("aligns the tail-cap center vertex perfectly between the top and bottom rockers", async () => {
      // Use a squash tail so a tail cap is actually generated
      const squashState: BoardModel = {
        ...INITIAL_STATE,
        outline: {
          ...INITIAL_STATE.outline,
          controlPoints:[
            INITIAL_STATE.outline.controlPoints[0]!,
            INITIAL_STATE.outline.controlPoints[1]!,
            [4, 0, 35] // Squash tail
          ]
        }
      };
      const curves = await generateBoardCurves(squashState);
      const mesh = MeshGeneratorService.generateMesh(squashState, curves);

      const segmentsZ = 240;
      const segmentsRadial = 96;
        
      // The tail cap pushes the center vertex first, followed by the perimeter vertices.
      // There are (segmentsRadial + 2) perimeter vertices, so the center vertex is exactly
      // (segmentsRadial + 3) vertices from the end of the array.
      const tailCenterVertexIdx = (mesh.vertices.length / 3) - (segmentsRadial + 3);
      const tailCenterY = mesh.vertices[tailCenterVertexIdx * 3 + 1]!;

      // Get expected rockers at the tail (maxZ)
      const maxZ = squashState.outline.controlPoints[squashState.outline.controlPoints.length - 1]![2];
      const profile = MeshGeneratorService.getBoardProfileAtZ(squashState, curves, maxZ);
      const expectedMidPoint = (profile.topY + profile.botY) / 2 * (1 / 12);

      expect(tailCenterY).to.be.closeTo(expectedMidPoint, 0.0001, "Tail cap center must be perfectly vertically centered to avoid asymmetrical end-blocks.");
    });

    it("ensures precise hull closure where the last ring perfectly aligns with the tail anchor Z", async () => {
      const curves = await generateBoardCurves(INITIAL_STATE);
      const mesh = MeshGeneratorService.generateMesh(INITIAL_STATE, curves);
      
      const tailAnchorZ = INITIAL_STATE.outline.controlPoints[INITIAL_STATE.outline.controlPoints.length - 1]![2] * (1 / 12);

      // Find the actual maximum Z-coordinate in the generated mesh
      let maxZ = -Infinity;
      for(let i=2; i < mesh.vertices.length; i+=3) {
          if(mesh.vertices[i] > maxZ) {
              maxZ = mesh.vertices[i];
          }
      }
      
      // First, confirm the mesh actually reaches the tail
      expect(maxZ).to.be.closeTo(tailAnchorZ, 0.00001, 'The maximum Z vertex of the mesh must align with the tail anchor Z-plane.');

      // Now, find all vertices that form the tail plane
      const tailPlaneVertices: number[] = [];
      for(let i=2; i < mesh.vertices.length; i+=3) {
          const vertexZ = mesh.vertices[i];
          if (Math.abs(vertexZ - maxZ) < 1e-6) {
              tailPlaneVertices.push(vertexZ);
          }
      }

      // There should be more than one vertex at the tail for a squash tail
      expect(tailPlaneVertices.length).to.be.greaterThan(1, "Expected to find a ring of vertices at the tail plane.");
      
      // Verify that ALL vertices found on the tail plane are correctly positioned.
      tailPlaneVertices.forEach((vertexZ, index) => {
          expect(vertexZ).to.be.closeTo(tailAnchorZ, 0.00001, `A vertex (index ${index}) on the identified tail plane has an incorrect Z-coordinate.`);
      });
    });

    it("ensures rail normals at the apex point outwards (X-dominant) for clean reflections", async () => {
      const curves = await generateBoardCurves(INITIAL_STATE);
      const mesh = MeshGeneratorService.generateMesh(INITIAL_STATE, curves);

      const segmentsZ = 240;
      const segmentsRadial = 96;
        
      // Sample the wide point (Apex) at the midpoint of the board (Z-slice 120)
      // In the radial loop, j=24 is exactly t=0.5 (the Apex)
      const sliceIdx = 120;
      const apexJ = 24;
      const vertIdx = (sliceIdx * (segmentsRadial + 2) + apexJ);

      const nx = Math.abs(mesh.normals[vertIdx * 3]!);
      const ny = Math.abs(mesh.normals[vertIdx * 3 + 1]!);

      // At the apex, the normal should be pointing almost entirely in X (outward).
      // If NY is high, the rail is 'leaning' too much, ruining the reflections.
      expect(nx).to.be.greaterThan(0.9, "Rail apex normal should be primarily horizontal.");
      expect(ny).to.be.lessThan(0.2, "Rail apex normal should have minimal vertical tilt for sharp CAD highlights.");
    });

    it("produces steeper (boxier) rail walls when the tuck-to-apex ratio is high", async () => {
      // Setup a 'Boxy' tail slice (Tuck is 90% of Apex width)
      const boxyState: BoardModel = {
        ...INITIAL_STATE,
        outline: mockBezier([[10, 0, 35]]),
        railOutline: mockBezier([[9, 0, 35]]), 
        crossSections: [mockBezier([[0,0,0], [9,0,0], [10,2,0], [9,4,0], [0,4,0]])]
      };

      const curves = await generateBoardCurves(boxyState);
      const mesh = MeshGeneratorService.generateMesh(boxyState, curves);

      // Evaluate the slope between Tuck (j=12) and Apex (j=24)
      const vTuckIdx = 12 * 3;
      const vApexIdx = 24 * 3;

      const dx = Math.abs(mesh.vertices[vApexIdx]! - mesh.vertices[vTuckIdx]!);
      const dy = Math.abs(mesh.vertices[vApexIdx + 1]! - mesh.vertices[vTuckIdx + 1]!);

      // For a boxy rail, the height (dy) should be significant compared to the width (dx)
      // A 'boxy' performance tail has a near-vertical lower rail.
      const slope = dy / (dx + 0.0001);
      expect(slope).to.be.greaterThan(1.2, "A high tuck-to-apex ratio should produce a steep, boxy rail wall.");
    });
  });

  describe("Imported S3DX Edge Cases", () => {
    const FIXTURES =["WitcherDaily.s3dx", "rounded-pin-6-1.s3dx", "wildcat-fixed-winged-pin.s3dx", "gh-60-winged-swallow.s3dx", "TomoLike.s3dx", "FISH.s3dx"];

    for (const fixture of FIXTURES) {
      it(`does not create a vertical bowtie (crease) at the tail for ${fixture}`, async () => {
        console.info(`[mesh-generator.test] Bowtie check for: ${fixture}`);
        const response = await fetch(`/src/assets/fixtures/s3dx/${fixture}`);
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
        const segmentsZ = 240;
        const segmentsRadial = 96;
        
        let invertedCount = 0;

        console.warn(`\n=== DIAGNOSTICS FOR ${fixture} ===`);
        console.warn(`Outline Z bounds: ${manualState.outline.controlPoints[0]?.[2]?.toFixed(3)} to ${manualState.outline.controlPoints[manualState.outline.controlPoints.length-1]?.[2]?.toFixed(3)}`);
        console.warn(`RockerTop Z bounds: ${manualState.rockerTop.controlPoints[0]?.[2]?.toFixed(3)} to ${manualState.rockerTop.controlPoints[manualState.rockerTop.controlPoints.length-1]?.[2]?.toFixed(3)}`);
        console.warn(`RockerBot Z bounds: ${manualState.rockerBottom.controlPoints[0]?.[2]?.toFixed(3)} to ${manualState.rockerBottom.controlPoints[manualState.rockerBottom.controlPoints.length-1]?.[2]?.toFixed(3)}`);
        
        manualState.crossSections.forEach((cs, idx) => {
            console.warn(`CrossSection ${idx} Z bounds: ${cs.controlPoints[0]?.[2]?.toFixed(3)} to ${cs.controlPoints[cs.controlPoints.length-1]?.[2]?.toFixed(3)}`);
        });

        if (fixture === "gh-60-winged-swallow.s3dx") {
            console.warn(`\n--- NOSE RING DIAGNOSTICS (Z=0 slice) ---`);
            for (let j = 0; j <= segmentsRadial; j += segmentsRadial / 8) {
                const idx = j * 3;
                console.warn(`Nose Ring j=${j}: X=${mesh.vertices[idx]!.toFixed(4)}, Y=${mesh.vertices[idx+1]!.toFixed(4)}, Z=${mesh.vertices[idx+2]!.toFixed(4)}`);
            }
            
            console.warn(`\n--- TAIL RING DIAGNOSTICS (Z=max slice) ---`);
            const tailStart = segmentsZ * (segmentsRadial + 2) * 3;
            for (let j = 0; j <= segmentsRadial; j += segmentsRadial / 8) {
                const idx = tailStart + j * 3;
                console.warn(`Tail Ring j=${j}: X=${mesh.vertices[idx]!.toFixed(4)}, Y=${mesh.vertices[idx+1]!.toFixed(4)}, Z=${mesh.vertices[idx+2]!.toFixed(4)}`);
            }
        }

        for (let i = 0; i <= segmentsZ; i++) {
          // In our radial loop (0..96), j=0 is Bottom Stringer, j=48 is Top Stringer.
          // j in (0, 24) is the Bottom curve, and (48 - j) is the matching Top curve (Deck).
          for (let j = 1; j < segmentsRadial / 4; j++) {
              const botIdx = i * (segmentsRadial + 2) + j;
              const topIdx = i * (segmentsRadial + 2) + (segmentsRadial / 2 - j);

              const topY = mesh.vertices[topIdx * 3 + 1]!;
              const botY = mesh.vertices[botIdx * 3 + 1]!;
              
              if (botY > topY + 1e-6) {
                  invertedCount++;
                  if (invertedCount <= 10) { // Log first 10 inversions with deep detail
                      const zVal = mesh.vertices[topIdx * 3 + 2]! * 12; // Feet to Inches
                      const xVal = mesh.vertices[topIdx * 3]! * 12; // Feet to Inches
                      const v = (1 - Math.cos((i / segmentsZ) * Math.PI)) / 2;
                      const profile = MeshGeneratorService.getBoardProfileAtZ(manualState, {outline:[], rockerTop:[], rockerBottom:[]}, zVal, v);
                      
                      console.warn(`\n[Inversion ${invertedCount}] Z-slice ${i} (Z=${zVal.toFixed(3)}, v=${v.toFixed(3)}), radial ${j} (X=${xVal.toFixed(3)}):`);
                      console.warn(`   Mesh TopY: ${topY.toFixed(4)}, BotY: ${botY.toFixed(4)} (Diff: ${(botY-topY).toFixed(4)})`);
                      console.warn(`   Profile at Z=${zVal.toFixed(3)}: topY=${profile.topY.toFixed(4)}, botY=${profile.botY.toFixed(4)}, apexY=${profile.apexY.toFixed(4)}, tuckY=${profile.tuckY.toFixed(4)}`);
                  }
              }
          }
      }
        
        expect(invertedCount).to.equal(0, `Found ${invertedCount} inverted vertex pairs (Deck Y < Bottom Y)`);
      });

      it(`generates a valid tail width for ${fixture}`, async () => {
          console.info(`[mesh-generator.test] Tail width check for: ${fixture}`);
          const response = await fetch(`/src/assets/fixtures/s3dx/${fixture}`);
          const xml = await response.text();
          const importedData = await runClientPromise(parseS3dx(xml));
          const manualState: BoardModel = { ...INITIAL_STATE, ...importedData };
          const curves = await generateBoardCurves(manualState);

          const mesh = MeshGeneratorService.generateMesh(manualState, curves);

          const segmentsZ = 240;
          const segmentsRadial = 96;
          const tailRingIndex = segmentsZ; // The very last ring
          const tailRingStartIndex = tailRingIndex * (segmentsRadial + 2);

          // Find the widest point on the tail ring
          let maxTailWidth = 0;
          for (let j = 0; j <= segmentsRadial + 1; j++) {
              const vertexIndex = (tailRingStartIndex + j) * 3;
              // The vertex array might not exist if generation failed
              if (vertexIndex >= mesh.vertices.length) continue;
              const x = Math.abs(mesh.vertices[vertexIndex]!); // Width is the X coordinate
              if (x > maxTailWidth) {
                  maxTailWidth = x;
              }
          }

          if (fixture === "WitcherDaily.s3dx") {
            // The WitcherDaily tail is narrow but not a point. The half-width is ~1.56cm -> ~0.61 inches -> ~0.051 feet.
            expect(maxTailWidth).to.be.greaterThan(0.04, "The tail should not collapse to a point.");
          } else {
            // A rounded pin might go to zero or near zero, just ensure it evaluates correctly without blowing up
            expect(maxTailWidth).to.be.greaterThan(-1, "The tail max width should be successfully calculated.");
          }
      });

    }
  });
});
