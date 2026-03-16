import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";

export interface RawGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  volumeLiters: number;
}

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

// --- PARAMETRIC HELPERS ---

export const getParametricOutlineWidth = (zInches: number, curves: BoardCurves) => {
  if (!curves.outline.length) return 0;
  for (let i = 0; i < curves.outline.length - 1; i++) {
    const p1 = curves.outline[i]!;
    const p2 = curves.outline[i + 1]!;
    if (zInches >= p1[2] && zInches <= p2[2]) {
      if (p2[2] === p1[2]) return Math.max(p1[0], p2[0]);
      const t = (zInches - p1[2]) / (p2[2] - p1[2]);
      return p1[0] + t * (p2[0] - p1[0]);
    }
  }
  return 0;
};

export const getParametricRockerY = (zInches: number, isTop: boolean, curves: BoardCurves) => {
  const pts = isTop ? curves.rockerTop : curves.rockerBottom;
  if (!pts.length) return 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    if (zInches >= p1[2] && zInches <= p2[2]) {
      const tCurve = (zInches - p1[2]) / (p2[2] - p1[2]);
      return p1[1] + tCurve * (p2[1] - p1[1]);
    }
  }
  return zInches <= pts[0]![2] ? pts[0]![1] : pts[pts.length - 1]![1];
};

export const getParametricApexRatio = (zInches: number, maxZ: number, apexRatio: number, hardEdgeLength: number) => {
  const distFromTail = Math.max(0, maxZ - zInches);
  let currentApex = apexRatio;
  if (distFromTail < hardEdgeLength) {
    const blendZone = 6.0;
    const blendEnd = Math.max(0, hardEdgeLength - blendZone);
    if (distFromTail <= blendEnd) {
      currentApex = 0.02;
    } else {
      const t = (distFromTail - blendEnd) / blendZone;
      currentApex = 0.02 + t * (apexRatio - 0.02);
    }
  }
  return currentApex;
};

// --- UNIFIED ABSTRACTION API ---

export const getBoardProfileAtZ = (model: BoardModel, curves: BoardCurves, zInches: number) => {
  if (model.editMode === "manual" && model.manualOutline && model.manualRockerTop && model.manualRockerBottom) {
    const widthPt = evaluateBezierAtZ(model.manualOutline, zInches);
    const topPt = evaluateBezierAtZ(model.manualRockerTop, zInches);
    const botPt = evaluateBezierAtZ(model.manualRockerBottom, zInches);
    const thickness = Math.max(0, topPt[1] - botPt[1]);
    const maxZ = model.manualOutline.controlPoints[model.manualOutline.controlPoints.length - 1]![2];
    const apexRatio = getParametricApexRatio(zInches, maxZ, model.apexRatio, model.hardEdgeLength);
    return { topY: topPt[1], botY: botPt[1], apexY: botPt[1] + thickness * apexRatio, halfWidth: widthPt[0] };
  }
  
  const topY = getParametricRockerY(zInches, true, curves);
  const botY = getParametricRockerY(zInches, false, curves);
  const halfWidth = getParametricOutlineWidth(zInches, curves);
  const thickness = Math.max(0, topY - botY);
  const maxZ = curves.outline.length > 0 ? curves.outline[curves.outline.length - 1]![2] : 0;
  const apexRatio = getParametricApexRatio(zInches, maxZ, model.apexRatio, model.hardEdgeLength);
  return { topY, botY, apexY: botY + thickness * apexRatio, halfWidth };
};

