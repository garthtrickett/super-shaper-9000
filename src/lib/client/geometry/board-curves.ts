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
  
  let tailW = W * 0.3;
  let cornerZ = L/2;

  if (model.tailType === "pintail") {
      tailW = 0; // Pintails converge to a perfect point at the center
  } else if (model.tailType === "swallow") {
      tailW = W * 0.35;
  } else if (model.tailType === "squash") {
      tailW = W * 0.28;
      cornerZ = L/2 - 0.75; // Stop the rail curve early to form the squash tail block
  }

  const ptsOutline = new rhino.Point3dList();
  
  // STEP 2: Wide Point Shift (Negative Z is nose direction)
  // A widePointOffset of +2 means shift the wide point 2 inches towards the nose (-2)
  const wpZ = -model.widePointOffset; 

  // STEP 2: Nose Logic
  if (model.noseShape === "torpedo") {
      // Rounded, full "bullet" or "torpedo" nose
      ptsOutline.add(0, 0, -L/2);
      // Force tangent perpendicular to stringer at the tip for a smooth rounded nose
      ptsOutline.add(W/2 * 0.45, 0, -L/2); 
      ptsOutline.add(W/2 * 0.85, 0, -L/4 + wpZ/2);
  } else {
      // Standard Pointy Nose
      ptsOutline.add(0, 0, -L/2);
      ptsOutline.add(W/2 * 0.6, 0, -L/4 + wpZ/2);
  }

  // The Wide Point (now dynamically placed)
  ptsOutline.add(W/2, 0, wpZ);

  let cp4X = W/2 * 0.8;
  if (model.tailType === "pintail") cp4X = W/2 * 0.6;
  
  // Point halfway to the tail (Must be added before tail12Z to maintain monotonic Z-order)
  ptsOutline.add(cp4X, 0, L/4 + wpZ/2);
  
  // STEP 2: Tail Pull-in (Strictly control the width at 12 inches from the tail)
  const tail12Z = L/2 - 12;
  const tail12W = (model.tailType === "round" || model.tailType === "pintail") 
      ? W/2 * 0.65 // Aggressively pull in the width for hold
      : W/2 * 0.75; // Standard pull-in for squash/swallow
  
  ptsOutline.add(tail12W, 0, tail12Z);

  if (model.tailType === "round") {
      ptsOutline.add(W/2 * 0.25, 0, L/2 - 2); // Tight curve for the needle pin
      ptsOutline.add(0, 0, L/2);
  } else {
      ptsOutline.add(tailW, 0, cornerZ);
  }

  const crvOutline = rhino.NurbsCurve.create(false, 3, ptsOutline);

  // STEP 3: Dynamic Rocker Curves & Foil (Thickness Distribution)
  const tipThickness = 0.15; // Real surfboards taper to ~0.15" at the tips
  const bottomPlane = -T / 2; // Physical rocker is measured from the lowest point of the belly

  const ptsRockerTop = new rhino.Point3dList();
  // Nose: Foil tapers down cleanly to meet the rocker
  ptsRockerTop.add(0, bottomPlane + model.noseRocker + tipThickness, -L/2);
  // Flatten center control points to create a fast "belly"
  ptsRockerTop.add(0, T/2, -L/4 + wpZ); 
  ptsRockerTop.add(0, T/2, wpZ);
  ptsRockerTop.add(0, T/2, L/4 + wpZ);
  // Tail: Foil tapers down to meet the tail rocker
  ptsRockerTop.add(0, bottomPlane + model.tailRocker + tipThickness, L/2);
  const crvRockerTop = rhino.NurbsCurve.create(false, 3, ptsRockerTop);

  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker, -L/2);
  ptsRockerBottom.add(0, bottomPlane, -L/4 + wpZ);
  ptsRockerBottom.add(0, bottomPlane, wpZ);
  ptsRockerBottom.add(0, bottomPlane, L/4 + wpZ);
  ptsRockerBottom.add(0, bottomPlane + model.tailRocker, L/2);
  const crvRockerBottom = rhino.NurbsCurve.create(false, 3, ptsRockerBottom);

   
  const sampleCurve = (crv: any, steps = 50) => {
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

  ptsOutline.delete();
  if (crvOutline) crvOutline.delete();
  ptsRockerTop.delete();
  if (crvRockerTop) crvRockerTop.delete();
  ptsRockerBottom.delete();
  if (crvRockerBottom) crvRockerBottom.delete();

  if (model.tailType === "swallow") {
      // Add a sharp V cut for the swallow tail returning to the center line
      const swallowDepth = W * 0.2; // roughly 3.5 to 4.5 inches deep depending on board width
      outline.push([0, 0, L/2 - swallowDepth]);
  } else if (model.tailType === "squash") {
      // Generate a smooth rounded curve for the squash tail block
      const steps = 8;
      for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const invT = 1 - t;
          // Quadratic bezier: P0=(tailW, cornerZ), P1=(tailW*0.95, L/2), P2=(0, L/2)
          const px = invT * invT * tailW + 2 * invT * t * (tailW * 0.95) + t * t * 0;
          const pz = invT * invT * cornerZ + 2 * invT * t * (L/2) + t * t * (L/2);
          outline.push([px, 0, pz]);
      }
  }

  return { outline, rockerTop, rockerBottom };
};
