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
  if (model.noseShape === "clipped") {
      cp.push([model.noseTipWidth / 2, 0, -L/2]); 
  } else if (model.noseShape === "torpedo") {
      cp.push([model.noseTipWidth / 4, 0, -L/2]); // Slight bluntness to prevent needle point
  } else {
      cp.push([0, 0, -L/2]); // Pointy
  }

  // --- B. NOSE FULLNESS (N12 area) ---
  const zNoseCtrl = -L/2 + (wpZ - (-L/2)) * 0.4;
  const wNoseCtrl = model.noseWidth / 2;

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
      // Symmetrical wrap-in mirroring the nose
      cp.push([model.noseTipWidth / 4, 0, L/2]);
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
  ptsOutline.add(cp[0][0], cp[0][1], cp[0][2]);
  
  let lastZ = cp[0][2];
  for (let i = 1; i < cp.length; i++) {
      if (cp[i][2] - lastZ > 0.01) {
          ptsOutline.add(cp[i][0], cp[i][1], cp[i][2]);
          lastZ = cp[i][2];
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
  ptsRockerTop.add(0, T/2, wpZ - flatHalf); 
  ptsRockerTop.add(0, T/2, wpZ); 
  ptsRockerTop.add(0, T/2, wpZ + flatHalf); 
  ptsRockerTop.add(0, bottomPlane + model.tailRocker * 0.25 + model.tailThickness, L/2 - 12);
  ptsRockerTop.add(0, bottomPlane + model.tailRocker + tipThickness, L/2);
  const crvRockerTop = rhino.NurbsCurve.create(false, 3, ptsRockerTop);

  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker, -L/2);
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker * 0.25, -L/2 + 12);
  ptsRockerBottom.add(0, bottomPlane, wpZ - flatHalf);
  ptsRockerBottom.add(0, bottomPlane, wpZ);
  ptsRockerBottom.add(0, bottomPlane, wpZ + flatHalf);
  ptsRockerBottom.add(0, bottomPlane + model.tailRocker * 0.25, L/2 - 12);
  ptsRockerBottom.add(0, bottomPlane + model.tailRocker, L/2);
  const crvRockerBottom = rhino.NurbsCurve.create(false, 3, ptsRockerBottom);
   
  const sampleCurve = (crv: any, steps = 150) => {
      const pts: [number, number, number][] =[];
      if (!crv) return pts;
      const domain = crv.domain;
      for (let i = 0; i <= steps; i++) {
          const t = domain[0] + (domain[1] - domain[0]) * (i / steps);
          const p = crv.pointAt(t);
          pts.push([p[0], p[1], p[2]]);
      }
      return pts;
  };

  const outline = sampleCurve(crvOutline);
  const rockerTop = sampleCurve(crvRockerTop);
  const rockerBottom = sampleCurve(crvRockerBottom);

  // ====================================================================
  // 4. MESH END-CAPS
  // ====================================================================
  
  if (model.noseShape === "clipped" || model.noseShape === "torpedo") {
      // Draw a straight line from the stringer to the chopped tip corner to seal the mesh hole
      outline.unshift([0, 0, -L/2]);
  }
  
  if (model.tailType === "swallow") {
      // Cut the swallow tail directly to the stringer
      outline.push([0, 0, L/2 - model.swallowDepth]);
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
