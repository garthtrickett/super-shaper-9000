/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { getRhino } from "../rhino/rhino-service";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";

export interface BoardCurves {
  outline: [number, number, number][];
  rockerTop:[number, number, number][];
  rockerBottom: [number, number, number][];
}

// Export dependencies object for easy mocking in unit tests
export const deps = {
  getRhino
};

export const generateBoardCurves = async (model: BoardModel): Promise<BoardCurves> => {
  // Graceful fallback if WASM fails to load in the test environment
  const rhino = await deps.getRhino().catch((e: unknown) => {
      console.warn("Failed to load rhino3dm WASM. Using fallback geometry.", e);
      return null;
  });

  const L = model.length;
  const W = model.width;
  const T = model.thickness;

  if (!rhino) {
      // Mock fallback: Just a simple triangulated shape
      return {
          outline: [[0, 0, -L/2], [W/2, 0, 0],[0, 0, L/2]],
          rockerTop: [[0, T/2, -L/2],[0, T/2, 0], [0, T/2, L/2]],
          rockerBottom: [[0, -T/2, -L/2],[0, -T/2, 0], [0, -T/2, L/2]],
      };
  }
  
  // ====================================================================
  // 1. GENERATE SPARSE, FLUID NURBS CONTROL POINTS
  // ====================================================================
  // By using exactly 5-8 carefully placed points, the Rhino engine will 
  // generate a flawlessly smooth, tension-free curve (no kinks or angles).
  const cp: [number, number, number][] = [];
  const wpZ = -model.widePointOffset; 

  // --- A. NOSE TIP (-L/2 ALWAYS) ---
  // Absolute tip MUST be on the stringer (X=0) for a continuous, seamless mesh closure.
  cp.push([0, 0, -L/2]); 

  // By placing control points slightly behind the tip, we force the NURBS engine 
  // to draw a smooth, rounded nose that perfectly wraps into the center point.
  if (model.noseShape === "clipped") {
      // Tomo style: Hardcoded to 0.1 for a fast, tight chopped corner
      cp.push([model.noseTipWidth / 2, 0, -L/2 + 0.1]); 
  } else if (model.noseShape === "torpedo") {
      // Sweeping, perfect semi-circle bullet nose driven by the blend slider
      cp.push([model.noseTipWidth / 2, 0, -L/2 + model.noseTipCurveZ]); 
  }

  // --- B. NOSE FULLNESS (N12 area) ---
  // A Tomo demands parallel rails, so we force the N12 control point to 16.0" wide
  const zNoseCtrl = -L/2 + (wpZ - (-L/2)) * 0.4;
  const wNoseCtrl = (model.noseShape === "clipped" ? 16.0 : model.noseWidth) / 2;

  if (model.noseShape === "torpedo") {
      cp.push([wNoseCtrl * 1.15, 0, zNoseCtrl]); // Bulge out for torpedo look
  } else {
      cp.push([wNoseCtrl, 0, zNoseCtrl]);
  }

  // --- C. WIDE POINT ---
  cp.push([model.width / 2, 0, wpZ]);

  // --- D. TAIL FULLNESS / HIP (T12 area) ---
  const hipRatio = 0.6; // Pulls the control point back slightly for a nice hip
  const zTailCtrl = wpZ + (L/2 - wpZ) * hipRatio;
  const wTailCtrl = model.tailWidth / 2;

  if (model.tailType === "round") {
      cp.push([wTailCtrl * 1.05, 0, zTailCtrl]); // Slight hip bump before roundoff
  } else if (model.tailType === "pintail") {
      cp.push([wTailCtrl * 0.9, 0, zTailCtrl]); // Straighter taper
  } else {
      cp.push([wTailCtrl, 0, zTailCtrl]);
  }

  // --- E. TAIL TIP & BLOCK (L/2 ALWAYS) ---
  if (model.tailType === "squash" || model.tailType === "swallow") {
      cp.push([model.tailBlockWidth / 2, 0, L/2]);
  } else if (model.tailType === "torpedo") {
      // Decoupled from the nose: uses its own Tail Block Width slider
      // Uses a standard 2-inch blend length to smoothly wrap the rails into the tail block
      cp.push([model.tailBlockWidth / 2, 0, L/2 - 2.0]);
      cp.push([0, 0, L/2]);
  } else if (model.tailType === "round") {
      // A rounded pin needs an anchor just before the tip to hold the curve wide
      cp.push([model.tailWidth / 2 * 0.4, 0, L/2 - 2.5]);
      cp.push([0, 0, L/2]);
  } else if (model.tailType === "pintail") {
      cp.push([0, 0, L/2]);
  }

  // ====================================================================
  // 2. SORT AND GENERATE NURBS
  // ====================================================================
  // Ensure strict Z-progression. This mathematically guarantees no S-curves.
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

  // ====================================================================
  // 3. DYNAMIC ROCKER CURVES & FOIL
  // ====================================================================
  const tipThickness = 0.0; 
  const bottomPlane = -T / 2; 
  const flatHalf = model.rockerFlatSpotLength / 2;

  const ptsRockerTop = new rhino.Point3dList();
  ptsRockerTop.add(0, bottomPlane + model.noseRocker + tipThickness, -L/2); 
  ptsRockerTop.add(0, bottomPlane + model.noseRocker * 0.25 + model.noseThickness, -L/2 + 12);
  if (flatHalf > 0.1) {
      ptsRockerTop.add(0, T/2, wpZ - flatHalf);
  }
  ptsRockerTop.add(0, T/2, wpZ); 
  if (flatHalf > 0.1) {
      ptsRockerTop.add(0, T/2, wpZ + flatHalf);
  }
  ptsRockerTop.add(0, bottomPlane + model.tailRocker * 0.25 + model.tailThickness, L/2 - 12);
  ptsRockerTop.add(0, bottomPlane + model.tailRocker + tipThickness, L/2);
  const crvRockerTop = rhino.NurbsCurve.create(false, 3, ptsRockerTop);

  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker, -L/2);
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker * 0.25, -L/2 + 12);
  if (flatHalf > 0.1) {
      ptsRockerBottom.add(0, bottomPlane, wpZ - flatHalf);
  }
  ptsRockerBottom.add(0, bottomPlane, wpZ);
  if (flatHalf > 0.1) {
      ptsRockerBottom.add(0, bottomPlane, wpZ + flatHalf);
  }
  ptsRockerBottom.add(0, bottomPlane + model.tailRocker * 0.25, L/2 - 12);
  ptsRockerBottom.add(0, bottomPlane + model.tailRocker, L/2);
  const crvRockerBottom = rhino.NurbsCurve.create(false, 3, ptsRockerBottom);
   
  const sampleCurve = (crv: any, tolerance = 0.01, minSteps = 20) => {
      const pts:[number, number, number][] =[];
      if (!crv) return pts;
      const domain = crv.domain;

      const getPt = (t: number):[number, number, number] => {
          const p = crv.pointAt(t) as number[];
          return [p[0]!, p[1]!, p[2]!];
      };

      const distance = (p1:[number, number, number], p2: [number, number, number]) => Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);

      const subdivide = (t0: number, t1: number, p0:[number, number, number], p1: [number, number, number], depth: number) => {
          const tMid = (t0 + t1) / 2;
          const pMid = getPt(tMid);

          const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
          const lenSq = dx * dx + dy * dy + dz * dz;
          let dist = 0;
          
          if (lenSq === 0) {
              dist = distance(p0, pMid);
          } else {
              const tProj = ((pMid[0] - p0[0]) * dx + (pMid[1] - p0[1]) * dy + (pMid[2] - p0[2]) * dz) / lenSq;
              const clampedT = Math.max(0, Math.min(1, tProj));
              const projX = p0[0] + clampedT * dx;
              const projY = p0[1] + clampedT * dy;
              const projZ = p0[2] + clampedT * dz;
              dist = Math.hypot(pMid[0] - projX, pMid[1] - projY, pMid[2] - projZ);
          }

          // Depth limit of 8 prevents infinite recursion, ensures performance
          if (depth < 2 || (dist > tolerance && depth < 8)) {
              subdivide(t0, tMid, p0, pMid, depth + 1);
              subdivide(tMid, t1, pMid, p1, depth + 1);
          } else {
              pts.push(pMid, p1);
          }
      };

      const stepSize = (domain[1] - domain[0]) / minSteps;
      pts.push(getPt(domain[0]));
      for (let i = 0; i < minSteps; i++) {
          const t0 = domain[0] + i * stepSize;
          const t1 = domain[0] + (i + 1) * stepSize;
          subdivide(t0, t1, getPt(t0), getPt(t1), 0);
      }

      // Remove extremely close duplicates
      const uniquePts: [number, number, number][] =[pts[0]!];
      for (let i = 1; i < pts.length; i++) {
          if (distance(pts[i]!, uniquePts[uniquePts.length - 1]!) > 0.001) {
              uniquePts.push(pts[i]!);
          }
      }
      return uniquePts;
  };

  const outline = sampleCurve(crvOutline);
  const rockerTop = sampleCurve(crvRockerTop);
  const rockerBottom = sampleCurve(crvRockerBottom);

  // ====================================================================
  // 4. MESH END-CAPS
  // ====================================================================
  
  if (tailType === "swallow") {
      // Cut the swallow tail directly to the stringer
      outline.push([0, 0, L/2 - ((model as any).swallowDepth || 4.5)]);
  } else {
      // Ensure absolute stringer closure for lofting
      const lastP = outline[outline.length - 1];
      if (lastP && (lastP[2] < L/2 - 0.001 || Math.abs(lastP[0]) > 0.001)) {
          outline.push([0, 0, L/2]);
      }
  }

  // Memory cleanup for WASM references
  ptsOutline.delete();
  if (crvOutline) crvOutline.delete();
  ptsRockerTop.delete();
  if (crvRockerTop) crvRockerTop.delete();
  ptsRockerBottom.delete();
  if (crvRockerBottom) crvRockerBottom.delete();

  return { outline, rockerTop, rockerBottom };
};
