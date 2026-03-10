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
  if (model.tailType === "pintail") tailW = W * 0.05;
  if (model.tailType === "round") tailW = W * 0.2;
  if (model.tailType === "swallow") tailW = W * 0.35;

  const ptsOutline = new rhino.Point3dList();
  ptsOutline.add(0, 0, -L/2);
  ptsOutline.add(W/2, 0, -L/4);
  ptsOutline.add(W/2, 0, 0);
  ptsOutline.add(W/2 * 0.8, 0, L/4);
  ptsOutline.add(tailW, 0, L/2);

  const crvOutline = rhino.NurbsCurve.create(false, 3, ptsOutline);

  const ptsRockerTop = new rhino.Point3dList();
  ptsRockerTop.add(0, 5, -L/2);
  ptsRockerTop.add(0, T/2, 0);
  ptsRockerTop.add(0, 2, L/2);
  const crvRockerTop = rhino.NurbsCurve.create(false, 2, ptsRockerTop);

  const ptsRockerBottom = new rhino.Point3dList();
  ptsRockerBottom.add(0, 5, -L/2);
  ptsRockerBottom.add(0, -T/2, 0);
  ptsRockerBottom.add(0, 2, L/2);
  const crvRockerBottom = rhino.NurbsCurve.create(false, 2, ptsRockerBottom);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sampleCurve = (crv: any, steps = 50) => {
      const pts: [number, number, number][] =[];
      if (!crv) return pts;
      
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const domain = crv.domain;
      for (let i = 0; i <= steps; i++) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const t = domain[0] + (domain[1] - domain[0]) * (i / steps);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const p = crv.pointAt(t);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

  return { outline, rockerTop, rockerBottom };
};
