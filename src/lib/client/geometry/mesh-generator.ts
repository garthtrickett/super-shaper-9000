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

export const findVAtZ = (bezier: BezierCurveData, targetZ: number, tStart: number, tEnd: number): number => {
  let bestT = (tStart + tEnd) / 2;
  let minErr = Infinity;
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = tStart + (i / steps) * (tEnd - tStart);
    const p = evaluateBezier3D(bezier, t);
    const err = Math.abs(p[2] - targetZ);
    if (err < minErr) {
      minErr = err;
      bestT = t;
    }
  }
  let tSearch = bestT;
  let step = (tEnd - tStart) / steps;
  for (let i = 0; i < 15; i++) {
    step /= 2;
    const tL = Math.max(tStart, tSearch - step);
    const tR = Math.min(tEnd, tSearch + step);
    if (Math.abs(evaluateBezier3D(bezier, tL)[2] - targetZ) < Math.abs(evaluateBezier3D(bezier, tR)[2] - targetZ)) {
      tSearch = tL;
    } else {
      tSearch = tR;
    }
  }
  return tSearch;
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
  const T0 = bezier.tangents2[segmentIdx] ||[0, 0, 0];
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
  let isFlat = true;
  for (let i = 0; i < bezier.controlPoints.length; i++) {
    if (Math.abs(bezier.controlPoints[i]![0]) > 0.000001) { isFlat = false; break; }
    if (bezier.tangents1[i] && Math.abs(bezier.tangents1[i]![0]) > 0.000001) { isFlat = false; break; }
    if (bezier.tangents2[i] && Math.abs(bezier.tangents2[i]![0]) > 0.000001) { isFlat = false; break; }
  }
  if (isFlat) return 0.5;

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

  const s0 = crossSections[k0]!;
  const s1 = crossSections[Math.min(crossSections.length - 1, k0 + 1)]!;

  const tApex0 = findApexT(s0);
  const tApex1 = findApexT(s1);
  
  // Use linear interpolation to prevent catastrophic overshoot artifacts 
  // on non-uniformly spaced cross sections (e.g. dense tail slices)
  const tApex = tApex0 + (tApex1 - tApex0) * lerpFactor;

  return {
    tApex: Math.max(0, Math.min(1, tApex)),
    evaluate: (tMid: number): Point3D => {
      const p0 = evaluateBezier3D(s0, tMid);
      const p1 = evaluateBezier3D(s1, tMid);
      return [
        p0[0] + (p1[0] - p0[0]) * lerpFactor,
        p0[1] + (p1[1] - p0[1]) * lerpFactor,
        p0[2] + (p1[2] - p0[2]) * lerpFactor,
      ];
    }
  };
};

export const evaluateCompositeOutlineAtZ = (model: BoardModel, zInches: number, hintT: number = 0.5): Point3D => {
  const basePt = evaluateBezierAtZ(model.outline, zInches, hintT);
  
  if (!model.outlineLayers || model.outlineLayers.length === 0) return basePt;

  let finalX = basePt[0];
  
  for (const layer of model.outlineLayers) {
    if (layer.otlExt && layer.otlExt.controlPoints.length > 0) {
      const minZ = layer.otlExt.controlPoints[0]![2];
      const maxZ = layer.otlExt.controlPoints[layer.otlExt.controlPoints.length - 1]![2];
      
      const z0 = Math.min(minZ, maxZ);
      const z1 = Math.max(minZ, maxZ);
      
      if (zInches >= z0 - 0.01 && zInches <= z1 + 0.01) {
        const extPt = evaluateBezierAtZ(layer.otlExt, zInches, hintT);
        finalX = extPt[0];
      }
    }
  }
  
  return [finalX, basePt[1], basePt[2]];
};

