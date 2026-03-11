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
  
  const ptsOutline = new rhino.Point3dList();
  
  // Wide Point Shift (Negative Z is nose direction)
  const wpZ = -model.widePointOffset; 

  // --- 1. Nose Tip & Nose Curve Entry ---
  if (model.noseShape === "clipped") {
      // Blunt / Chopped Tomo nose
      ptsOutline.add(model.noseWidth * 0.38, 0, -L/2);
      ptsOutline.add(model.noseWidth * 0.42, 0, -L/2 + 2.0); // Keep it wide right at the tip
  } else if (model.noseShape === "torpedo") {
      ptsOutline.add(0, 0, -L/2);
      ptsOutline.add(model.noseWidth/2 * 0.7, 0, -L/2 + 2.0); 
  } else {
      // Pointy
      ptsOutline.add(0, 0, -L/2);
  }

  // --- 2. N12 (Nose Width at 12" from tip) ---
  ptsOutline.add(model.noseWidth / 2, 0, -L/2 + 12);

  // Mid-Nose smoothing (between N12 and Wide Point) to maintain volume forward
  const midNoseZ = (-L/2 + 12 + wpZ) / 2;
  const midNoseW = (model.noseWidth/2 + model.width/2) / 2 * 1.02; // slight outward bulge
  ptsOutline.add(midNoseW, 0, midNoseZ);

  // --- 3. Wide Point ---
  ptsOutline.add(model.width / 2, 0, wpZ);

  // Mid-Tail smoothing (between Wide Point and T12)
  const midTailZ = (wpZ + L/2 - 12) / 2;
  let midTailW = (model.width/2 + model.tailWidth/2) / 2 * 1.02;
  if (model.tailType === "pintail") midTailW *= 0.95; // pull it in more for pints
  ptsOutline.add(midTailW, 0, midTailZ);
  
  // --- 4. T12 (Tail Width at 12" from tail) ---
  ptsOutline.add(model.tailWidth / 2, 0, L/2 - 12);

  // --- 5. Tail Block / Tip ---
  let tailW = model.width * 0.3;
  let cornerZ = L/2;

  if (model.tailType === "pintail") {
      tailW = 0;
  } else if (model.tailType === "swallow") {
      tailW = model.tailWidth / 2 * 0.6; // Scale tail block based on T12
  } else if (model.tailType === "squash") {
      tailW = model.tailWidth / 2 * 0.5;
      cornerZ = L/2 - 0.75; // Stop curve early to form squash corners
  }

  if (model.tailType === "round") {
      ptsOutline.add(model.tailWidth / 2 * 0.4, 0, L/2 - 2); // Tight pin curve
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
