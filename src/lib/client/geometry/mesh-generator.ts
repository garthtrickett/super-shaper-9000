// src/lib/client/geometry/mesh-generator.ts
import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";

export interface RawGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
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
  return [
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
  return [hue2rgb(0, 1, h + 1 / 3), hue2rgb(0, 1, h), hue2rgb(0, 1, h - 1 / 3)];
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
  const T1 = bezier.tangents1[segmentIdx + 1] || [0, 0, 0];

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

  const pApex = blend.evaluate(blend.tApex);
  const sliceApexX = Math.max(0.001, pApex[0]);
  const sliceApexY = pApex[1];
  const sliceBotY = blend.evaluate(0.0)[1];

  let t0 = 0,
    t1 = blend.tApex,
    p = [0, 0, 0] as Point3D;
  const targetX = Math.abs(xInches);

  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = blend.evaluate(tMid);
    const normX = p[0] / sliceApexX;
    const mappedX = normX * profile.apexX;
    if (mappedX < targetX) t0 = tMid;
    else t1 = tMid;
  }

  const rangeY = sliceApexY - sliceBotY;
  const normY = rangeY > 0.001 ? (sliceApexY - p[1]) / rangeY : 0;
  return profile.apexY - normY * (profile.apexY - profile.botY);
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
    const p1 = [vertices[iA]!, vertices[iA + 1]!, vertices[iA + 2]!],
      p2 = [vertices[iB]!, vertices[iB + 1]!, vertices[iB + 2]!],
      p3 = [vertices[iC]!, vertices[iC + 1]!, vertices[iC + 2]!];
    vol +=
      (p1[0] * (p2[1] * p3[2] - p2[2] * p3[1]) +
        p1[1] * (p2[2] * p3[0] - p2[0] * p3[2]) +
        p1[2] * (p2[0] * p3[1] - p2[1] * p3[0])) /
      6.0;
  }
  return Math.abs(vol) * 1728 * 0.0163871;
};

