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

const colorHeatmap = (normalizedValue: number):[number, number, number] => {
  // 0.0 (thin) -> Blue (Hue 240), 1.0 (thick) -> Red (Hue 0)
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

// --- BEZIER EVALUATION HELPERS ---

const evaluateBezier3D = (bezier: BezierCurveData, t: number): Point3D => {
  const numSegments = bezier.controlPoints.length - 1;
  if (numSegments <= 0) return bezier.controlPoints[0] || [0, 0, 0];
  const scaledT = t * numSegments;
  let segmentIdx = Math.floor(scaledT);
  if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
  const localT = scaledT - segmentIdx;
  
  const P0 = bezier.controlPoints[segmentIdx] || ([0, 0, 0] as Point3D);
  const P1 = bezier.controlPoints[segmentIdx + 1] || ([0, 0, 0] as Point3D);
  const T0 = bezier.tangents2[segmentIdx] || ([0, 0, 0] as Point3D);
  const T1 = bezier.tangents1[segmentIdx + 1] || ([0, 0, 0] as Point3D);
  
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
  const firstPt = bezier.controlPoints[0];
  const lastPt = bezier.controlPoints[bezier.controlPoints.length - 1];
  if (firstPt && Math.abs(targetZ - firstPt[2]) < 0.001) return [...firstPt];
  if (lastPt && Math.abs(targetZ - lastPt[2]) < 0.001) return [...lastPt];

  let t0 = 0; let t1 = 1;
  let p = evaluateBezier3D(bezier, 0.5);
  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = evaluateBezier3D(bezier, tMid);
    if (p[2] < targetZ) t0 = tMid;
    else t1 = tMid;
  }
  return p;
};

// --- UNIFIED ABSTRACTION API ---

export const getBoardProfileAtZ = (model: BoardModel, curves: BoardCurves, zInches: number) => {
  const widthPt = evaluateBezierAtZ(model.outline, zInches);
  const apexWidthPt = model.apexOutline ? evaluateBezierAtZ(model.apexOutline, zInches) : widthPt;
  const tuckWidthPt = model.railOutline ? evaluateBezierAtZ(model.railOutline, zInches) : widthPt;

  const topPt = evaluateBezierAtZ(model.rockerTop, zInches);
  const botPt = evaluateBezierAtZ(model.rockerBottom, zInches);

  const botPtForward = evaluateBezierAtZ(model.rockerBottom, zInches - 0.1);
  const botPtBackward = evaluateBezierAtZ(model.rockerBottom, zInches + 0.1);
  const dz = botPtBackward[2] - botPtForward[2];
  const dy = botPtBackward[1] - botPtForward[1];
  const rockerTangentAngle = Math.abs(dz) > 0.0001 ? Math.atan2(dy, dz) : 0;

  let apexY = botPt[1] + (topPt[1] - botPt[1]) * 0.3; 
  if (model.apexRocker) {
    const apexPt = evaluateBezierAtZ(model.apexRocker, zInches);
    apexY = apexPt[1];
  }

  return { 
      topY: topPt[1], 
      botY: botPt[1], 
      apexY, 
      halfWidth: widthPt[0],
      apexHalfWidth: apexWidthPt[0],
      tuckHalfWidth: tuckWidthPt[0],
      rockerTangentAngle
  };
};

