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

  // Calculate flat section for parallel rails (ONLY for Clipped to prevent dogboning continuous curves)
  let flatSpan = 0;
  if (model.noseShape === "clipped") {
      flatSpan = Math.min(10.0, L * 0.15);
  }
  const wpFront = wpZ - flatSpan;
  const wpBack = wpZ + flatSpan;
  const n12Z = -L/2 + 12;
  const t12Z = L/2 - 12;

  // --- 1. Nose Tip & Nose Curve Entry ---
  if (model.noseShape === "clipped") {
      ptsOutline.add(model.noseWidth * 0.46, 0, -L/2);
      ptsOutline.add(model.noseWidth * 0.49, 0, -L/2 + 1.5); 
  } else if (model.noseShape === "torpedo") {
      ptsOutline.add(0, 0, -L/2);
      // Strong outward horizontal tangent to create a convex pill nose
      ptsOutline.add(model.noseWidth/2 * 0.95, 0, -L/2); 
  } else {
      ptsOutline.add(0, 0, -L/2);
  }

  // --- 2. N12 (Nose Width at 12" from tip) ---
  if (model.noseShape === "torpedo") {
      // Push control point OUTWARD by 2% to ensure the curve is taut and convex
      ptsOutline.add(Math.min(model.noseWidth/2 * 1.02, model.width/2 * 0.99), 0, n12Z);
  } else {
      ptsOutline.add(model.noseWidth / 2, 0, n12Z);
  }

  // Mid-Nose smoothing
  if (wpFront > n12Z) {
      const midNoseZ = (n12Z + wpFront) / 2;
      let midNoseW = (model.noseWidth/2 + model.width/2) / 2;
          
      if (model.noseShape === "clipped") {
          midNoseW = model.noseWidth/2 + (model.width/2 - model.noseWidth/2) * 0.85; 
      } else if (model.noseShape === "torpedo") {
          // Perfect mathematical halfway point for a smooth ellipse-like flow
          midNoseW = model.noseWidth/2 + (model.width/2 - model.noseWidth/2) * 0.60;
      } else {
          midNoseW *= 1.02; // Standard slight outward bulge
      }
      ptsOutline.add(midNoseW, 0, midNoseZ);
  }

  // --- 3. Wide Point ---
  if (flatSpan > 0) {
      ptsOutline.add(model.width / 2, 0, wpFront);
      ptsOutline.add(model.width / 2, 0, wpBack);
  } else {
      ptsOutline.add(model.width / 2, 0, wpZ);
  }

  // Mid-Tail smoothing
  if (wpBack < t12Z) {
      const midTailZ = (wpBack + t12Z) / 2;
      let midTailW = (model.width/2 + model.tailWidth/2) / 2;
          
      if (model.noseShape === "clipped" && model.tailType !== "pintail") {
          midTailW = model.tailWidth/2 + (model.width/2 - model.tailWidth/2) * 0.85;
      } else if (model.tailType === "torpedo") {
          midTailW = model.tailWidth/2 + (model.width/2 - model.tailWidth/2) * 0.60;
      } else if (model.tailType === "pintail") {
          midTailW *= 0.95; 
      } else {
          midTailW *= 1.02;
      }
      ptsOutline.add(midTailW, 0, midTailZ);
  }
      
  // --- 4. T12 (Tail Width at 12" from tail) ---
  if (model.tailType === "torpedo") {
      // Push control point OUTWARD by 2% to ensure curve is taut
      ptsOutline.add(Math.min(model.tailWidth/2 * 1.02, model.width/2 * 0.99), 0, t12Z);
  } else {
      ptsOutline.add(model.tailWidth / 2, 0, t12Z);
  }

  // --- 5. Tail Block / Tip ---
  let tailW = model.width * 0.3;
  let cornerZ = L/2;

  if (model.tailType === "pintail") {
      tailW = 0;
  } else if (model.tailType === "swallow") {
      tailW = model.tailWidth / 2 * 0.6;
  } else if (model.tailType === "squash") {
      tailW = model.tailWidth / 2 * 0.5;
      cornerZ = L/2 - model.squashCornerRadius;
  }

  if (model.tailType === "round") {
      ptsOutline.add(model.tailWidth / 2 * 0.4, 0, L/2 - 2); 
      ptsOutline.add(0, 0, L/2);
  } else if (model.tailType === "torpedo") {
      ptsOutline.add(model.tailWidth / 2 * 0.95, 0, L/2); 
      ptsOutline.add(0, 0, L/2);
  } else {
      ptsOutline.add(tailW, 0, cornerZ);
  }

  const crvOutline = rhino.NurbsCurve.create(false, 3, ptsOutline);

  // STEP 3: Dynamic Rocker Curves & Foil (Thickness Distribution)
  const tipThickness = 0.15; // Real surfboards taper to ~0.15" at the tips
  const bottomPlane = -T / 2; // Physical rocker is measured from the lowest point of the belly
  const flatHalf = model.rockerFlatSpotLength / 2;

  // Top Curve (Foil Thickness)
  const ptsRockerTop = new rhino.Point3dList();
  ptsRockerTop.add(0, bottomPlane + model.noseRocker + tipThickness, -L/2); // Nose Tip
  ptsRockerTop.add(0, bottomPlane + model.noseRocker * 0.25 + model.noseThickness, -L/2 + 12); // N12 Foil Thickness
  ptsRockerTop.add(0, T/2, wpZ - flatHalf); // Center Deck Flat Front
  ptsRockerTop.add(0, T/2, wpZ); // Center Deck
  ptsRockerTop.add(0, T/2, wpZ + flatHalf); // Center Deck Flat Back
  ptsRockerTop.add(0, bottomPlane + model.tailRocker * 0.25 + model.tailThickness, L/2 - 12); // T12 Foil Thickness
  ptsRockerTop.add(0, bottomPlane + model.tailRocker + tipThickness, L/2); // Tail Tip
  const crvRockerTop = rhino.NurbsCurve.create(false, 3, ptsRockerTop);

  // Bottom Curve (Rocker)
  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker, -L/2);
  ptsRockerBottom.add(0, bottomPlane + model.noseRocker * 0.25, -L/2 + 12);
  ptsRockerBottom.add(0, bottomPlane, wpZ - flatHalf); // Staged Belly Start
  ptsRockerBottom.add(0, bottomPlane, wpZ);
  ptsRockerBottom.add(0, bottomPlane, wpZ + flatHalf); // Staged Belly End
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

  ptsOutline.delete();
  if (crvOutline) crvOutline.delete();
  ptsRockerTop.delete();
  if (crvRockerTop) crvRockerTop.delete();
  ptsRockerBottom.delete();
  if (crvRockerBottom) crvRockerBottom.delete();

  if (model.tailType === "swallow") {
      // Add a sharp V cut for the swallow tail returning to the center line
      outline.push([0, 0, L/2 - model.swallowDepth]);
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