const generateMesh = (model: BoardModel): RawGeometryData => {
  const segmentsZ = 180,
    segmentsRadial = 48,
    scale = 1 / 12;
  const vertices: number[] = [],
    indices: number[] = [],
    uvs: number[] = [],
    colors: number[] = [];

  const outline = model.outline;
  if (!outline || outline.controlPoints.length === 0)
    return {
      vertices: new Float32Array(),
      indices: new Uint32Array(),
      uvs: new Float32Array(),
      colors: new Float32Array(),
      volumeLiters: 0,
    };

  const minZ = outline.controlPoints[0]![2],
    maxZ = outline.controlPoints[outline.controlPoints.length - 1]![2],
    totalZ = maxZ - minZ;

  for (let i = 0; i <= segmentsZ; i++) {
    const nz = (1 - Math.cos((i / segmentsZ) * Math.PI)) / 2,
      zInches = minZ + nz * totalZ,
      vCoord = nz;
    const profile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, zInches);
    const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

    let sliceTopY = 1.0,
      sliceBotY = 0.0,
      sliceApexX = 1.0,
      sliceApexY = 0.5;

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
      let t = 0.0,
        side = 1.0;
      const isStringer = j === 0 || j === segmentsRadial / 2 || j === segmentsRadial;

      if (j <= segmentsRadial / 2) {
        t = j / (segmentsRadial / 2);
      } else {
        t = 1.0 - (j - segmentsRadial / 2) / (segmentsRadial / 2);
        side = -1.0;
      }

      let px = 0,
        py = profile.botY + (profile.topY - profile.botY) / 2;
        
      if (blend && profile.halfWidth > 0.001) {
        const p = blend.evaluate(t);
        
        const normX = p[0] / sliceApexX;
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

      vertices.push(px * scale, py * scale, zInches * scale);
      uvs.push(j / segmentsRadial, vCoord);
      const [r, g, b] = colorHeatmap(Math.max(0, Math.min(1, (profile.topY - profile.botY) / model.thickness)));
      colors.push(r, g, b);
    }
  }

  console.info(`[MeshGen] Starting index generation. Hull vertices: ${vertices.length / 3}`);

  let skippedInHull = 0;
  for (let i = 0; i < segmentsZ; i++) {
    for (let j = 0; j < segmentsRadial; j++) {
      const a = i * (segmentsRadial + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (segmentsRadial + 1) + j;
      const d = c + 1;

      const checkDegenerate = (idx1: number, idx2: number, idx3: number) => {
        const v1x = vertices[idx1 * 3]!,
          v1y = vertices[idx1 * 3 + 1]!,
          v1z = vertices[idx1 * 3 + 2]!;
        const v2x = vertices[idx2 * 3]!,
          v2y = vertices[idx2 * 3 + 1]!,
          v2z = vertices[idx2 * 3 + 2]!;
        const v3x = vertices[idx3 * 3]!,
          v3y = vertices[idx3 * 3 + 1]!,
          v3z = vertices[idx3 * 3 + 2]!;

        const isSame = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
          Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9 && Math.abs(az - bz) < 1e-9;

        if (isSame(v1x, v1y, v1z, v2x, v2y, v2z)) return true;
        if (isSame(v2x, v2y, v2z, v3x, v3y, v3z)) return true;
        if (isSame(v1x, v1y, v1z, v3x, v3y, v3z)) return true;
        return false;
      };

      if (!checkDegenerate(a, b, d)) {
        indices.push(a, b, d);
      } else {
        skippedInHull++;
      }

      if (!checkDegenerate(a, d, c)) {
        indices.push(a, d, c);
      } else {
        skippedInHull++;
      }
    }
  }

  if (skippedInHull > 0) {
    console.info(`[MeshGen] Skipped ${skippedInHull} degenerate triangles in hull (collapsed slices).`);
  }

  const addCap = (isNose: boolean) => {
    const z = isNose ? minZ : maxZ;
    const profile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, z);

    if (profile.halfWidth < 1e-3) {
      console.info(`[MeshGen] Skipping cap for ${isNose ? "Nose" : "Tail"} due to zero width.`);
      return;
    }

    const ringStart = (isNose ? 0 : segmentsZ) * (segmentsRadial + 1);
    const capStart = vertices.length / 3;

    for (let j = 0; j <= segmentsRadial; j++) {
      const idx = (ringStart + j) * 3;
      vertices.push(vertices[idx]!, vertices[idx + 1]!, vertices[idx + 2]!);
      uvs.push(uvs[(ringStart + j) * 2]!, uvs[(ringStart + j) * 2 + 1]!);
      colors.push(colors[(ringStart + j) * 3]!, colors[(ringStart + j) * 3 + 1]!, colors[(ringStart + j) * 3 + 2]!);
    }

    const centerIdx = vertices.length / 3;
    vertices.push(0, ((profile.topY + profile.botY) / 2) * scale, z * scale);
    uvs.push(0.5, isNose ? 0 : 1);
    colors.push(0, 0, 1);

    let skippedInCap = 0;
    for (let j = 0; j < segmentsRadial; j++) {
      const p1 = capStart + j;
      const p2 = p1 + 1;

      const v1x = vertices[p1 * 3]!,
        v1y = vertices[p1 * 3 + 1]!,
        v1z = vertices[p1 * 3 + 2]!;
      const v2x = vertices[p2 * 3]!,
        v2y = vertices[p2 * 3 + 1]!,
        v2z = vertices[p2 * 3 + 2]!;

      if (Math.abs(v1x - v2x) < 1e-9 && Math.abs(v1y - v2y) < 1e-9 && Math.abs(v1z - v2z) < 1e-9) {
        skippedInCap++;
        continue;
      }

      if (isNose) indices.push(centerIdx, p2, p1);
      else indices.push(centerIdx, p1, p2);
    }

    if (skippedInCap > 0) {
      console.info(`[MeshGen] Skipped ${skippedInCap} degenerate triangles in ${isNose ? "Nose" : "Tail"} cap.`);
    }
  };

  addCap(true);
  addCap(false);

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    volumeLiters: calculateVolume(vertices, indices),
  };
};
