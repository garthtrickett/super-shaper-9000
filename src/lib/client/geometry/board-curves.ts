/* eslint-disable @typescript-eslint/no-explicit-any */
import { getRhino } from "../rhino/rhino-service";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";

export interface BoardCurves {
  outline: [number, number, number][];
  rockerTop:[number, number, number][];
  rockerBottom: [number, number, number][];
}

export const deps = { getRhino };

export const generateBoardCurves = async (model: BoardModel): Promise<BoardCurves> => {
  const rhino = await deps.getRhino().catch((e: unknown) => {
      console.warn("Failed to load rhino3dm WASM. Using fallback geometry.", e);
      return null;
  });

  const L = model.length;
  const W = model.width;
  const T = model.thickness;

  if (!rhino) {
      return {
          outline: [[0, 0, -L/2], [W/2, 0, 0],[0, 0, L/2]],
          rockerTop: [[0, T/2, -L/2],[0, T/2, 0], [0, T/2, L/2]],
          rockerBottom: [[0, -T/2, -L/2],[0, -T/2, 0], [0, -T/2, L/2]],
      };
  }
  
  const cp: [number, number, number][] = [];
  const widePointOffset = (model as any).widePointOffset || 2.0;
  const wpZ = -widePointOffset; 

  cp.push([0, 0, -L/2]); 

  const noseShape = (model as any).noseShape || "clipped";
  const noseTipWidth = (model as any).noseTipWidth || 4.0;
  const noseTipCurveZ = (model as any).noseTipCurveZ || 1.5;
  const noseWidth = (model as any).noseWidth || 14.0;

  if (noseShape === "clipped") {
      cp.push([noseTipWidth / 2, 0, -L/2 + 0.1]); 
  } else if (noseShape === "torpedo") {
      cp.push([noseTipWidth / 2, 0, -L/2 + noseTipCurveZ]); 
  }

  const zNoseCtrl = -L/2 + (wpZ - (-L/2)) * 0.4;
  const wNoseCtrl = (noseShape === "clipped" ? 16.0 : noseWidth) / 2;

  if (noseShape === "torpedo") {
      cp.push([wNoseCtrl * 1.15, 0, zNoseCtrl]);
  } else {
      cp.push([wNoseCtrl, 0, zNoseCtrl]);
  }

  cp.push([model.width / 2, 0, wpZ]);

  const hipRatio = 0.6;
  const zTailCtrl = wpZ + (L/2 - wpZ) * hipRatio;
  const tailWidth = (model as any).tailWidth || 13.5;
  const tailType = (model as any).tailType || "round";

  if (tailType === "round") {
      cp.push([tailWidth / 2 * 1.05, 0, zTailCtrl]);
  } else if (tailType === "pintail") {
      cp.push([tailWidth / 2 * 0.9, 0, zTailCtrl]);
  } else {
      cp.push([tailWidth / 2, 0, zTailCtrl]);
  }

  const tailBlockWidth = (model as any).tailBlockWidth || 6.0;
  if (tailType === "squash" || tailType === "swallow") {
      cp.push([tailBlockWidth / 2, 0, L/2]);
  } else if (tailType === "torpedo") {
      cp.push([tailBlockWidth / 2, 0, L/2 - 2.0]);
      cp.push([0, 0, L/2]);
  } else if (tailType === "round") {
      cp.push([tailWidth / 2 * 0.4, 0, L/2 - 2.5]);
      cp.push([0, 0, L/2]);
  } else if (tailType === "pintail") {
      cp.push([0, 0, L/2]);
  }

  cp.sort((a, b) => a[2] - b[2]);

  const ptsOutline = new rhino.Point3dList();
  const firstCp = cp[0]!;
  ptsOutline.add(firstCp[0], firstCp[1], firstCp[2]);
  
  let lastZ = firstCp[2];
  for (let i = 1; i < cp.length; i++) {
      const currCp = cp[i]!;
      if (currCp[2] - lastZ > 0.01) {
          ptsOutline.add(currCp[0], currCp[1], currCp[2]);
          lastZ = currCp[2];
      }
  }

  const crvOutline = rhino.NurbsCurve.create(false, 3, ptsOutline);

  const tipThickness = 0.0; 
  const bottomPlane = -T / 2; 
  const rockerFlatSpotLength = (model as any).rockerFlatSpotLength || 20.0;
  const flatHalf = rockerFlatSpotLength / 2;
  const noseRocker = (model as any).noseRocker || 5.2;
  const tailRocker = (model as any).tailRocker || 1.6;
  const noseThickness = (model as any).noseThickness || 1.45;
  const tailThickness = (model as any).tailThickness || 1.35;

  const ptsRockerTop = new rhino.Point3dList();
  ptsRockerTop.add(0, bottomPlane + noseRocker + tipThickness, -L/2); 
  ptsRockerTop.add(0, bottomPlane + noseRocker * 0.25 + noseThickness, -L/2 + 12);
  if (flatHalf > 0.1) ptsRockerTop.add(0, T/2, wpZ - flatHalf);
  ptsRockerTop.add(0, T/2, wpZ); 
  if (flatHalf > 0.1) ptsRockerTop.add(0, T/2, wpZ + flatHalf);
  ptsRockerTop.add(0, bottomPlane + tailRocker * 0.25 + tailThickness, L/2 - 12);
  ptsRockerTop.add(0, bottomPlane + tailRocker + tipThickness, L/2);
  const crvRockerTop = rhino.NurbsCurve.create(false, 3, ptsRockerTop);

  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, bottomPlane + noseRocker, -L/2);
  ptsRockerBottom.add(0, bottomPlane + noseRocker * 0.25, -L/2 + 12);
  if (flatHalf > 0.1) ptsRockerBottom.add(0, bottomPlane, wpZ - flatHalf);
  ptsRockerBottom.add(0, bottomPlane, wpZ);
  if (flatHalf > 0.1) ptsRockerBottom.add(0, bottomPlane, wpZ + flatHalf);
  ptsRockerBottom.add(0, bottomPlane + tailRocker * 0.25, L/2 - 12);
  ptsRockerBottom.add(0, bottomPlane + tailRocker, L/2);
  const crvRockerBottom = rhino.NurbsCurve.create(false, 3, ptsRockerBottom);
   
  const sampleCurve = (crv: any) => {
      const pts:[number, number, number][] =[];
      if (!crv) return pts;
      const domain = crv.domain;
      const steps = 100;
      for(let i=0; i<=steps; i++) {
        const t = domain[0] + (domain[1] - domain[0]) * (i/steps);
        const p = crv.pointAt(t) as number[];
        pts.push([p[0]!, p[1]!, p[2]!]);
      }
      return pts;
  };

  const outline = sampleCurve(crvOutline);
  const rockerTop = sampleCurve(crvRockerTop);
  const rockerBottom = sampleCurve(crvRockerBottom);

  if (tailType === "swallow") {
      outline.push([0, 0, L/2 - ((model as any).swallowDepth || 4.5)]);
  } else {
      const lastP = outline[outline.length - 1];
      if (lastP && (lastP[2] < L/2 - 0.001 || Math.abs(lastP[0]) > 0.001)) {
          outline.push([0, 0, L/2]);
      }
  }

  ptsOutline.delete(); if (crvOutline) crvOutline.delete();
  ptsRockerTop.delete(); if (crvRockerTop) crvRockerTop.delete();
  ptsRockerBottom.delete(); if (crvRockerBottom) crvRockerBottom.delete();

  return { outline, rockerTop, rockerBottom };
};