export const calculateBottomContourOffset = (model: BoardModel, nz: number, tailDist: number, nx: number, widthFade: number) => {
  const smoothStep = (edge0: number, edge1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  const blendVee = 1 - smoothStep(0.05, 0.4, nz);
  const blendConcave = smoothStep(0.15, 0.3, nz);
  let blendChannels = 0;
  if (tailDist <= model.channelLength + 6.0) {
    blendChannels = 1.0 - smoothStep(model.channelLength, model.channelLength + 6.0, tailDist);
  }

  let contourOffset = 0;
  if (model.bottomContour === "vee_to_quad_channels") {
    const veeOffset = -model.veeDepth * (1 - nx) * blendVee;
    const concaveOffset = model.concaveDepth * (1 - nx * nx) * blendConcave;
    let channelProfile = 0;
    if (nx >= 0.2 && nx <= 0.8) {
      const u = (nx - 0.2) / 0.6;
      channelProfile = Math.pow(Math.sin(u * Math.PI * 2), 2);
    }
    const channelOffset = model.channelDepth * channelProfile * blendChannels;
    contourOffset = (veeOffset + concaveOffset + channelOffset) * widthFade;
  } else if (model.bottomContour === "single_to_double") {
    const single = model.concaveDepth * (1 - nx * nx);
    const double = model.concaveDepth * 0.8 * Math.pow(Math.sin(nx * Math.PI), 2);
    contourOffset = (single * (1 - nz) + double * nz) * widthFade;
  } else if (model.bottomContour === "single") {
    contourOffset = model.concaveDepth * (1 - nx * nx) * widthFade;
  }
  return contourOffset;
};

export const getBottomYAt = (model: BoardModel, curves: BoardCurves, xInches: number, zInches: number) => {
  const profile = getBoardProfileAtZ(model, curves, zInches);
  const { topY, botY, apexY, halfWidth } = profile;
  if (halfWidth <= 0.001) return botY;

  let nx = Math.abs(xInches) / halfWidth;
  if (nx > 1) nx = 1;

  const maxZ = model.editMode === "manual" && model.manualOutline ? 
    model.manualOutline.controlPoints[model.manualOutline.controlPoints.length - 1]![2] : 
    curves.outline[curves.outline.length - 1]![2];
  const minZ = model.editMode === "manual" && model.manualOutline ? 
    model.manualOutline.controlPoints[0]![2] : curves.outline[0]![2];
  const totalZ = maxZ - minZ;
  const nz = (zInches - minZ) / totalZ;
  const tailDist = Math.max(0, maxZ - zInches);
  const noseDist = Math.max(0, zInches - minZ);

  let railExp = 1.5 - model.railFullness;
  let deckExp = model.deckDome;
  const relaxZone = 2.0;
  if (noseDist < relaxZone) {
    const t = noseDist / relaxZone;
    railExp = 1.0 - t * (1.0 - railExp);
    deckExp = 1.0 - t * (1.0 - deckExp);
  } else if (tailDist < relaxZone) {
    const t = tailDist / relaxZone;
    railExp = 1.0 - t * (1.0 - railExp);
    deckExp = 1.0 - t * (1.0 - deckExp);
  }

  const abs_cx = Math.pow(nx, 1 / railExp);
  const clamped_cx = Math.min(1, abs_cx);
  const abs_cy = Math.sqrt(1 - clamped_cx * clamped_cx);
  const pyTop = apexY + Math.pow(abs_cy, deckExp) * (topY - apexY);
  let py = apexY - Math.pow(abs_cy, 0.5) * (apexY - botY);

  const widthFade = Math.max(0, Math.min(1.0, halfWidth / 1.0));
  let contourOffset = calculateBottomContourOffset(model, nz, tailDist, nx, widthFade);
  contourOffset *= abs_cy; // fade to 0 at rail
  py += contourOffset;

  const MIN_CORE_THICKNESS = 0.05;
  if (py > pyTop - MIN_CORE_THICKNESS) {
    py = pyTop - MIN_CORE_THICKNESS;
  }
  return py;
};

// --- GENERATOR ORCHESTRATOR ---

export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, curves: BoardCurves): RawGeometryData => {
    if (model.editMode === "manual" && model.manualOutline) {
      return generateManualMesh(model);
    }
    return generateParametricMesh(model, curves);
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

const generateParametricMesh = (model: BoardModel, curves: BoardCurves): RawGeometryData => {
  const segmentsZ = curves.outline.length;
  const segmentsRadial = 36;
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const scale = 1 / 12;

  const deckCurve = model.deckDome;
  const bottomCurve = 0.5;
  const minZ = curves.outline[0]![2];
  const maxZ = curves.outline[segmentsZ - 1]![2];
  const totalZ = maxZ - minZ;

  for (let i = 0; i < segmentsZ; i++) {
    const p = curves.outline[i]!;
    const halfWidth = p[0];
    const zInches = p[2];
    const nz = (zInches - minZ) / totalZ;
    const tailDist = Math.max(0, maxZ - zInches);
    const noseDist = Math.max(0, zInches - minZ);

    const targetRailExp = 1.5 - model.railFullness;
    let railExp = targetRailExp;
    let deckExp = deckCurve;
    const relaxZone = 2.0;
    if (noseDist < relaxZone) {
      const t = noseDist / relaxZone;
      railExp = 1.0 - t * (1.0 - targetRailExp);
      deckExp = 1.0 - t * (1.0 - deckCurve);
    } else if (tailDist < relaxZone) {
      const t = tailDist / relaxZone;
      railExp = 1.0 - t * (1.0 - targetRailExp);
      deckExp = 1.0 - t * (1.0 - deckCurve);
    }

    const topY = getParametricRockerY(zInches, true, curves);
    const botY = getParametricRockerY(zInches, false, curves);
    const thickness = Math.max(0, topY - botY);
    const apexY = botY + thickness * getParametricApexRatio(zInches, maxZ, model.apexRatio, model.hardEdgeLength);
    const widthFade = Math.max(0, Math.min(1.0, halfWidth / 1.0));

    for (let j = 0; j <= segmentsRadial; j++) {
      const angle = (j / segmentsRadial) * Math.PI * 2;
      const cx = Math.cos(angle);
      const cy = Math.sin(angle);
      const abs_cx = Math.abs(cx);
      const abs_cy = Math.abs(cy);
      const signX = cx < 0 ? -1 : 1;

      const px = signX * Math.pow(abs_cx, railExp) * halfWidth;
      const pyTop = apexY + Math.pow(abs_cy, deckExp) * (topY - apexY);
      let py = 0;

      if (cy >= 0) {
        py = pyTop;
      } else {
        py = apexY - Math.pow(abs_cy, bottomCurve) * (apexY - botY);
        if (halfWidth > 0.001) {
          const nx = px / halfWidth;
          let contourOffset = calculateBottomContourOffset(model, nz, tailDist, Math.abs(nx), widthFade);
          contourOffset *= abs_cy;
          py += contourOffset;
        }
        if (py > pyTop - 0.05) py = pyTop - 0.05;
      }

      vertices.push(px * scale, py * scale, zInches * scale);
      uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
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
    volumeLiters: calculateVolume(vertices, indices)
  };
};

const generateManualMesh = (model: BoardModel): RawGeometryData => {
  const segmentsZ = 150;
  const segmentsRadial = 36;
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const scale = 1 / 12;

  const outline = model.manualOutline!;
  const crossSections = model.manualCrossSections || [];
  const minZ = outline.controlPoints[0]![2];
  const maxZ = outline.controlPoints[outline.controlPoints.length - 1]![2];
  const totalZ = maxZ - minZ;

  for (let i = 0; i < segmentsZ; i++) {
    const nz = i / (segmentsZ - 1);
    const zInches = minZ + nz * totalZ;
    const tailDist = Math.max(0, maxZ - zInches);

    const profile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, zInches);
    const { topY, botY, halfWidth } = profile;
    const widthFade = Math.max(0, Math.min(1.0, halfWidth / 1.0));

    let s0 = crossSections[0]!;
    let s1 = crossSections[crossSections.length - 1]!;
    let lerpFactor = 0;
    for (let k = 0; k < crossSections.length - 1; k++) {
      const z0 = crossSections[k]!.controlPoints[0]![2];
      const z1 = crossSections[k + 1]!.controlPoints[0]![2];
      if (zInches >= z0 && zInches <= z1) {
        s0 = crossSections[k]!;
        s1 = crossSections[k + 1]!;
        lerpFactor = (zInches - z0) / (z1 - z0);
        break;
      }
    }

    for (let j = 0; j <= segmentsRadial; j++) {
      // Map topology to match parametric (j=0 is Right Apex, j=9 is Deck Stringer, j=27 is Bottom Stringer)
      let tCross = 0.5;
      let isRightSide = true;
      if (j <= 9) { tCross = 0.5 + 0.5 * (j / 9); }
      else if (j <= 18) { tCross = 1.0 - 0.5 * ((j - 9) / 9); isRightSide = false; }
      else if (j <= 27) { tCross = 0.5 - 0.5 * ((j - 18) / 9); isRightSide = false; }
      else { tCross = 0.5 * ((j - 27) / 9); }

      const pA = evaluateBezier3D(s0, tCross);
      const pB = evaluateBezier3D(s1, tCross);
      const rawX = pA[0] + (pB[0] - pA[0]) * lerpFactor;
      const rawY = pA[1] + (pB[1] - pA[1]) * lerpFactor;

      const sliceWidth = (s0.controlPoints[2]![0] + (s1.controlPoints[2]![0] - s0.controlPoints[2]![0]) * lerpFactor) || 1;
      const sliceTop = s0.controlPoints[4]![1] + (s1.controlPoints[4]![1] - s0.controlPoints[4]![1]) * lerpFactor;
      const sliceBot = s0.controlPoints[0]![1] + (s1.controlPoints[0]![1] - s0.controlPoints[0]![1]) * lerpFactor;

      const normX = rawX / sliceWidth;
      const normY = (rawY - sliceBot) / (sliceTop - sliceBot || 1);

      const px = (isRightSide ? 1 : -1) * normX * halfWidth;
      let py = botY + normY * (topY - botY);

      // Step 5: Graceful Contour Compositing on bottom surface
      if (j > 18 && j < 36 && halfWidth > 0.001) {
        const nx = Math.abs(px / halfWidth);
        let contourOffset = calculateBottomContourOffset(model, nz, tailDist, nx, widthFade);
        const angle = (j / segmentsRadial) * Math.PI * 2;
        contourOffset *= Math.abs(Math.sin(angle));
        py += contourOffset;
      }

      vertices.push(px * scale, py * scale, zInches * scale);
      uvs.push(j / segmentsRadial, i / (segmentsZ - 1));
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
    volumeLiters: calculateVolume(vertices, indices)
  };
};
