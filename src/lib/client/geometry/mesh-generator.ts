// src/lib/client/geometry/mesh-generator.ts
import * as THREE from "three";
import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";

export interface RawGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  volumeLiters: number;
}

export const cubicInterpolate = (y0: number, y1: number, y2: number, y3: number, mu: number): number => {
  const mu2 = mu * mu;
  const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const a2 = -0.5 * y0 + 0.5 * y2;
  const a3 = y1;
  return a0 * mu * mu2 + a1 * mu2 + a2 * mu + a3;
};

export const cubicInterpolatePt = (p0: Point3D, p1: Point3D, p2: Point3D, p3: Point3D, t: number): Point3D => {
  return[
    cubicInterpolate(p0[0], p1[0], p2[0], p3[0], t),
    cubicInterpolate(p0[1], p1[1], p2[1], p3[1], t),
    cubicInterpolate(p0[2], p1[2], p2[2], p3[2], t)
  ];
};

const colorHeatmap = (normalizedValue: number): [number, number, number] => {
  const hue = (1.0 - normalizedValue) * 240;
  const h = hue / 360;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return[hue2rgb(0, 1, h + 1 / 3), hue2rgb(0, 1, h), hue2rgb(0, 1, h - 1 / 3)];
};

const evaluateBezier3D = (bezier: BezierCurveData, t: number): Point3D => {
  const numSegments = bezier.controlPoints.length - 1;
  if (numSegments <= 0) return bezier.controlPoints[0] ||[0, 0, 0];
  const scaledT = t * numSegments;
  let segmentIdx = Math.floor(scaledT);
  if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
  const localT = scaledT - segmentIdx;

  const P0 = bezier.controlPoints[segmentIdx] ||[0, 0, 0];
  const P1 = bezier.controlPoints[segmentIdx + 1] ||[0, 0, 0];
  const T0 = bezier.tangents2[segmentIdx] || [0, 0, 0];
  const T1 = bezier.tangents1[segmentIdx + 1] || [0, 0, 0];

  const u = 1 - localT;
  const tt = localT * localT;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * localT;

  return[
    uuu * P0[0] + 3 * uu * localT * T0[0] + 3 * u * tt * T1[0] + ttt * P1[0],
    uuu * P0[1] + 3 * uu * localT * T0[1] + 3 * u * tt * T1[1] + ttt * P1[1],
    uuu * P0[2] + 3 * uu * localT * T0[2] + 3 * u * tt * T1[2] + ttt * P1[2]
  ];
};

const evaluateBezierAtZ = (bezier: BezierCurveData, targetZ: number): Point3D => {
  let t0 = 0;
  let t1 = 1;
  let p = evaluateBezier3D(bezier, 0.5);
  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = evaluateBezier3D(bezier, tMid);
    if (p[2] < targetZ) t0 = tMid;
    else t1 = tMid;
  }
  return p;
};

export const getBoardProfileAtZ = (model: BoardModel, _curves: BoardCurves, zInches: number) => {
  const topPt = evaluateBezierAtZ(model.rockerTop, zInches);
  const botPt = evaluateBezierAtZ(model.rockerBottom, zInches);
  const outlinePt = evaluateBezierAtZ(model.outline, zInches);

  let apexX = outlinePt[0];
  let apexY = botPt[1] + (topPt[1] - botPt[1]) * 0.3;
  if (model.apexOutline && model.apexOutline.controlPoints.length > 0) {
    apexX = evaluateBezierAtZ(model.apexOutline, zInches)[0];
  }
  if (model.apexRocker && model.apexRocker.controlPoints.length > 0) {
    apexY = evaluateBezierAtZ(model.apexRocker, zInches)[1];
  }

  let tuckX = outlinePt[0];
  let tuckY = botPt[1];
  if (model.railOutline && model.railOutline.controlPoints.length > 0) {
    const railPt = evaluateBezierAtZ(model.railOutline, zInches);
    tuckX = railPt[0];
    tuckY = railPt[1];
  }

  return { 
    topY: topPt[1], 
    botY: botPt[1], 
    apexX: Math.max(0, apexX),
    apexY, 
    tuckX: Math.max(0, tuckX),
    tuckY,
    halfWidth: Math.max(0, outlinePt[0]) 
  };
};

