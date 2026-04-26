import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";

export interface RawGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
  volumeLiters: number;
}

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
  return [hue2rgb(0, 1, h + 1 / 3), hue2rgb(0, 1, h), hue2rgb(0, 1, h - 1 / 3)];
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

// --- PARAMETRIC HELPERS ---

// --- UNIFIED ABSTRACTION API ---

export const getBoardProfileAtZ = (model: BoardModel, curves: BoardCurves, zInches: number) => {
  const widthPt = evaluateBezierAtZ(model.outline, zInches);
  const apexWidthPt = model.apexOutline ? evaluateBezierAtZ(model.apexOutline, zInches) : widthPt;

  const topPt = evaluateBezierAtZ(model.rockerTop, zInches);
  const botPt = evaluateBezierAtZ(model.rockerBottom, zInches);

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
      apexHalfWidth: apexWidthPt[0]
  };
};

export const getBottomYAt = (model: BoardModel, curves: BoardCurves, xInches: number, zInches: number) => {
  const crossSections = model.crossSections ||[];
  const profile = getBoardProfileAtZ(model, curves, zInches);
  if (crossSections.length === 0 || profile.halfWidth <= 0.001) return profile.botY;
  
  const minZ = model.outline.controlPoints[0]![2];
  const maxZ = model.outline.controlPoints[model.outline.controlPoints.length - 1]![2];
  let s0 = crossSections[0]!;
  let s1 = crossSections[crossSections.length - 1]!;
  let lerpFactor = 0;

  const firstZ = crossSections[0]?.controlPoints[0]?.[2] ?? minZ;
  const lastZ = crossSections[crossSections.length - 1]?.controlPoints[0]?.[2] ?? maxZ;

  if (zInches <= firstZ) {
    s0 = crossSections[0]!;
    s1 = crossSections[0]!;
    lerpFactor = 0;
  } else if (zInches >= lastZ) {
    s0 = crossSections[crossSections.length - 1]!;
    s1 = crossSections[crossSections.length - 1]!;
    lerpFactor = 0;
  } else {
    for (let k = 0; k < crossSections.length - 1; k++) {
      const z0 = crossSections[k]!.controlPoints[0]![2];
      const z1 = crossSections[k + 1]!.controlPoints[0]![2];
      if (zInches >= z0 && zInches <= z1) {
        s0 = crossSections[k]!;
        s1 = crossSections[k + 1]!;
        lerpFactor = Math.abs(z1 - z0) < 0.0001 ? 0 : (zInches - z0) / (z1 - z0);
        break;
      }
    }
  }

  let t0 = 0; let t1 = 0.5; // Bottom half of cross-section
  let p =[0,0,0];
  const targetX = Math.abs(xInches);
  
  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    const pA = evaluateBezier3D(s0, tMid);
    const pB = evaluateBezier3D(s1, tMid);
    p =[
      pA[0] + (pB[0] - pA[0]) * lerpFactor,
      pA[1] + (pB[1] - pA[1]) * lerpFactor,
      pA[2] + (pB[2] - pA[2]) * lerpFactor
    ];
    
    const s0_apex_w = s0.controlPoints[2]![0];
    const s1_apex_w = s1.controlPoints[2]![0];
    const sliceApexWidth = s0_apex_w + (s1_apex_w - s0_apex_w) * lerpFactor;
    
    const scaleFactor = Math.abs(sliceApexWidth) > 1e-6 ? profile.apexHalfWidth / sliceApexWidth : 0;
    const scaledX = p[0] * scaleFactor;

    if (scaledX < targetX) t0 = tMid;
    else t1 = tMid;
  }
  
  const s0Top = Math.max(...s0.controlPoints.map(pt => pt[1]));
  const s1Top = Math.max(...s1.controlPoints.map(pt => pt[1]));
  const sliceTop = s0Top + (s1Top - s0Top) * lerpFactor;
  const s0Bot = Math.min(...s0.controlPoints.map(pt => pt[1]));
  const s1Bot = Math.min(...s1.controlPoints.map(pt => pt[1]));
  const sliceBot = s0Bot + (s1Bot - s0Bot) * lerpFactor;
  const sliceThickness = sliceTop - sliceBot;
  
  const currentThickness = profile.topY - profile.botY;
  
  if (Math.abs(sliceThickness) > 1e-6) {
    const normY = (p[1] - sliceBot) / sliceThickness;
    return profile.botY + normY * currentThickness;
  }
  
  return profile.botY;
};