export const getCrossSectionBlendAtZ = (crossSections: BezierCurveData[], zInches: number) => {
  if (crossSections.length === 0) return null;
  const minZ = crossSections[0]!.controlPoints[0]![2];
  const maxZ = crossSections[crossSections.length - 1]!.controlPoints[0]![2];
  let k0 = 0;
  let lerpFactor = 0;

  if (zInches <= minZ) {
    k0 = 0;
    lerpFactor = 0;
  } else if (zInches >= maxZ) {
    k0 = crossSections.length - 1;
    lerpFactor = 0;
  } else {
    for (let k = 0; k < crossSections.length - 1; k++) {
      const z0 = crossSections[k]!.controlPoints[0]![2];
      const z1 = crossSections[k + 1]!.controlPoints[0]![2];
      if (zInches >= z0 && zInches <= z1) {
        k0 = k;
        lerpFactor = Math.abs(z1 - z0) < 0.0001 ? 0 : (zInches - z0) / (z1 - z0);
        break;
      }
    }
  }

  const sM1 = crossSections[Math.max(0, k0 - 1)]!;
  const s0 = crossSections[k0]!;
  const s1 = crossSections[Math.min(crossSections.length - 1, k0 + 1)]!;
  const s2 = crossSections[Math.min(crossSections.length - 1, k0 + 2)]!;

  const getSliceY = (s: BezierCurveData, isTop: boolean) => isTop ? Math.max(...s.controlPoints.map(pt => pt[1])) : Math.min(...s.controlPoints.map(pt => pt[1]));
  
  const topY = cubicInterpolate(getSliceY(sM1, true), getSliceY(s0, true), getSliceY(s1, true), getSliceY(s2, true), lerpFactor);
  const botY = cubicInterpolate(getSliceY(sM1, false), getSliceY(s0, false), getSliceY(s1, false), getSliceY(s2, false), lerpFactor);
  const apexWidth = cubicInterpolate(sM1.controlPoints[2]?.[0] ?? 0, s0.controlPoints[2]?.[0] ?? 0, s1.controlPoints[2]?.[0] ?? 0, s2.controlPoints[2]?.[0] ?? 0, lerpFactor);
  const tuckWidth = cubicInterpolate(sM1.controlPoints[1]?.[0] ?? 0, s0.controlPoints[1]?.[0] ?? 0, s1.controlPoints[1]?.[0] ?? 0, s2.controlPoints[1]?.[0] ?? 0, lerpFactor);

  return {
    sM1, s0, s1, s2, lerpFactor,
    topY, botY, apexWidth, tuckWidth,
    evaluate: (tMid: number) => {
      const pM1 = evaluateBezier3D(sM1, tMid);
      const pA = evaluateBezier3D(s0, tMid);
      const pB = evaluateBezier3D(s1, tMid);
      const pP2 = evaluateBezier3D(s2, tMid);
      return cubicInterpolatePt(pM1, pA, pB, pP2, lerpFactor);
    }
  };
};

export const getBottomYAt = (model: BoardModel, curves: BoardCurves, xInches: number, zInches: number) => {
  const crossSections = model.crossSections ||[];
  const profile = getBoardProfileAtZ(model, curves, zInches);
  if (crossSections.length === 0 || profile.halfWidth <= 0.001) return profile.botY;
  
  const minZ = model.outline.controlPoints[0]![2];
  const maxZ = model.outline.controlPoints[model.outline.controlPoints.length - 1]![2];
  const blend = getCrossSectionBlendAtZ(crossSections, zInches);
  if (!blend) return profile.botY;

  let t0 = 0; let t1 = 0.5; // Bottom half of cross-section
  let p =[0,0,0] as Point3D;
  const targetX = Math.abs(xInches);
  
  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = blend.evaluate(tMid);
    
    let scaledX = p[0];
    if (blend.apexWidth > 1e-6) {
      if (tMid <= 0.25) {
         if (blend.tuckWidth > 1e-6) {
           scaledX = p[0] * (profile.tuckHalfWidth / blend.tuckWidth);
         }
      } else if (tMid <= 0.5) {
         if (blend.apexWidth > blend.tuckWidth) {
            const tX = (p[0] - blend.tuckWidth) / (blend.apexWidth - blend.tuckWidth);
            const clampedTx = Math.max(0, Math.min(1, tX));
            scaledX = profile.tuckHalfWidth + clampedTx * (profile.apexHalfWidth - profile.tuckHalfWidth);
         } else {
            scaledX = profile.apexHalfWidth;
         }
      } else {
         scaledX = p[0] * (profile.apexHalfWidth / blend.apexWidth);
      }
    }

    if (scaledX < targetX) t0 = tMid;
    else t1 = tMid;
  }
  
  const sliceThickness = blend.topY - blend.botY;
  const currentThickness = profile.topY - profile.botY;
  
  if (Math.abs(sliceThickness) > 1e-6) {
    const normY = (p[1] - blend.botY) / sliceThickness;
    const cosAngle = Math.cos(profile.rockerTangentAngle);
    const scaleFactor = cosAngle > 0.1 ? (1 / cosAngle) : 1;
    const depthScale = 1 + (scaleFactor - 1) * (1 - normY);
    
    return profile.botY + (normY * currentThickness) * depthScale;
  }
  
  return profile.botY;
};