const findApexT = (bezier: BezierCurveData): number => {
  let bestT = 0.5;
  let maxX = -Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = evaluateBezier3D(bezier, t);
    if (p[0] > maxX) {
      maxX = p[0];
      bestT = t;
    }
  }
  let searchT = bestT;
  let stepSize = 1.0 / steps;
  for (let refinement = 0; refinement < 3; refinement++) {
    stepSize /= 10;
    const startT = Math.max(0, searchT - stepSize * 5);
    const endT = Math.min(1, searchT + stepSize * 5);
    maxX = -Infinity;
    for (let t = startT; t <= endT; t += stepSize) {
      const p = evaluateBezier3D(bezier, t);
      if (p[0] > maxX) {
        maxX = p[0];
        bestT = t;
      }
    }
    searchT = bestT;
  }
  return bestT;
};

export const getCrossSectionBlendAtZ = (crossSections: BezierCurveData[], zInches: number) => {
  if (crossSections.length === 0) return null;
  const minZ = crossSections[0]!.controlPoints[0]![2];
  const maxZ = crossSections[crossSections.length - 1]!.controlPoints[0]![2];
  let k0 = 0,
    lerpFactor = 0;

  if (zInches <= minZ) k0 = 0;
  else if (zInches >= maxZ) k0 = crossSections.length - 1;
  else {
    for (let k = 0; k < crossSections.length - 1; k++) {
      const z0 = crossSections[k]!.controlPoints[0]![2],
        z1 = crossSections[k + 1]!.controlPoints[0]![2];
      if (zInches >= z0 && zInches <= z1) {
        k0 = k;
        lerpFactor = (zInches - z0) / (z1 - z0);
        break;
      }
    }
  }

  const sM1 = crossSections[Math.max(0, k0 - 1)]!,
    s0 = crossSections[k0]!,
    s1 = crossSections[Math.min(crossSections.length - 1, k0 + 1)]!,
    s2 = crossSections[Math.min(crossSections.length - 1, k0 + 2)]!;

  const tApexM1 = findApexT(sM1);
  const tApex0 = findApexT(s0);
  const tApex1 = findApexT(s1);
  const tApex2 = findApexT(s2);
  
  const tApex = cubicInterpolate(tApexM1, tApex0, tApex1, tApex2, lerpFactor);

  return {
    tApex: Math.max(0, Math.min(1, tApex)),
    evaluate: (tMid: number) =>
      cubicInterpolatePt(
        evaluateBezier3D(sM1, tMid),
        evaluateBezier3D(s0, tMid),
        evaluateBezier3D(s1, tMid),
        evaluateBezier3D(s2, tMid),
        lerpFactor,
      ),
  };
};

export const getBottomYAt = (model: BoardModel, curves: BoardCurves, xInches: number, zInches: number) => {
  const profile = getBoardProfileAtZ(model, curves, zInches);
  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);
  if (!blend || profile.halfWidth <= 0.001) return profile.botY;

  // Match the strict 5-point structural anchoring (0.5 = Apex)
  const pApex = blend.evaluate(0.5);
  const sliceApexX = Math.max(0.001, pApex[0]);
  const sliceApexY = pApex[1];
  const sliceBotY = blend.evaluate(0.0)[1];

  let t0 = 0,
    t1 = 0.5,
    p = [0, 0, 0] as Point3D;
  const targetX = Math.abs(xInches);

  const pTuck = blend.evaluate(0.25);
  const sliceTuckX = Math.max(0.001, pTuck[0]);
  const sliceTuckY = pTuck[1];

  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = blend.evaluate(tMid);
    
    let mappedX = 0;
    if (tMid <= 0.25) {
      mappedX = (p[0] / sliceTuckX) * profile.tuckX;
    } else {
      const rangeX = sliceApexX - sliceTuckX;
      const normX = rangeX > 0.001 ? (p[0] - sliceTuckX) / rangeX : 0;
      mappedX = profile.tuckX + normX * (profile.apexX - profile.tuckX);
    }

    if (mappedX < targetX) t0 = tMid;
    else t1 = tMid;
  }

  let finalY = 0;
  if (t0 <= 0.25) {
    const rangeY = sliceTuckY - sliceBotY;
    const normY = rangeY > 0.001 ? (p[1] - sliceBotY) / rangeY : 0;
    finalY = profile.botY + normY * (profile.tuckY - profile.botY);
  } else {
    const rangeY = sliceApexY - sliceTuckY;
    const normY = rangeY > 0.001 ? (p[1] - sliceTuckY) / rangeY : 0;
    finalY = profile.tuckY + normY * (profile.apexY - profile.tuckY);
  }

  return finalY;
};