const evaluateBezierAtZ = (bezier: BezierCurveData, targetZ: number, hintT: number = 0.5): Point3D => {
  let bestT = hintT;
  let minErr = Infinity;
  
  const steps = 50;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = evaluateBezier3D(bezier, t);
    const zErr = Math.abs(p[2] - targetZ);
    // Weight the distance in T space to prefer the branch closest to our progress 
    // (crucial for swallow tails where the curve folds back on itself in Z)
    const tErr = Math.abs(t - hintT) * 0.1; 
    const totalErr = zErr + tErr;
    
    if (totalErr < minErr) {
      minErr = totalErr;
      bestT = t;
    }
  }
  
  let tSearch = bestT;
  let step = 1.0 / steps;
  for (let i = 0; i < 15; i++) {
    step /= 2;
    const tL = Math.max(0, tSearch - step);
    const tR = Math.min(1, tSearch + step);
    const pL = evaluateBezier3D(bezier, tL);
    const pR = evaluateBezier3D(bezier, tR);
    const errL = Math.abs(pL[2] - targetZ) + Math.abs(tL - hintT) * 0.1;
    const errR = Math.abs(pR[2] - targetZ) + Math.abs(tR - hintT) * 0.1;
    
    if (errL < minErr && errL <= errR) {
      minErr = errL;
      tSearch = tL;
    } else if (errR < minErr) {
      minErr = errR;
      tSearch = tR;
    }
  }
  
  return evaluateBezier3D(bezier, tSearch);
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
  let segmentsV = 240;
  const segmentsU = 96; 
  const scale = 1 / 12;
  const vertices: number[] =[];
  const indices: number[] = [];
  const uvs: number[] = [];
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

  const nosePt = evaluateBezier3D(model.outline, 0);
  const noseZ = nosePt[2];

  const notchPt = evaluateBezier3D(model.outline, 1);
  const notchZ = notchPt[2];

  let tipZ = -Infinity;
  let v_tip = 1.0;
  const steps = 50;
  for (let i = 0; i <= steps; i++) {
    const p = evaluateBezier3D(model.outline, i / steps);
    if (p[2] > tipZ) {
      tipZ = p[2];
      v_tip = i / steps;
    }
  }
  let tSearch = v_tip;
  let stepSize = 1.0 / steps;
  for (let i = 0; i < 15; i++) {
    stepSize /= 2;
    const tL = Math.max(0, tSearch - stepSize);
    const tR = Math.min(1, tSearch + stepSize);
    if (evaluateBezier3D(model.outline, tL)[2] > evaluateBezier3D(model.outline, tR)[2]) {
      tSearch = tL;
    } else {
      tSearch = tR;
    }
  }
  v_tip = tSearch;
  const tipPt = evaluateBezier3D(model.outline, v_tip);
  tipZ = tipPt[2];

  const isSwallow = notchZ < tipZ - 0.01;

  // Inject critical Z coordinates (Control Points) to capture razor sharp wings and swallow tails
  const zRings: number[] =[];
  for (let i = 0; i <= segmentsV; i++) {
    const vParam = (1 - Math.cos((i / segmentsV) * Math.PI)) / 2;
    zRings.push(noseZ + vParam * (tipZ - noseZ));
  }

  // Detect wings (vertical steps in the outline) and inject micro-slices to render sharp walls
  model.outline.controlPoints.forEach(p => {
    if (Math.abs(p[2] - noseZ) > 0.1 && Math.abs(p[2] - tipZ) > 0.1) {
      zRings.push(p[2] - 0.001);
      zRings.push(p[2]);
      zRings.push(p[2] + 0.001);
    }
  });

  if (model.outlineLayers) {
    model.outlineLayers.forEach(layer => {
      layer.otlExt.controlPoints.forEach(p => {
        if (Math.abs(p[2] - noseZ) > 0.1 && Math.abs(p[2] - tipZ) > 0.1) {
          zRings.push(p[2] - 0.001);
          zRings.push(p[2]);
          zRings.push(p[2] + 0.001);
        }
      });
    });
  }

  zRings.sort((a, b) => a - b);
  segmentsV = zRings.length - 1;

  const sliceArcLengths = new Float32Array(segmentsV + 1);
  let totalArcLength = 0;
  const lastCenterPos = new THREE.Vector3();

  for (let i = 0; i <= segmentsV; i++) {
    const zInches = zRings[i]!;

    const v_outer = findVAtZ(model.outline, zInches, 0, v_tip);
    const topPt = evaluateBezierAtZ(model.rockerTop, zInches, v_outer);
    const botPt = evaluateBezierAtZ(model.rockerBottom, zInches, v_outer);
    const cy = (topPt[1] + botPt[1]) / 2;
    
    const currentCenterPos = new THREE.Vector3(0, cy * scale, zInches * scale);
    
    if (i > 0) {
      totalArcLength += currentCenterPos.distanceTo(lastCenterPos);
    }
    sliceArcLengths[i] = totalArcLength;
    lastCenterPos.copy(currentCenterPos);
  }

  const vertexGrid: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[][] = [];
  const noseWidth = evaluateCompositeOutlineAtZ(model, noseZ, 0)[0];

  for (let i = 0; i <= segmentsV; i++) {
    const ring: { pos: THREE.Vector3; color: THREE.Color; uv: THREE.Vector2 }[] =[];
    const zInches = zRings[i]!;
    const vCoord = sliceArcLengths[i]! / totalArcLength;
    
    const v_outer = findVAtZ(model.outline, zInches, 0, v_tip);
    
    let innerX = 0;
    if (zInches > notchZ + 0.001) {
      const v_inner = findVAtZ(model.outline, zInches, v_tip, 1.0);
      innerX = evaluateBezier3D(model.outline, v_inner)[0];
    }

    const topPt = evaluateBezierAtZ(model.rockerTop, zInches, v_outer);
    const botPt = evaluateBezierAtZ(model.rockerBottom, zInches, v_outer);
    const localThickness = Math.max(0, topPt[1] - botPt[1]);
    const heatColor = new THREE.Color(...colorHeatmap(Math.max(0, Math.min(1, localThickness / model.thickness))));

    for (let j = 0; j <= segmentsU + 1; j++) {
      let u = 0.0, side = 1.0;
      let isStringer = false;

      if (j <= segmentsU / 2) {
        // Right side
        u = j / (segmentsU / 2);
        side = 1.0;
        if (j === 0 || j === segmentsU / 2) isStringer = true;
      } else {
        // Left side
        const leftJ = j - (segmentsU / 2 + 1);
        u = 1.0 - leftJ / (segmentsU / 2);
        side = -1.0;
        if (leftJ === 0 || leftJ === segmentsU / 2) isStringer = true;
      }

      const point = getPointAtUV(model, u, v_outer, zInches, innerX);
      let px = point[0];
      const py = point[1];
      const pz = point[2];
      
      if (isStringer) px = innerX;
      px *= side;

      if (i === 0 && noseWidth < 1e-3) px = 0;

      const pos = new THREE.Vector3(px * scale, py * scale, pz * scale);
      const uvVec = new THREE.Vector2(u, vCoord); // Use u to map texture nicely
      
      ring.push({ pos, color: heatColor, uv: uvVec });
    }
    vertexGrid.push(ring);
  }

  // Compute analytical UV normals
  for (let i = 0; i <= segmentsV; i++) {
    for (let j = 0; j <= segmentsU + 1; j++) {
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

      if (j > 0 && j < segmentsU + 1 && j !== segmentsU / 2 && j !== segmentsU / 2 + 1) {
        tangentU.subVectors(vertexGrid[i]![j + 1]!.pos, vertexGrid[i]![j - 1]!.pos);
      } else {
        // Fallback for edges
        if (j === 0) tangentU.subVectors(vertexGrid[i]![1]!.pos, vertexGrid[i]![0]!.pos);
        else if (j === segmentsU / 2) tangentU.subVectors(vertexGrid[i]![j]!.pos, vertexGrid[i]![j - 1]!.pos);
        else if (j === segmentsU / 2 + 1) tangentU.subVectors(vertexGrid[i]![j + 1]!.pos, vertexGrid[i]![j]!.pos);
        else tangentU.subVectors(vertexGrid[i]![j]!.pos, vertexGrid[i]![j - 1]!.pos);
      }
      
      normal.crossVectors(tangentU, tangentV).normalize();
      
      if (isNaN(normal.x) || normal.lengthSq() < 0.0001) {
        if (i === 0) normal.set(0, 0, -1);
        else if (i === segmentsV) normal.set(0, 0, 1);
        else normal.set(0, j > segmentsU / 4 && j < (segmentsU * 0.75) ? 1 : -1, 0);
      }

      normals.push(normal.x, normal.y, normal.z);
    }
  }

  const pushTriangle = (i1: number, i2: number, i3: number) => {
    indices.push(i1, i2, i3);
  };
  for (let i = 0; i < segmentsV; i++) {
    const z0 = zRings[i]!;
    const z1 = zRings[i + 1]!;
    const gapOpen = z0 > notchZ + 0.001 || z1 > notchZ + 0.001;

    for (let j = 0; j <= segmentsU; j++) {
      const a = i * (segmentsU + 2) + j;
      const b = a + 1;
      const c = (i + 1) * (segmentsU + 2) + j;
      const d = c + 1;
      
      if (j === segmentsU / 2) {
        if (gapOpen) {
          // Inner walls are generated later with independent vertices for proper normals
          continue;
        } else {
          pushTriangle(a, b, d);
          pushTriangle(a, d, c);
          continue;
        }
      }
      
      pushTriangle(a, b, d);
      pushTriangle(a, d, c);
    }
  }

  // --- ADD INNER WALLS FOR SWALLOW TAIL ---
  if (isSwallow) {
    let firstOpenRing = -1;
    for (let i = 0; i <= segmentsV; i++) {
      const z = zRings[i]!;
      if (z > notchZ + 0.001) {
        firstOpenRing = i;
        break;
      }
    }

    if (firstOpenRing !== -1) {
      const startRing = firstOpenRing > 0 ? firstOpenRing - 1 : 0;
      
      // Right Prong Inner Wall
      const rightWallStartIdx = vertices.length / 3;
      for (let i = startRing; i <= segmentsV; i++) {
        const idxTopR = i * (segmentsU + 2) + segmentsU / 2;
        const idxBotR = i * (segmentsU + 2) + 0;
        
        vertices.push(vertices[idxTopR * 3]!, vertices[idxTopR * 3 + 1]!, vertices[idxTopR * 3 + 2]!);
        uvs.push(uvs[idxTopR * 2]!, uvs[idxTopR * 2 + 1]!);
        colors.push(colors[idxTopR * 3]!, colors[idxTopR * 3 + 1]!, colors[idxTopR * 3 + 2]!);
        normals.push(-1, 0, 0);

        vertices.push(vertices[idxBotR * 3]!, vertices[idxBotR * 3 + 1]!, vertices[idxBotR * 3 + 2]!);
        uvs.push(uvs[idxBotR * 2]!, uvs[idxBotR * 2 + 1]!);
        colors.push(colors[idxBotR * 3]!, colors[idxBotR * 3 + 1]!, colors[idxBotR * 3 + 2]!);
        normals.push(-1, 0, 0);
      }

      for (let i = 0; i < segmentsV - startRing; i++) {
        const a = rightWallStartIdx + i * 2;
        const b = rightWallStartIdx + i * 2 + 1;
        const c = rightWallStartIdx + (i + 1) * 2;
        const d = rightWallStartIdx + (i + 1) * 2 + 1;
        pushTriangle(a, b, d);
        pushTriangle(a, d, c);
      }

      // Left Prong Inner Wall
      const leftWallStartIdx = vertices.length / 3;
      for (let i = startRing; i <= segmentsV; i++) {
        const idxTopL = i * (segmentsU + 2) + (segmentsU / 2 + 1);
        const idxBotL = i * (segmentsU + 2) + (segmentsU + 1);
        
        vertices.push(vertices[idxTopL * 3]!, vertices[idxTopL * 3 + 1]!, vertices[idxTopL * 3 + 2]!);
        uvs.push(uvs[idxTopL * 2]!, uvs[idxTopL * 2 + 1]!);
        colors.push(colors[idxTopL * 3]!, colors[idxTopL * 3 + 1]!, colors[idxTopL * 3 + 2]!);
        normals.push(1, 0, 0);

        vertices.push(vertices[idxBotL * 3]!, vertices[idxBotL * 3 + 1]!, vertices[idxBotL * 3 + 2]!);
        uvs.push(uvs[idxBotL * 2]!, uvs[idxBotL * 2 + 1]!);
        colors.push(colors[idxBotL * 3]!, colors[idxBotL * 3 + 1]!, colors[idxBotL * 3 + 2]!);
        normals.push(1, 0, 0);
      }

      for (let i = 0; i < segmentsV - startRing; i++) {
        const a = leftWallStartIdx + i * 2;
        const b = leftWallStartIdx + i * 2 + 1;
        const c = leftWallStartIdx + (i + 1) * 2;
        const d = leftWallStartIdx + (i + 1) * 2 + 1;
        pushTriangle(a, c, d);
        pushTriangle(a, d, b);
      }
    }
  }

  const noseNeedsCap = true;
  const tailNeedsCap = !isSwallow;

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

    for (let j = 0; j <= segmentsU + 1; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, -1);
    }

    for (let j = 0; j <= segmentsU; j++) {
      if (j === segmentsU / 2) {
        if (notchZ < noseZ + 0.001) continue; // Extreme edge case
      }
      indices.push(centerIdx, perimeterStartIdx + j + 1, perimeterStartIdx + j);
    }
  }

  if (tailNeedsCap) {
    const ringStartIndex = segmentsV * (segmentsU + 2);
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

    for (let j = 0; j <= segmentsU + 1; j++) {
      const hullIndex = ringStartIndex + j;
      vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
      uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
      colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
      normals.push(0, 0, 1);
    }

    for (let j = 0; j <= segmentsU; j++) {
      indices.push(centerIdx, perimeterStartIdx + j, perimeterStartIdx + j + 1);
    }
  } else if (isSwallow) {
    const ringStartIndex = segmentsV * (segmentsU + 2);
    
    // RIGHT PRONG CAP
    let rightSumX = 0, rightSumY = 0, rightSumZ = 0;
    const rightCount = (segmentsU / 2) + 1;
    for (let j = 0; j <= segmentsU / 2; j++) {
        const v = vertexGrid[segmentsV]![j]!.pos;
        rightSumX += v.x; rightSumY += v.y; rightSumZ += v.z;
    }
    const rightCenter = new THREE.Vector3(rightSumX/rightCount, rightSumY/rightCount, rightSumZ/rightCount);
    
    const rightCenterIdx = vertices.length / 3;
    vertices.push(rightCenter.x, rightCenter.y, rightCenter.z);
    uvs.push(0.75, 1);
    colors.push(1, 1, 1);
    normals.push(0, 0, 1);
    
    const rightPerimeterStartIdx = vertices.length / 3;
    for (let j = 0; j <= segmentsU / 2; j++) {
        const hullIndex = ringStartIndex + j;
        vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
        uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
        colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
        normals.push(0, 0, 1);
    }
    
    for (let j = 0; j < segmentsU / 2; j++) {
        indices.push(rightCenterIdx, rightPerimeterStartIdx + j, rightPerimeterStartIdx + j + 1);
    }
    indices.push(rightCenterIdx, rightPerimeterStartIdx + segmentsU / 2, rightPerimeterStartIdx);

    // LEFT PRONG CAP
    let leftSumX = 0, leftSumY = 0, leftSumZ = 0;
    const leftCount = segmentsU / 2 + 1;
    for (let j = segmentsU / 2 + 1; j <= segmentsU + 1; j++) {
        const v = vertexGrid[segmentsV]![j]!.pos;
        leftSumX += v.x; leftSumY += v.y; leftSumZ += v.z;
    }
    const leftCenter = new THREE.Vector3(leftSumX/leftCount, leftSumY/leftCount, leftSumZ/leftCount);
    
    const leftCenterIdx = vertices.length / 3;
    vertices.push(leftCenter.x, leftCenter.y, leftCenter.z);
    uvs.push(0.25, 1);
    colors.push(1, 1, 1);
    normals.push(0, 0, 1);
    
    const leftPerimeterStartIdx = vertices.length / 3;
    for (let j = segmentsU / 2 + 1; j <= segmentsU + 1; j++) {
        const hullIndex = ringStartIndex + j;
        vertices.push(vertices[hullIndex * 3]!, vertices[hullIndex * 3 + 1]!, vertices[hullIndex * 3 + 2]!);
        uvs.push(uvs[hullIndex * 2]!, uvs[hullIndex * 2 + 1]!);
        colors.push(colors[hullIndex * 3]!, colors[hullIndex * 3 + 1]!, colors[hullIndex * 3 + 2]!);
        normals.push(0, 0, 1);
    }
    
    for (let j = 0; j < segmentsU / 2; j++) {
        indices.push(leftCenterIdx, leftPerimeterStartIdx + j, leftPerimeterStartIdx + j + 1);
    }
    indices.push(leftCenterIdx, leftPerimeterStartIdx + segmentsU / 2, leftPerimeterStartIdx);
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

export const getBoardProfileAtZ = (model: BoardModel, _curves: BoardCurves, zInches: number, hintT: number = 0.5) => {
  const topPt = evaluateBezierAtZ(model.rockerTop, zInches, hintT);
  const botPt = evaluateBezierAtZ(model.rockerBottom, zInches, hintT);
  const outlinePt = evaluateCompositeOutlineAtZ(model, zInches, hintT);
  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

  // Prevent vertical bowtie inversion (Deck Y < Bottom Y) caused by cubic Bezier overshoot at the tail
  if (topPt[1] < botPt[1]) {
    topPt[1] = botPt[1];
  }

  let apexX = Math.max(0, outlinePt[0]);
  let apexY = botPt[1] + (topPt[1] - botPt[1]) * 0.3; // Default
  
  if (model.apexOutline && model.apexOutline.controlPoints.length > 0) {
    apexX = Math.max(0, evaluateBezierAtZ(model.apexOutline, zInches, hintT)[0]);
  }

  if (model.apexRocker && model.apexRocker.controlPoints.length > 0) {
    apexY = evaluateBezierAtZ(model.apexRocker, zInches, hintT)[1];
  } else if (blend) {
    const pBot = blend.evaluate(0.0);
    const pTop = blend.evaluate(1.0);
    const pApex = blend.evaluate(blend.tApex);
    
    const sliceThick = pTop[1] - pBot[1];
    const worldThick = topPt[1] - botPt[1];
    
    if (Math.abs(sliceThick) > 1e-5) {
      const apexFrac = (pApex[1] - pBot[1]) / sliceThick;
      apexY = botPt[1] + worldThick * apexFrac;
    }
  }

  // Ensure apexY stays within board thickness
  apexY = Math.max(botPt[1], Math.min(topPt[1], apexY));

  let tuckY = botPt[1];
  if (blend) {
    const pBot = blend.evaluate(0.0);
    const pTop = blend.evaluate(1.0);
    const tTuck = Math.max(0.01, blend.tApex * 0.5);
    const pTuck = blend.evaluate(tTuck);
    
    const sliceThick = pTop[1] - pBot[1];
    const worldThick = topPt[1] - botPt[1];
    
    if (Math.abs(sliceThick) > 1e-5) {
      const tuckFrac = (pTuck[1] - pBot[1]) / sliceThick;
      tuckY = botPt[1] + worldThick * tuckFrac;
    }
  }

  // Clamping tuckY below deck (but allowing it to drop below botY for concaves)
  tuckY = Math.min(topPt[1], tuckY);

  let tuckX = Math.max(0, outlinePt[0]);
  if (model.railOutline && model.railOutline.controlPoints.length > 0) {
    tuckX = Math.max(0, evaluateBezierAtZ(model.railOutline, zInches, hintT)[0]);
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

  const pApex = blend.evaluate(blend.tApex);
  const sliceApexX = Math.max(0.001, pApex[0]);

  let t0 = 0,
    t1 = blend.tApex,
    p =[0, 0, 0] as Point3D;
  const targetX = Math.abs(xInches);

  const tTuck = Math.max(0.01, blend.tApex * 0.5);
  const pTuck = blend.evaluate(tTuck);
  const sliceTuckX = Math.max(0.001, pTuck[0]);

  for (let i = 0; i < 15; i++) {
    const tMid = (t0 + t1) / 2;
    p = blend.evaluate(tMid);
    
    let mappedX = 0;
    if (tMid <= tTuck) {
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
  const sliceBotY = blend.evaluate(0.0)[1];
  const sliceTuckY = pTuck[1];
  const sliceApexY = pApex[1];
  let py = profile.botY;
  if (t0 <= tTuck) {
    const rangeY = sliceTuckY - sliceBotY;
    const normY = Math.abs(rangeY) > 1e-5 ? (p[1] - sliceBotY) / rangeY : 0;
    py = profile.botY + normY * (profile.tuckY - profile.botY);
  } else {
    const rangeY = sliceApexY - sliceTuckY;
    const normY = Math.abs(rangeY) > 1e-5 ? (p[1] - sliceTuckY) / rangeY : 0;
    py = profile.tuckY + normY * (profile.apexY - profile.tuckY);
  }
  
  return Math.min(profile.topY, py);
};

export const getPointAtUV = (
  model: BoardModel, 
  u: number, 
  v: number, 
  overrideZ?: number, 
  innerX: number = 0
): Point3D => {
  const basePt = evaluateBezier3D(model.outline, v);
  const zInches = overrideZ !== undefined ? overrideZ : basePt[2];
  
  const profile = getBoardProfileAtZ(model, {} as BoardCurves, zInches, v);

  const botY = profile.botY;
  const topY = profile.topY;
  const apexY = profile.apexY;
  const finalApexX = profile.apexX;
  const finalTuckX = profile.tuckX;
  
  const blend = getCrossSectionBlendAtZ(model.crossSections, zInches);

  if (!blend) {
    const py = botY + (topY - botY) * u;
    return [profile.halfWidth, py, zInches];
  }

  let sliceTopY = 1.0, sliceBotY = 0.0, sliceApexX = 1.0, sliceApexY = 0.5, sliceTuckX = 0.8;
  const pBot = blend.evaluate(0.0);
  const pTop = blend.evaluate(1.0);
  const pApex = blend.evaluate(blend.tApex);
  const tTuck = Math.max(0.01, blend.tApex * 0.5);
  const pTuck = blend.evaluate(tTuck);
  
  sliceBotY = pBot[1];
  sliceTopY = pTop[1];
  sliceApexX = Math.max(0.001, pApex[0]);
  sliceApexY = pApex[1];
  sliceTuckX = Math.max(0.001, pTuck[0]);

  const p = blend.evaluate(u);
  let px = 0, py = botY + (topY - botY) / 2;

  if (u <= tTuck) {
    const normX = sliceTuckX > 1e-5 ? p[0] / sliceTuckX : 0;
    px = normX * finalTuckX;
  } else if (u <= blend.tApex) {
    const rangeX = sliceApexX - sliceTuckX;
    const normX = rangeX > 1e-5 ? (p[0] - sliceTuckX) / rangeX : 0;
    px = finalTuckX + normX * (finalApexX - finalTuckX);
  } else {
    const normX = sliceApexX > 1e-5 ? p[0] / sliceApexX : 0;
    px = normX * finalApexX;
  }
  
  if (px < innerX) px = innerX;
  
  if (u <= blend.tApex) {
    py = botY + (p[1] - sliceBotY);
  } else {
    const rangeY = sliceTopY - sliceApexY;
    const normY = Math.abs(rangeY) > 1e-5 ? (p[1] - sliceApexY) / rangeY : 0;
    py = apexY + normY * (topY - apexY);
  }

  // Ensure py does not exceed topY (deck) or drop below botY unexpectedly
  // Specifically, deck vertices (u > tApex) should never drop below botY, 
  // and bottom vertices (u <= tApex) should never exceed topY.
  if (u <= blend.tApex) {
     py = Math.max(botY - 2.0, Math.min(topY, py));
  } else {
     py = Math.max(botY, Math.min(topY, py));
  }

  return [px, py, zInches];
export const MeshGeneratorService = {
  generateMesh: (model: BoardModel, _curves: BoardCurves): RawGeometryData => generateMesh(model),
  getPointAtUV,
  getBoardProfileAtZ,
  getBottomYAt,
  evaluateCompositeOutlineAtZ,
};