// --- GENERATOR ORCHESTRATOR ---

export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, _curves: BoardCurves): RawGeometryData => {
    return generateMesh(model);
  },
  getBoardProfileAtZ,
  getBottomYAt
};

const calculateVolume = (vertices: number[], indices: number[]): number => {
  let volumeCubicFeet = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const iA = indices[i]! * 3;
    const iB = indices[i+1]! * 3;
    const iC = indices[i+2]! * 3;
    const p1x = vertices[iA]!, p1y = vertices[iA+1]!, p1z = vertices[iA+2]!;
    const p2x = vertices[iB]!, p2y = vertices[iB+1]!, p2z = vertices[iB+2]!;
    const p3x = vertices[iC]!, p3y = vertices[iC+1]!, p3z = vertices[iC+2]!;
    const cx = p2y * p3z - p2z * p3y;
    const cy = p2z * p3x - p2x * p3z;
    const cz = p2x * p3y - p2y * p3x;
    volumeCubicFeet += (p1x * cx + p1y * cy + p1z * cz) / 6.0;
  }
  return Math.abs(volumeCubicFeet) * 1728 * 0.0163871;
};

// --- GENERATION ROUTINES ---

const generateMesh = (model: BoardModel): RawGeometryData => {
  const segmentsZ = 150;
  const segmentsRadial = 36;
  const vertices: number[] = [];
  const indices: number[] =[];
  const uvs: number[] =[];
  const colors: number[] =[];
  const scale = 1 / 12;

  const outline = model.outline;
  const crossSections = model.crossSections ||[];
  if (!outline || outline.controlPoints.length === 0) {
    return { vertices: new Float32Array(), indices: new Uint32Array(), uvs: new Float32Array(), colors: new Float32Array(), volumeLiters: 0 };
  }

  const minZ = outline.controlPoints[0]![2];
  const maxZ = outline.controlPoints[outline.controlPoints.length - 1]![2];
  const totalZ = maxZ - minZ;

  const tipBlendZone = 2.0; // Blend into mathematically continuous points within 2 inches of tip

  for (let i = 0; i < segmentsZ; i++) {
    const nz = i / (segmentsZ - 1);
    const zInches = minZ + nz * totalZ;

    const profile = getBoardProfileAtZ(model, { outline:[], rockerTop:[], rockerBottom:[] }, zInches);
    const { topY, botY } = profile;

    const distToNose = Math.max(0, zInches - minZ);
    const distToTail = Math.max(0, maxZ - zInches);
    let tipBlend = 1.0;
    if (distToNose < tipBlendZone) {
      const t = distToNose / tipBlendZone;
      tipBlend = t * t * (3 - 2 * t); // C2 continuous easing
    } else if (distToTail < tipBlendZone) {
      const t = distToTail / tipBlendZone;
      tipBlend = t * t * (3 - 2 * t);
    }

    const isTip = i === 0 || i === segmentsZ - 1;
    const blend = getCrossSectionBlendAtZ(crossSections, zInches);
    
    for (let j = 0; j <= segmentsRadial; j++) {
      let tCross = 0.5;
      let isRightSide = true;
      if (j <= 9) tCross = 0.5 + 0.5 * (j / 9);
      else if (j <= 18) { tCross = 1.0 - 0.5 * ((j - 9) / 9); isRightSide = false; }
      else if (j <= 27) { tCross = 0.5 - 0.5 * ((j - 18) / 9); isRightSide = false; }
      else tCross = 0.5 * ((j - 27) / 9);

      if (!blend || isTip) {
        const py = botY + (topY - botY) / 2;
        vertices.push(0, py * scale, zInches * scale);
        uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
        colors.push(0, 0, 1);
        continue;
      }

      const p = blend.evaluate(tCross);
      const rawX = p[0];
      const rawY = p[1];

      const sliceApexWidth = blend.apexWidth;
      const sliceTuckWidth = blend.tuckWidth;

      let mappedX = rawX;
      if (sliceApexWidth > 1e-6) {
        if (tCross <= 0.25 || tCross >= 0.75) {
          if (sliceTuckWidth > 1e-6) {
            mappedX = rawX * (profile.tuckHalfWidth / sliceTuckWidth);
          }
        } else {
          if (sliceApexWidth > sliceTuckWidth) {
            const tX = (rawX - sliceTuckWidth) / (sliceApexWidth - sliceTuckWidth);
            const clampedTx = Math.max(0, Math.min(1, tX));
            mappedX = profile.tuckHalfWidth + clampedTx * (profile.apexHalfWidth - profile.tuckHalfWidth);
          } else {
            mappedX = profile.apexHalfWidth;
          }
        }
      }
      
      mappedX *= tipBlend;
      const px = (isRightSide ? 1 : -1) * mappedX;

      const sliceTop = blend.topY;
      const sliceBot = blend.botY;
      const sliceThickness = sliceTop - sliceBot;
      const currentThickness = topY - botY;

      let py = botY + currentThickness / 2;
      const cosAngle = Math.cos(profile.rockerTangentAngle);
      const scaleFactor = cosAngle > 0.1 ? (1 / cosAngle) : 1;

      if (Math.abs(sliceThickness) > 1e-6) {
          const normY = (rawY - sliceBot) / sliceThickness;
          const depthScale = 1 + (scaleFactor - 1) * (1 - normY);
          py = botY + (normY * currentThickness) * depthScale;
      }
      
      // Smoothly blend Y coordinate to center of board at absolute tips to prevent creases
      const centerY = botY + currentThickness / 2;
      py = centerY + (py - centerY) * tipBlend;

      const tOpposite = 1.0 - tCross;
      const pOpp = blend.evaluate(tOpposite);
      const rawYOpp = pOpp[1];

      let pyOpp = botY + currentThickness / 2;
      if (Math.abs(sliceThickness) > 1e-6) {
          const normYOpp = (rawYOpp - sliceBot) / sliceThickness;
          const depthScaleOpp = 1 + (scaleFactor - 1) * (1 - normYOpp);
          pyOpp = botY + (normYOpp * currentThickness) * depthScaleOpp;
      }
      pyOpp = centerY + (pyOpp - centerY) * tipBlend;

      const localThickness = Math.abs(py - pyOpp);
      const normT = Math.max(0, Math.min(1, localThickness / model.thickness));
      const [r, g, b] = colorHeatmap(normT);

      vertices.push(px * scale, py * scale, zInches * scale);
      uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
      colors.push(r, g, b);
    }
  }

  for (let i = 0; i < segmentsZ - 1; i++) {
    for (let j = 0; j < segmentsRadial; j++) {
      const a = i * (segmentsRadial + 1) + j;
      const b = i * (segmentsRadial + 1) + (j + 1);
      const c = (i + 1) * (segmentsRadial + 1) + j;
      const d = (i + 1) * (segmentsRadial + 1) + (j + 1);
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    volumeLiters: calculateVolume(vertices, indices)
  };
};
