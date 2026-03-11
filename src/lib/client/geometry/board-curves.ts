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

  // Calculate flat section for parallel rails
  let flatSpan = 0;
  if (model.noseShape === "clipped" || model.noseShape === "torpedo") {
      flatSpan = Math.min(10.0, L * 0.15);
  }
  const wpFront = wpZ - flatSpan;
  const wpBack = wpZ + flatSpan;
  const n12Z = -L/2 + 12;
  const t12Z = L/2 - 12;

  // --- 1. Nose Tip & Nose Curve Entry ---
  // For blunt boards, we stop the NURBS curve early and manually cap it later
  // to guarantee flawless procedural geometry without lofting artifacts.
  let noseCornerZ = -L/2;
  let noseTailW = 0;

  if (model.noseShape === "torpedo") {
      noseCornerZ = -L/2 + 3.5;
      noseTailW = model.noseWidth / 2 * 0.85;
      ptsOutline.add(noseTailW, 0, noseCornerZ);
  } else if (model.noseShape === "clipped") {
      noseCornerZ = -L/2 + 2.0;
      noseTailW = model.noseWidth / 2 * 0.75;
      ptsOutline.add(noseTailW, 0, noseCornerZ);
  } else {
      ptsOutline.add(0, 0, -L/2);
      if (model.noseShape === "pointy") {
          // Add a control point at N6 (6" from nose) to increase tip fullness
          const n6Z = -L/2 + 6.0;
          ptsOutline.add((model.noseWidth / 2) * 0.68, 0, n6Z);
      }
  }

  // --- 2. N12 (Nose Width at 12" from tip) ---
  ptsOutline.add(model.noseWidth / 2, 0, n12Z);

  // Mid-Nose smoothing (ONLY for pointy to preserve fullness. Clipped/Torpedo rely on natural NURBS spline)
  if (wpFront > n12Z && model.noseShape === "pointy") {
      const midNoseZ = (n12Z + wpFront) / 2;
      let midNoseW = (model.noseWidth/2 + model.width/2) / 2 * 1.05; // Standard slight outward bulge (increased to 1.05 for fuller nose)
      ptsOutline.add(midNoseW, 0, midNoseZ);
  }

  // --- 3. Wide Point ---
  if (flatSpan > 0) {
      ptsOutline.add(model.width / 2, 0, wpFront);
      ptsOutline.add(model.width / 2, 0, wpBack);
  } else {
      ptsOutline.add(model.width / 2, 0, wpZ);
  }

  // Mid-Tail smoothing (ONLY for standard tails)
  if (wpBack < t12Z && model.tailType !== "torpedo" && model.noseShape !== "clipped") {
      const midTailZ = (wpBack + t12Z) / 2;
      let midTailW = (model.width/2 + model.tailWidth/2) / 2;
          
      if (model.tailType === "pintail") {
          midTailW *= 0.95; 
      } else {
          midTailW *= 1.02;
      }
      ptsOutline.add(midTailW, 0, midTailZ);
  }
      
  // --- 4. T12 (Tail Width at 12" from tail) ---
  ptsOutline.add(model.tailWidth / 2, 0, t12Z);

  // --- 5. Tail Block / Tip ---
  let tailW = model.width * 0.3;
  let cornerZ = L/2;

  if (model.tailType === "pintail") {
      ptsOutline.add(0, 0, L/2);
      tailW = 0; // bypassed bezier caps
      cornerZ = L/2;
  } else if (model.tailType === "swallow") {
      tailW = model.tailWidth / 2 * 0.6;
      ptsOutline.add(tailW, 0, cornerZ);
  } else if (model.tailType === "squash") {
      tailW = model.tailWidth / 2 * 0.5;
      cornerZ = L/2 - model.squashCornerRadius;
      ptsOutline.add(tailW, 0, cornerZ);
  } else if (model.tailType === "round") {
      // Classic rounded pin: Fluid native NURBS curve directly to the sharp point
      ptsOutline.add(model.tailWidth / 2 * 0.45, 0, L/2 - 3.0);
      ptsOutline.add(0, 0, L/2);
      tailW = 0; // bypassed bezier caps
      cornerZ = L/2;
  } else if (model.tailType === "torpedo") {
      // Wider base for a symmetrical blunt pill
      tailW = model.tailWidth / 2 * 0.85;
      cornerZ = L/2 - 3.5;
      ptsOutline.add(tailW, 0, cornerZ);
  } else {
      ptsOutline.add(tailW, 0, cornerZ);
  }

  const crvOutline = rhino.NurbsCurve.create(false, 3, ptsOutline);

  // STEP 3: Dynamic Rocker Curves & Foil (Thickness Distribution)
  // We set tipThickness to 0.0 to collapse the mesh poles perfectly into a single mathematical point, fixing the 3D crease artifact.
  const tipThickness = 0.0; 
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

  // --- PREPEND NOSE CAPS ---
  if (model.noseShape === "torpedo" || model.noseShape === "clipped") {
      const steps = 15;
      const cap: [number, number, number][] = [];
      
      // Absolute tip to close the mesh hole
      cap.push([0, 0, -L/2]); 
      
      for (let i = 1; i < steps; i++) { 
          const t = i / steps;
          const invT = 1 - t;
          
          let p1x = noseTailW;
          if (model.noseShape === "clipped") p1x = noseTailW * 0.9;
          
          // Quadratic Bezier: P0=(0, -L/2), P1=(horizontal pull), P2=(NURBS start)
          const px = invT * invT * 0 + 2 * invT * t * p1x + t * t * noseTailW;
          const pz = invT * invT * (-L/2) + 2 * invT * t * (-L/2) + t * t * noseCornerZ;
          cap.push([px, 0, pz]);
      }
      outline.unshift(...cap);
  }

  // --- APPEND TAIL CAPS ---
  if (model.tailType === "swallow") {
      outline.push([0, 0, L/2 - model.swallowDepth]);
  } else if (model.tailType === "squash" || model.tailType === "torpedo") {
      const steps = 15;
      for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const invT = 1 - t;
          
          let p1x = tailW;
          let p2x = 0;
          let p1z = L/2;
          let p2z = L/2;
          
          if (model.tailType === "squash") {
              p1x = tailW * 0.95;
              p2x = tailW * 0.45; // Flat squash block
          } else if (model.tailType === "torpedo") {
              p1x = tailW * 0.95; // Stays wider longer, horizontal tangency at tip
          }
          
          const px = invT * invT * tailW + 2 * invT * t * p1x + t * t * p2x;
          const pz = invT * invT * cornerZ + 2 * invT * t * p1z + t * t * p2z;
          outline.push([px, 0, pz]);
      }
      
      // Critical Mesh Closing: Forces the lofting engine to map the open tail directly to the stringer
      if (model.tailType === "squash") {
          outline.push([0, 0, L/2]);
      }
  } else if (model.tailType === "round" || model.tailType === "pintail") {
      // Ensure the mesh is absolutely clamped to 0 on the Z-axis line for perfect lofting
      const lastP = outline[outline.length - 1];
      if (lastP && (lastP[2] < L/2 - 0.001 || Math.abs(lastP[0]) > 0.001)) {
          outline.push([0, 0, L/2]);
      }
  }

  return { outline, rockerTop, rockerBottom };
};
