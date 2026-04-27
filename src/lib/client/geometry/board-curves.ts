// File: src/lib/client/geometry/board-curves.ts
 
import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import { MeshGeneratorService } from "./mesh-generator";

export interface BoardCurves {
  outline: [number, number, number][];
  rockerTop:[number, number, number][];
  rockerBottom:[number, number, number][];
}

export const deps = {};

const sampleCurve = (bezier: BezierCurveData | undefined, steps: number = 100): [number, number, number][] => {
    const pts: [number, number, number][] =[];
    if (!bezier || bezier.controlPoints.length === 0) return pts;
    const numSegments = bezier.controlPoints.length - 1;
    if (numSegments <= 0) return [bezier.controlPoints[0]!];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const scaledT = t * numSegments;
        let segmentIdx = Math.floor(scaledT);
        if (segmentIdx >= numSegments) segmentIdx = numSegments - 1;
        const localT = scaledT - segmentIdx;
        
        const P0 = bezier.controlPoints[segmentIdx]!;
        const P1 = bezier.controlPoints[segmentIdx + 1]!;
        const T0 = bezier.tangents2[segmentIdx]!;
        const T1 = bezier.tangents1[segmentIdx + 1]!;
        
        const u = 1 - localT, tt = localT*localT, uu = u*u, uuu = uu*u, ttt = tt*localT;
        const x = uuu * P0[0] + 3 * uu * localT * T0[0] + 3 * u * tt * T1[0] + ttt * P1[0];
        const y = uuu * P0[1] + 3 * uu * localT * T0[1] + 3 * u * tt * T1[1] + ttt * P1[1];
        const z = uuu * P0[2] + 3 * uu * localT * T0[2] + 3 * u * tt * T1[2] + ttt * P1[2];
        pts.push([x, y, z]);
    }
    return pts;
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
  const T0 = bezier.tangents2[segmentIdx] || [0, 0, 0];
  const T1 = bezier.tangents1[segmentIdx + 1] || [0, 0, 0];

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

export const generateBoardCurves = (model: BoardModel): Promise<BoardCurves> => {
  const steps = 100;
  const compositeOutline: Point3D[] = [];
  const { outline, rockerTop, rockerBottom } = model;

  if (outline && outline.controlPoints.length > 0) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const basePoint = evaluateBezier3D(outline, t);
      const zInches = basePoint[2];
      
      const compositePoint = MeshGeneratorService.evaluateCompositeOutlineAtZ(model, zInches, t);
      compositeOutline.push(compositePoint);
    }
  }

  return Promise.resolve({
    outline: compositeOutline,
    rockerTop: sampleCurve(rockerTop, steps),
    rockerBottom: sampleCurve(rockerBottom, steps)
  });
};