// --- GENERATOR ORCHESTRATOR ---

export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, curves: BoardCurves): RawGeometryData => {
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

const generateParametricMesh = (model: BoardModel, curves: BoardCurves): RawGeometryData => {
  const segmentsZ = curves.outline.length;
  const segmentsRadial = 36;
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] =[];
  const colors: number[] =[];
  const scale = 1 / 12;

  const deckCurve = (model as any).deckDome || 0.65;
  const bottomCurve = 0.5;
  const minZ = curves.outline[0]![2];
  const maxZ = curves.outline[segmentsZ - 1]![2];
  const totalZ = maxZ - minZ;

  const buildEndCap = (isNose: boolean, ringIndex: number, _zInches: number, _topY: number, _botY: number) => {
    const originalRingStart = ringIndex * (segmentsRadial + 1);
    const newRingStart = vertices.length / 3;
    for (let j = 0; j <= segmentsRadial; j++) {
      const origV = originalRingStart + j;
      vertices.push(vertices[origV * 3]!, vertices[origV * 3 + 1]!, vertices[origV * 3 + 2]!);
      uvs.push(uvs[origV * 2]!, uvs[origV * 2 + 1]!);
      colors.push(colors[origV * 3]!, colors[origV * 3 + 1]!, colors[origV * 3 + 2]!);
    }

    const fanCenterIdx = newRingStart + 27; 
    for (let j = 0; j < segmentsRadial; j++) {
      const p1 = newRingStart + j;
      const p2 = newRingStart + j + 1;
      if (isNose) indices.push(fanCenterIdx, p1, p2);
      else indices.push(fanCenterIdx, p2, p1);
    }
  };

  for (let i = 0; i < segmentsZ; i++) {
    const p = curves.outline[i]!;
    const halfWidth = p[0];
    const zInches = p[2];
    const nz = (zInches - minZ) / totalZ;
    const tailDist = Math.max(0, maxZ - zInches);
    const noseDist = Math.max(0, zInches - minZ);

    const targetRailExp = 1.5 - ((model as any).railFullness || 0.65);
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
    const apexY = botY + thickness * getParametricApexRatio(zInches, maxZ, (model as any).apexRatio || 0.3, (model as any).hardEdgeLength || 18.0);
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
      
      let pyBot = apexY - Math.pow(abs_cy, bottomCurve) * (apexY - botY);
      if (halfWidth > 0.001) {
        const nx = px / halfWidth;
        let contourOffset = calculateBottomContourOffset(model, nz, tailDist, Math.abs(nx), widthFade);
        contourOffset *= abs_cy;
        pyBot += contourOffset;
      }
      if (pyBot > pyTop - 0.05) pyBot = pyTop - 0.05;

      const py = cy >= 0 ? pyTop : pyBot;

      const localThickness = Math.max(0, pyTop - pyBot);
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

  const noseWidth = getParametricOutlineWidth(minZ, curves);
  if (noseWidth < 0.1) {
    const noseTopY = getParametricRockerY(minZ, true, curves);
    const noseBotY = getParametricRockerY(minZ, false, curves);
    const centerY = ((noseTopY + noseBotY) / 2) * scale;
    for (let j = 0; j <= segmentsRadial; j++) {
      const idx = j * 3;
      vertices[idx] = 0;
      vertices[idx + 1] = centerY;
    }
  } else {
    buildEndCap(true, 0, minZ, getParametricRockerY(minZ, true, curves), getParametricRockerY(minZ, false, curves));
  }

  const tailWidth = getParametricOutlineWidth(maxZ, curves);
  if (tailWidth < 0.1) {
    const tailTopY = getParametricRockerY(maxZ, true, curves);
    const tailBotY = getParametricRockerY(maxZ, false, curves);
    const centerY = ((tailTopY + tailBotY) / 2) * scale;
    const ringIndex = segmentsZ - 1;
    for (let j = 0; j <= segmentsRadial; j++) {
      const idx = (ringIndex * (segmentsRadial + 1) + j) * 3;
      vertices[idx] = 0;
      vertices[idx + 1] = centerY;
    }
  } else {
    buildEndCap(false, segmentsZ - 1, maxZ, getParametricRockerY(maxZ, true, curves), getParametricRockerY(maxZ, false, curves));
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    volumeLiters: calculateVolume(vertices, indices)
  };
};

const generateManualMesh = (model: BoardModel): RawGeometryData => {
  const segmentsZ = 150;
  const segmentsRadial = 36;
  const vertices: number[] = [];
  const indices: number[] =[];
  const uvs: number[] = [];
  const colors: number[] =[];
  const scale = 1 / 12;

  const outline = model.outline;
  const crossSections = model.crossSections || [];
  const minZ = outline.controlPoints[0]![2];
  const maxZ = outline.controlPoints[outline.controlPoints.length - 1]![2];
  const totalZ = maxZ - minZ;

  const buildEndCap = (isNose: boolean, ringIndex: number, _zInches: number, _topY: number, _botY: number) => {
    const originalRingStart = ringIndex * (segmentsRadial + 1);
    const newRingStart = vertices.length / 3;
    for (let j = 0; j <= segmentsRadial; j++) {
      const origV = originalRingStart + j;
      vertices.push(vertices[origV * 3]!, vertices[origV * 3 + 1]!, vertices[origV * 3 + 2]!);
      uvs.push(uvs[origV * 2]!, uvs[origV * 2 + 1]!);
      colors.push(colors[origV * 3]!, colors[origV * 3 + 1]!, colors[origV * 3 + 2]!);
    }

    const fanCenterIdx = newRingStart + 27; 
    for (let j = 0; j < segmentsRadial; j++) {
      const p1 = newRingStart + j;
      const p2 = newRingStart + j + 1;
      if (isNose) indices.push(fanCenterIdx, p1, p2);
      else indices.push(fanCenterIdx, p2, p1);
    }
  };

  for (let i = 0; i < segmentsZ; i++) {
    const nz = i / (segmentsZ - 1);
    const zInches = minZ + nz * totalZ;

    const profile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, zInches);
    const { topY, botY, halfWidth } = profile;

    const noseDist = zInches - minZ;
    const tailDist = maxZ - zInches;
    const relaxZone = 2.0; 
    let relaxFactor = 0;
    if (noseDist < relaxZone && relaxZone > 0) {
      relaxFactor = 1.0 - noseDist / relaxZone;
    } else if (tailDist < relaxZone && relaxZone > 0) {
      relaxFactor = 1.0 - tailDist / relaxZone;
    }

    let s0 = crossSections[0]! || { controlPoints: [] };
    let s1 = crossSections[crossSections.length - 1]! || { controlPoints: [] };
    let lerpFactor = 0;

    const firstZ = crossSections[0]?.controlPoints[0]?.[2] ?? minZ;
    const lastZ = crossSections[crossSections.length - 1]?.controlPoints[0]?.[2] ?? maxZ;

    if (zInches <= firstZ) {
      s0 = crossSections[0]!;
      s1 = crossSections[0]!;
      lerpFactor = 0;
    } else if (zInches >= lastZ) {
      s0 = crossSections[crossSections.length - 1]!;
      s1 = crossSections[crossSections.length - 1]!;
      lerpFactor = 0;
    } else {
      for (let k = 0; k < crossSections.length - 1; k++) {
        const z0 = crossSections[k]!.controlPoints[0]![2];
        const z1 = crossSections[k + 1]!.controlPoints[0]![2];
        if (zInches >= z0 && zInches <= z1) {
          s0 = crossSections[k]!;
          s1 = crossSections[k + 1]!;
          lerpFactor = Math.abs(z1 - z0) < 0.0001 ? 0 : (zInches - z0) / (z1 - z0);
          break;
        }
      }
    }

    for (let j = 0; j <= segmentsRadial; j++) {
      let tCross = 0.5;
      let isRightSide = true;
      if (j <= 9) tCross = 0.5 + 0.5 * (j / 9);
      else if (j <= 18) { tCross = 1.0 - 0.5 * ((j - 9) / 9); isRightSide = false; }
      else if (j <= 27) { tCross = 0.5 - 0.5 * ((j - 18) / 9); isRightSide = false; }
      else tCross = 0.5 * ((j - 27) / 9);

      const pA = evaluateBezier3D(s0, tCross);
      const pB = evaluateBezier3D(s1, tCross);
      const rawX = pA[0] + (pB[0] - pA[0]) * lerpFactor;
      const rawY = pA[1] + (pB[1] - pA[1]) * lerpFactor;

      const s0_apex_w = s0.controlPoints[2]![0];
      const s1_apex_w = s1.controlPoints[2]![0];
      const sliceApexWidth = s0_apex_w + (s1_apex_w - s0_apex_w) * lerpFactor;
      const scaleFactor = Math.abs(sliceApexWidth) > 1e-6 ? profile.apexHalfWidth / sliceApexWidth : 0;
      const px_manual = (isRightSide ? 1 : -1) * rawX * scaleFactor;

      const s0Top = Math.max(...s0.controlPoints.map(p => p[1]));
      const s1Top = Math.max(...s1.controlPoints.map(p => p[1]));
      const sliceTop = s0Top + (s1Top - s0Top) * lerpFactor;
      const s0Bot = Math.min(...s0.controlPoints.map(p => p[1]));
      const s1Bot = Math.min(...s1.controlPoints.map(p => p[1]));
      const sliceBot = s0Bot + (s1Bot - s0Bot) * lerpFactor;
      const sliceThickness = sliceTop - sliceBot;
      const currentThickness = topY - botY;

      let py_manual = botY + currentThickness / 2;
      if (Math.abs(sliceThickness) > 1e-6) {
          const normY = (rawY - sliceBot) / sliceThickness;
          py_manual = botY + normY * currentThickness;
      }

      let px = px_manual;
      let py = py_manual;

      if (relaxFactor > 0) {
        const angle = (j / segmentsRadial) * Math.PI * 2;
        const cx = Math.cos(angle);
        const cy = Math.sin(angle);
        const apexY = profile.botY + (profile.topY - profile.botY) * ((model as any).apexRatio || 0.3);
        
        const px_ellipse = Math.sign(cx) * Math.abs(cx) * halfWidth;
        const py_top_ellipse = apexY + Math.abs(cy) * (profile.topY - apexY);
        const py_bot_ellipse = apexY - Math.abs(cy) * (apexY - profile.botY);
        const py_ellipse = cy >= 0 ? py_top_ellipse : py_bot_ellipse;

        px = px_manual * (1 - relaxFactor) + px_ellipse * relaxFactor;
        py = py_manual * (1 - relaxFactor) + py_ellipse * relaxFactor;
      }

      const tOpposite = 1.0 - tCross;
      const pAOpp = evaluateBezier3D(s0, tOpposite);
      const pBOpp = evaluateBezier3D(s1, tOpposite);
      const rawYOpp = pAOpp[1] + (pBOpp[1] - pAOpp[1]) * lerpFactor;

      let pyOpp = botY + currentThickness / 2;
      if (Math.abs(sliceThickness) > 1e-6) {
          const normYOpp = (rawYOpp - sliceBot) / sliceThickness;
          pyOpp = botY + normYOpp * currentThickness;
      }

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

  const noseProfile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, minZ);
  if (noseProfile.halfWidth < 0.1) {
    const centerY = ((noseProfile.topY + noseProfile.botY) / 2) * scale;
    for (let j = 0; j <= segmentsRadial; j++) {
      const idx = j * 3;
      vertices[idx] = 0;
      vertices[idx + 1] = centerY;
    }
  } else {
    buildEndCap(true, 0, minZ, noseProfile.topY, noseProfile.botY);
  }

  const tailProfile = getBoardProfileAtZ(model, { outline: [], rockerTop: [], rockerBottom: [] }, maxZ);
  if (tailProfile.halfWidth < 0.1) {
    const centerY = ((tailProfile.topY + tailProfile.botY) / 2) * scale;
    const ringIndex = segmentsZ - 1;
    for (let j = 0; j <= segmentsRadial; j++) {
      const idx = (ringIndex * (segmentsRadial + 1) + j) * 3;
      vertices[idx] = 0;
      vertices[idx + 1] = centerY;
    }
  } else {
    buildEndCap(false, segmentsZ - 1, maxZ, tailProfile.topY, tailProfile.botY);
  }

  return {
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    volumeLiters: calculateVolume(vertices, indices)
  };
};
