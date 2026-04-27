// File: src/lib/client/geometry/mesh-generator.ts
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

const colorHeatmap = (normalizedValue: number):[number, number, number] => {
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
  if (numSegments <= 0) return bezier.controlPoints[0] || [0, 0, 0];
  const scaledT = t * numSegments;
  let segmentIdx = Math.floor(scaledT);
  if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
  const localT = scaledT - segmentIdx;

  const P0 = bezier.controlPoints[segmentIdx] || [0, 0, 0];
  const P1 = bezier.controlPoints[segmentIdx + 1] || [0, 0, 0];
  const T0 = bezier.tangents2[segmentIdx] || [0, 0, 0];
  const T1 = bezier.tangents1[segmentIdx + 1] ||[0, 0, 0];

  const u = 1 - localT;
  const tt = localT * localT;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * localT;

  return [
    uuu * P0[0] + 3 * uu * localT * T0[0] + 3 * u * tt * T1[0] + ttt * P1[0],
    uuu * P0[1] + 3 * uu * localT * T0[1] + 3 * u * tt * T1[1] + ttt * P1[1],
    uuu * P0[2] + 3 * uu * localT * T0[2] + 3 * u * tt * T1[2] + ttt * P1[2]
  ];
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

  const tApex0 = findApexT(s0);
  const tApex1 = findApexT(s1);
  
  // Use linear interpolation for the parameter T to prevent overshoot artifacts at sharp tail decks
  const tApex = tApex0 + (tApex1 - tApex0) * lerpFactor;

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

/**
 * Calculates a 3D coordinate on the board's surface based purely on parametric UV mapping.
 * u [0..1] goes from the stringer bottom (0), around the rail, to stringer top (1).
 * v [0..1] goes lengthways from Nose to Tail (or Tail to Nose depending on data orientation).
 */
export const getPointAtUV = (model: BoardModel, u: number, v: number): Point3D => {
  const outPt = evaluateBezier3D(model.outline, v);
  const zInches = outPt[2];

  // Z-evaluate to ensure rockers align precisely with the outline's spatial Z
  const topPt = evaluateBezierAtZ(model.rockerTop, zInches);
  const botPt = evaluateBezierAtZ(model.rockerBottom, zInches);

  // Prevent vertical bowtie inversion
  if (topPt[1] < botPt[1]) {
    topPt[1] = botPt[1];
  }

  let apexX = outPt[0];
  let apexY = botPt[1] + (topPt[1] - botPt[1]) * 0.3;
  let tuckY = botPt[1];

  if (model.apexOutline && model.apexOutline.controlPoints.length > 0) {
    apexX = evaluateBezierAtZ(model.apexOutline, zInches)[0];
  }

  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

  if (blend) {
    const pBot = blend.evaluate(0.0);
    const pTop = blend.evaluate(1.0);
    const pApex = blend.evaluate(blend.tApex);

    const sliceThick = Math.max(0.001, pTop[1] - pBot[1]);
    const apexFrac = (pApex[1] - pBot[1]) / sliceThick;
    const worldThick = topPt[1] - botPt[1];
    apexY = botPt[1] + worldThick * apexFrac;
  }

  if (model.apexRocker && model.apexRocker.controlPoints.length > 0) {
    apexY = evaluateBezierAtZ(model.apexRocker, zInches)[1];
  }

  if (blend) {
    const pBot = blend.evaluate(0.0);
    const pApex = blend.evaluate(blend.tApex);
    const pTuck = blend.evaluate(0.25);

    const sliceBotToApex = pApex[1] - pBot[1];
    if (Math.abs(sliceBotToApex) > 0.001) {
      const tuckFracBot = (pTuck[1] - pBot[1]) / sliceBotToApex;
      tuckY = botPt[1] + tuckFracBot * (apexY - botPt[1]);
    } else {
      tuckY = botPt[1];
    }
  }

  let tuckX = outPt[0];
  if (model.railOutline && model.railOutline.controlPoints.length > 0) {
    tuckX = evaluateBezierAtZ(model.railOutline, zInches)[0];
  }

  const finalApexX = Math.max(0.001, apexX);
  const finalTuckX = Math.min(Math.max(0, tuckX), finalApexX);

  // Fallback map if no slices present
  if (!blend) {
    const py = botPt[1] + (topPt[1] - botPt[1]) * u;
    return [outPt[0], py, zInches];
  }

  let sliceTopY = 1.0, sliceBotY = 0.0, sliceApexX = 1.0, sliceApexY = 0.5, sliceTuckX = 0.8, sliceTuckY = 0.2;
  const pBot = blend.evaluate(0.0);
  const pTop = blend.evaluate(1.0);
  const pApex = blend.evaluate(blend.tApex);
  const pTuck = blend.evaluate(0.25);
  
  sliceBotY = pBot[1];
  sliceTopY = pTop[1];
  sliceApexX = Math.max(0.001, pApex[0]);
  sliceApexY = pApex[1];
  sliceTuckX = Math.max(0.001, pTuck[0]);
  sliceTuckY = pTuck[1];

  const p = blend.evaluate(u);
  let px = 0, py = botPt[1] + (topPt[1] - botPt[1]) / 2;

  // Cross-section deformation targeting based on u slice distribution
  if (u <= 0.25) {
    const normX = sliceTuckX > 0.001 ? p[0] / sliceTuckX : 0;
    px = normX * finalTuckX;
  } else if (u <= blend.tApex) {
    const rangeX = sliceApexX - sliceTuckX;
    const normX = rangeX > 0.001 ? (p[0] - sliceTuckX) / rangeX : 0;
    px = finalTuckX + normX * (finalApexX - finalTuckX);
  } else {
    const normX = sliceApexX > 0.001 ? p[0] / sliceApexX : 0;
    px = normX * finalApexX;
  }
  
  if (u <= 0.25) {
    const rangeY = sliceTuckY - sliceBotY;
    const normY = Math.abs(rangeY) > 0.001 ? (p[1] - sliceBotY) / rangeY : 0;
    py = botPt[1] + normY * (tuckY - botPt[1]);
  } else if (u <= blend.tApex) {
    const rangeY = sliceApexY - sliceTuckY;
    const normY = Math.abs(rangeY) > 0.001 ? (p[1] - sliceTuckY) / rangeY : 0;
    py = tuckY + normY * (apexY - tuckY);
  } else {
    const rangeY = sliceTopY - sliceApexY;
    const normY = Math.abs(rangeY) > 0.001 ? (p[1] - sliceApexY) / rangeY : 0;
    py = apexY + normY * (topPt[1] - apexY);
  }

  return [px, py, zInches];
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
  const segmentsV = 240;
  const segmentsU = 96; 
  const scale = 1 / 12;
  const vertices: number[] = [];
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

  const sliceArcLengths = new Float32Array(segmentsV + 1);
  let totalArcLength = 0;
  const lastCenterPos = new THREE.Vector3();

  // Preserves resolution distribution for smooth tip wrapping
  for (let i = 0; i <= segmentsV; i++) {
    const v = (1 - Math.cos((i / segmentsV) * Math.PI)) / 2;
    const outPt = evaluateBezier3D(model.outline, v);
    const topPt = evaluateBezier3D(model.rockerTop, v);
    const botPt = evaluateBezier3D(model.rockerBottom, v);
    const zInches = outPt[2];
    const cy = (topPt[1] + botPt[1]) / 2;
    
    const currentCenterPos = new THREE.Vector3(0, cy * scale, zInches * scale);
    
    if (i > 0) {
      totalArcLength += currentCenterPos.distanceTo(lastCenterPos);
    }
    sliceArcLengths[i] = totalArcLength;
    lastCenterPos.copy(currentCenterPos);
  }

  const vertexGrid: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[][] = [];

  const noseWidth = evaluateBezier3D(model.outline, 0)[0];
  const tailWidth = evaluateBezier3D(model.outline, 1)[0];

  for (let i = 0; i <= segmentsV; i++) {
    const ring: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[] =[];
    const v = (1 - Math.cos((i / segmentsV) * Math.PI)) / 2;
    const vCoord = sliceArcLengths[i]! / totalArcLength;
    
    const topPt = evaluateBezier3D(model.rockerTop, v);
    const botPt = evaluateBezier3D(model.rockerBottom, v);
    const localThickness = Math.max(0, topPt[1] - botPt[1]);
    const heatColor = new THREE.Color(...colorHeatmap(Math.max(0, Math.min(1, localThickness / model.thickness))));

    for (let j = 0; j <= segmentsU; j++) {
      let u = 0.0, side = 1.0;
      const isStringer = j === 0 || j === segmentsU / 2 || j === segmentsU;
      if (j <= segmentsU / 2) {
        u = j / (segmentsU / 2);
      } else {
        u = 1.0 - (j - segmentsU / 2) / (segmentsU / 2);
        side = -1.0;
      }

      let[px, py, pz] = getPointAtUV(model, u, v);
      
      if (isStringer) {
        px = 0;
      } else {
        px *= side;
      }

      // Mathematical tip lock
      if ((i === 0 && noseWidth < 1e-3) || (i === segmentsV && tailWidth < 1e-3)) {
        px = 0;
      }

      const pos = new THREE.Vector3(px * scale, py * scale, pz * scale);
      const uvVec = new THREE.Vector2(j / segmentsU, vCoord);
      
      ring.push({ pos, color: heatColor, uv: uvVec });
    }
    vertexGrid.push(ring);
  }

  // Compute analytical UV normals
  for (let i = 0; i <= segmentsV; i++) {
    for (let j = 0; j <= segmentsU; j++) {
      const { pos, color, uv } = vertexGrid[i]![j]!;
      vertices.push(pos.x, pos.y, pos.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(uv.x, uv.y);

      const tangentV = new THREE.Vector3();
      const tangentU = new THREE.Vector3();
      const normal = new THREE.Vector3();

      if (i === 0) {
        tangentV.subVectors(vertexGrid[1]![j]!.pos, vertexGrid[0]![j]!.pos);
      } else if (i === segmentsV) {
        tangentV.subVectors(vertexGrid[segmentsV]![j]!.pos, vertexGrid[segmentsV - 1]![j]!.pos);
      } else {
        tangentV.subVectors(vertexGrid[i + 1]![j]!.pos, vertexGrid[i - 1]![j]!.pos);
      }

      if (j > 0 && j < segmentsU) {
        tangentU.subVectors(vertexGrid[i]![j + 1]!.pos, vertexGrid[i]![j - 1]!.pos);
      } else {
        tangentU.subVectors(vertexGrid[i]![1]!.pos, vertexGrid[i]![segmentsU - 1]!.pos);
      }
      
      normal.crossVectors(tangentU, tangentV).normalize();
      
      if (isNaN(normal.x) || normal.lengthSq() < 0.0001) {
        if (i === 0) normal.set(0, 0, -1);
        else if (i === segmentsV) normal.set(0, 0, 1);
        else normal.set(0, j > segmentsU / 4 && j < segmentsU * 0.75 ? 1 : -1, 0);
      }

      normals.push(normal.x, normal.y, normal.z);
    }
  }

  // Hull Indices
  const pushTriangle = (i1: number, i2: number, i3: number) => {
    indices.push(i1, i2, i3);
  };

  for (let i = 0; i < segmentsV; i++) {
    for (let j = 0; j < segmentsU; j++) {
      const a = i * (segmentsU + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (segmentsU + 1) + j;
      const d = c + 1;
      
      pushTriangle(a, b, d);
      pushTriangle(a, d, c);
    }
  }

  // End Caps
  const noseNeedsCap = noseWidth >= 1e-3;
  const tailNeedsCap = tailWidth >= 1e-3;

  if (noseNeedsCap) {
    const ringStartIndex = 0;
    const capVertexStartIndex = vertices.length / 3;

    const botY = vertexGrid[0]![0]!.pos.y;
    const topY = vertexGrid[0]![segmentsU / 2]!.pos.y;
    const centerY = botY + (topY - botY) / 2;
    const centerZ = vertexGrid[0]![0]!.pos.z;
    
    vertices.push(0, centerY, centerZ);
    uvs.push(0.5, 0); 
    colors.push(1, 1, 1);
    normals.push(0, 0, -1); 
    
    const centerIdx = capVertexStartIndex;
    const perimeterStartIdx = centerIdx + 1;

    for (let j = 0; j <= segmentsU; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, -1);
    }

    for (let j = 0; j < segmentsU; j++) {
      indices.push(centerIdx, perimeterStartIdx + j + 1, perimeterStartIdx + j);
    }
  }

  if (tailNeedsCap) {
    const ringStartIndex = segmentsV * (segmentsU + 1);
    const capVertexStartIndex = vertices.length / 3;

    const botY = vertexGrid[segmentsV]![0]!.pos.y;
    const topY = vertexGrid[segmentsV]![segmentsU / 2]!.pos.y;
    const centerY = botY + (topY - botY) / 2;
    const centerZ = vertexGrid[segmentsV]![0]!.pos.z;

    vertices.push(0, centerY, centerZ);
    uvs.push(0.5, 1); 
    colors.push(1, 1, 1);
    normals.push(0, 0, 1); 

    const centerIdx = capVertexStartIndex;
    const perimeterStartIdx = centerIdx + 1;

    for (let j = 0; j <= segmentsU; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, 1);
    }

    for (let j = 0; j < segmentsU; j++) {
      indices.push(centerIdx, perimeterStartIdx + j, perimeterStartIdx + j + 1);
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
  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

  // Prevent vertical bowtie inversion (Deck Y < Bottom Y) caused by cubic Bezier overshoot at the tail
  if (topPt[1] < botPt[1]) {
    topPt[1] = botPt[1];
  }

  let apexX = outlinePt[0];
  let apexY = botPt[1] + (topPt[1] - botPt[1]) * 0.3;
  let tuckY = botPt[1];

  if (model.apexOutline && model.apexOutline.controlPoints.length > 0) {
    apexX = evaluateBezierAtZ(model.apexOutline, zInches)[0];
  }

  if (blend) {
    const pBot = blend.evaluate(0.0);
    const pTop = blend.evaluate(1.0);
    const pApex = blend.evaluate(blend.tApex);
    
    const sliceThick = Math.max(0.001, pTop[1] - pBot[1]);
    const apexFrac = (pApex[1] - pBot[1]) / sliceThick;
    
    const worldThick = topPt[1] - botPt[1];
    apexY = botPt[1] + worldThick * apexFrac;
  }

  if (model.apexRocker && model.apexRocker.controlPoints.length > 0) {
    apexY = evaluateBezierAtZ(model.apexRocker, zInches)[1];
  }

  if (blend) {
    const pBot = blend.evaluate(0.0);
    const pApex = blend.evaluate(blend.tApex);
    const pTuck = blend.evaluate(0.25);
    
    const sliceBotToApex = pApex[1] - pBot[1];
    if (Math.abs(sliceBotToApex) > 0.001) {
      const tuckFracBot = (pTuck[1] - pBot[1]) / sliceBotToApex;
      tuckY = botPt[1] + tuckFracBot * (apexY - botPt[1]);
    } else {
      tuckY = botPt[1];
    }
  }

  let tuckX = outlinePt[0];
  if (model.railOutline && model.railOutline.controlPoints.length > 0) {
    tuckX = evaluateBezierAtZ(model.railOutline, zInches)[0];
  }

  const finalApexX = Math.max(0.001, apexX);
  const finalTuckX = Math.min(Math.max(0, tuckX), finalApexX);

  return { 
    topY: topPt[1], 
    botY: botPt[1], 
    apexX: finalApexX,
    apexY, 
    tuckX: finalTuckX,
    tuckY,
    halfWidth: Math.max(0, outlinePt[0]) 
  };
};

export const getBottomYAt = (model: BoardModel, curves: BoardCurves, xInches: number, zInches: number) => {
  const profile = getBoardProfileAtZ(model, curves, zInches);
  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);
  if (!blend || profile.halfWidth <= 0.001) return profile.botY;

  // Match the strict 5-point structural anchoring
  const pApex = blend.evaluate(blend.tApex);
  const sliceApexX = Math.max(0.001, pApex[0]);
  const sliceApexY = pApex[1];
  const sliceBotY = blend.evaluate(0.0)[1];

  let t0 = 0,
    t1 = blend.tApex,
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
      mappedX = sliceTuckX > 0.001 ? (p[0] / sliceTuckX) * profile.tuckX : 0;
    } else {
      const rangeX = sliceApexX - sliceTuckX;
      const normX = rangeX > 0.001 ? (p[0] - sliceTuckX) / rangeX : 0;
      mappedX = profile.tuckX + normX * (profile.apexX - profile.tuckX);
    }

    if (mappedX < targetX) t0 = tMid;
    else t1 = tMid;
  }

  // 3-Piece Y Scaling matching generateMesh
  let py = profile.botY;
  if (t0 <= 0.25) {
    const rangeY = sliceTuckY - sliceBotY;
    const normY = Math.abs(rangeY) > 0.001 ? (p[1] - sliceBotY) / rangeY : 0;
    py = profile.botY + normY * (profile.tuckY - profile.botY);
  } else {
    const rangeY = sliceApexY - sliceTuckY;
    const normY = Math.abs(rangeY) > 0.001 ? (p[1] - sliceTuckY) / rangeY : 0;
    py = profile.tuckY + normY * (profile.apexY - profile.tuckY);
  }
  
  return py;
};

export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, _curves: BoardCurves): RawGeometryData => generateMesh(model),
  getPointAtUV,
  getBoardProfileAtZ,
  getBottomYAt,
};