export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, _curves: BoardCurves): RawGeometryData => generateMesh(model),
  getBoardProfileAtZ,
  getBottomYAt,
};

const calculateVolume = (vertices: number[], indices: number[]): number => {
  let vol = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const iA = indices[i]! * 3,
      iB = indices[i + 1]! * 3,
      iC = indices[i + 2]! * 3;
    const p1x = vertices[iA]!, p1y = vertices[iA + 1]!, p1z = vertices[iA + 2]!;
    const p2x = vertices[iB]!, p2y = vertices[iB + 1]!, p2z = vertices[iB + 2]!;
    const p3x = vertices[iC]!, p3y = vertices[iC + 1]!, p3z = vertices[iC + 2]!;
    vol +=
      (p1x * (p2y * p3z - p2z * p3y) +
        p1y * (p2z * p3x - p2x * p3z) +
        p1z * (p2x * p3y - p2y * p3x)) /
      6.0;
  }
  return Math.abs(vol) * 1728 * 0.0163871;
};

const generateMesh = (model: BoardModel): RawGeometryData => {
  const segmentsZ = 180;
  const segmentsRadial = 48;
  const scale = 1 / 12;
  const vertices: number[] =[];
  const indices: number[] = [];
  const uvs: number[] =[];
  const colors: number[] = [];
  const normals: number[] =[];

  const outline = model.outline;
  if (!outline || outline.controlPoints.length === 0)
    return {
      vertices: new Float32Array(),
      indices: new Uint32Array(),
      uvs: new Float32Array(),
      colors: new Float32Array(),
      normals: new Float32Array(),
      volumeLiters: 0,
    };

  const minZ = outline.controlPoints[0]![2];
  const maxZ = outline.controlPoints[outline.controlPoints.length - 1]![2];

  const noseProfile = getBoardProfileAtZ(model, { outline:[], rockerTop: [], rockerBottom:[] }, minZ);
  const tailProfile = getBoardProfileAtZ(model, { outline:[], rockerTop: [], rockerBottom:[] }, maxZ);

  // --- STEP 0: PRE-CALCULATE ARC LENGTH FOR V-COORDINATE ---
  // This maps UV.v to cumulative 3D distance to prevent texture warping at the tips.
  const sliceArcLengths = new Float32Array(segmentsZ + 1);
  let totalArcLength = 0;
  const lastCenterPos = new THREE.Vector3();

  for (let i = 0; i <= segmentsZ; i++) {
    const nz = (1 - Math.cos((i / segmentsZ) * Math.PI)) / 2;
    const zInches = minZ + nz * (maxZ - minZ);
    const profile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom:[] }, zInches);
    
    // Using centerline vertical average as the arc-length spine
    const cy = (profile.topY + profile.botY) / 2;
    const currentCenterPos = new THREE.Vector3(0, cy * scale, zInches * scale);
    
    if (i > 0) {
      totalArcLength += currentCenterPos.distanceTo(lastCenterPos);
    }
    sliceArcLengths[i] = totalArcLength;
    lastCenterPos.copy(currentCenterPos);
  }

  const vertexGrid: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[][] =[];

  // STEP 1: Generate all vertex positions for the hull
  for (let i = 0; i <= segmentsZ; i++) {
    const ring: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[] =[];
    const zInches = minZ + ((1 - Math.cos((i / segmentsZ) * Math.PI)) / 2) * (maxZ - minZ);
    const vCoord = sliceArcLengths[i]! / totalArcLength;
    
    // Implement Geometric Tip Fading (1.5" fade zone for smooth closure of pointed tips)
    let fadeFactor = 1.0;
    const fadeZone = 1.5;
    if (noseProfile.halfWidth < 1e-3 && (zInches - minZ) < fadeZone) {
      fadeFactor = Math.min(fadeFactor, (zInches - minZ) / fadeZone);
    }
    if (tailProfile.halfWidth < 1e-3 && (maxZ - zInches) < fadeZone) {
      fadeFactor = Math.min(fadeFactor, (maxZ - zInches) / fadeZone);
    }
    fadeFactor = fadeFactor * fadeFactor * (3 - 2 * fadeFactor); // Smoothstep

    const profile = getBoardProfileAtZ(model, { outline:[], rockerTop: [], rockerBottom:[] }, zInches);
    const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

    let sliceTopY = 1.0, sliceBotY = 0.0, sliceApexX = 1.0, sliceApexY = 0.5;
    if (blend) {
      const pBot = blend.evaluate(0.0);
      const pTop = blend.evaluate(1.0);
      const pApex = blend.evaluate(blend.tApex);
      sliceBotY = pBot[1];
      sliceTopY = pTop[1];
      sliceApexX = Math.max(0.001, pApex[0]);
      sliceApexY = pApex[1];
    }

    for (let j = 0; j <= segmentsRadial; j++) {
      let t = 0.0, side = 1.0;
      const isStringer = j === 0 || j === segmentsRadial / 2 || j === segmentsRadial;
      if (j <= segmentsRadial / 2) {
        t = j / (segmentsRadial / 2);
      } else {
        t = 1.0 - (j - segmentsRadial / 2) / (segmentsRadial / 2);
        side = -1.0;
      }

      let px = 0, py = profile.botY + (profile.topY - profile.botY) / 2;

      if (blend) {
        const p = blend.evaluate(t);
        const normX = sliceApexX > 0.001 ? p[0] / sliceApexX : 0;
        px = isStringer ? 0 : side * normX * profile.apexX;
        
        if (p[1] >= sliceApexY) {
          const rangeY = sliceTopY - sliceApexY;
          const normY = rangeY > 0.001 ? (p[1] - sliceApexY) / rangeY : 0;
          py = profile.apexY + normY * (profile.topY - profile.apexY);
        } else {
          const rangeY = sliceApexY - sliceBotY;
          const normY = rangeY > 0.001 ? (sliceApexY - p[1]) / rangeY : 0;
          py = profile.apexY - normY * (profile.apexY - profile.botY);
        }
      }

      // Smoothly pinch the thickness to a point at the absolute tips
      const centerY = profile.botY + (profile.topY - profile.botY) / 2;
      py = centerY + (py - centerY) * fadeFactor;

      // Force exact 0 at the absolute tips to prevent hash mismatch boundary edges
      if ((i === 0 && noseProfile.halfWidth < 1e-3) || (i === segmentsZ && tailProfile.halfWidth < 1e-3)) {
        px = 0;
        py = centerY;
      }

      const pos = new THREE.Vector3(px * scale, py * scale, zInches * scale);
      const uv = new THREE.Vector2(j / segmentsRadial, vCoord);
      const color = new THREE.Color(...colorHeatmap(Math.max(0, Math.min(1, (profile.topY - profile.botY) / model.thickness))));
      ring.push({ pos, color, uv });
    }
    vertexGrid.push(ring);
  }

  // STEP 2: Calculate analytical normals and populate final arrays
  for (let i = 0; i <= segmentsZ; i++) {
    for (let j = 0; j <= segmentsRadial; j++) {
      const { pos, color, uv } = vertexGrid[i]![j]!;
      vertices.push(pos.x, pos.y, pos.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(uv.x, uv.y);

      const tangentZ = new THREE.Vector3();
      const tangentR = new THREE.Vector3();
      const normal = new THREE.Vector3();

      // Extrapolate Hull Z tangents for the absolute tips instead of forcing flat normals
      if (i === 0) {
        tangentZ.subVectors(vertexGrid[1]![j]!.pos, vertexGrid[0]![j]!.pos);
      } else if (i === segmentsZ) {
        tangentZ.subVectors(vertexGrid[segmentsZ]![j]!.pos, vertexGrid[segmentsZ - 1]![j]!.pos);
      } else {
        tangentZ.subVectors(vertexGrid[i + 1]![j]!.pos, vertexGrid[i - 1]![j]!.pos);
      }

      if (j > 0 && j < segmentsRadial) {
          tangentR.subVectors(vertexGrid[i]![j + 1]!.pos, vertexGrid[i]![j - 1]!.pos);
      } else {
          tangentR.subVectors(vertexGrid[i]![1]!.pos, vertexGrid[i]![segmentsRadial - 1]!.pos);
      }
      
      normal.crossVectors(tangentR, tangentZ).normalize();
      
      // Fallback if tangent calculation fails at a perfectly sharp mathematical point
      if (isNaN(normal.x) || normal.lengthSq() < 0.0001) {
        if (i === 0) normal.set(0, 0, -1);
        else if (i === segmentsZ) normal.set(0, 0, 1);
        else normal.set(0, j > segmentsRadial / 4 && j < segmentsRadial * 0.75 ? 1 : -1, 0);
      }

      normals.push(normal.x, normal.y, normal.z);
    }
  }

  // STEP 3: Generate Hull Indices
  for (let i = 0; i < segmentsZ; i++) {
    const isNosePinched = i === 0 && noseProfile.halfWidth < 1e-3;
    const isTailPinched = i === segmentsZ - 1 && tailProfile.halfWidth < 1e-3;

    for (let j = 0; j < segmentsRadial; j++) {
      const a = i * (segmentsRadial + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (segmentsRadial + 1) + j;
      const d = c + 1;
      
      if (isNosePinched) {
        // a and b are identical points at the nose tip.
        // Omit the degenerate (a, b, d) triangle.
        indices.push(a, d, c);
      } else if (isTailPinched) {
        // c and d are identical points at the tail tip.
        // Omit the degenerate (a, d, c) triangle.
        indices.push(a, b, d);
      } else {
        indices.push(a, b, d, a, d, c);
      }
    }
  }

  // STEP 4: Generate End Caps (Nose and Tail) if they possess physical dimensions
  // Only cap if the width is greater than zero. If width is 0, the hull already collapses onto a vertical line.
  const noseNeedsCap = noseProfile.halfWidth >= 1e-3;
  const tailNeedsCap = tailProfile.halfWidth >= 1e-3;
  const halfRadial = Math.floor(segmentsRadial / 2);

  if (noseNeedsCap) {
    const ringStartIndex = 0;
    const capVertexStartIndex = vertices.length / 3;

    for (let j = 0; j <= segmentsRadial; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, -1); // Nose faces backwards (-Z)
    }

    for (let j = 0; j < halfRadial; j++) {
      const a = capVertexStartIndex + j;
      const b = capVertexStartIndex + j + 1;
      const c = capVertexStartIndex + segmentsRadial - j;
      const d = capVertexStartIndex + segmentsRadial - (j + 1);
      
      if (j === 0) {
        // Bottom stringer (a and c are identical), omit degenerate triangle
        indices.push(a, d, b);
      } else if (j === halfRadial - 1) {
        // Top stringer (b and d are identical), omit degenerate triangle
        indices.push(a, c, b);
      } else {
        indices.push(a, d, b, a, c, d); // Reversed winding for front face
      }
    }
  }

  if (tailNeedsCap) {
    const ringStartIndex = segmentsZ * (segmentsRadial + 1);
    const capVertexStartIndex = vertices.length / 3;

    for (let j = 0; j <= segmentsRadial; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, 1); // Tail faces forwards (+Z)
    }

    for (let j = 0; j < halfRadial; j++) {
      const a = capVertexStartIndex + j;
      const b = capVertexStartIndex + j + 1;
      const c = capVertexStartIndex + segmentsRadial - j;
      const d = capVertexStartIndex + segmentsRadial - (j + 1);
      
      if (j === 0) {
        // Bottom stringer (a and c are identical), omit degenerate triangle
        indices.push(a, b, d);
      } else if (j === halfRadial - 1) {
        // Top stringer (b and d are identical), omit degenerate triangle
        indices.push(a, b, c);
      } else {
        indices.push(a, b, d, a, d, c); // Standard winding for back face
      }
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    normals: new Float32Array(normals),
    volumeLiters: calculateVolume(vertices, indices),
  };
};
