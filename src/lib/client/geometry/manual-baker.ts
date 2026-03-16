import { Effect } from "effect";
import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import { generateBoardCurves, type BoardCurves } from "./board-curves";

const fitBezierZ = (points: Point3D[]): BezierCurveData => {
  if (points.length === 0) return { controlPoints: [], tangents1: [], tangents2: [] };

  const sorted = [...points].sort((a, b) => a[2] - b[2]);
  const minZ = sorted[0]![2];
  const maxZ = sorted[sorted.length - 1]![2];
  const L = maxZ - minZ;

  const fractions = [0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0];
  const anchors: Point3D[] = [];
  const indices: number[] = [];

  for (const t of fractions) {
    const targetZ = minZ + t * L;
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const dist = Math.abs(sorted[i]![2] - targetZ);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    anchors.push(sorted[closestIdx]!);
    indices.push(closestIdx);
  }

  const tangents1: Point3D[] = [];
  const tangents2: Point3D[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const idx = indices[i]!;
    const P = anchors[i]!;

    let dx = 0, dy = 0, dz = 0;
    if (idx === 0) {
      const next = sorted[idx + 1]!;
      dx = next[0] - P[0]; dy = next[1] - P[1]; dz = next[2] - P[2];
    } else if (idx === sorted.length - 1) {
      const prev = sorted[idx - 1]!;
      dx = P[0] - prev[0]; dy = P[1] - prev[1]; dz = P[2] - prev[2];
    } else {
      const next = sorted[idx + 1]!;
      const prev = sorted[idx - 1]!;
      dx = next[0] - prev[0]; dy = next[1] - prev[1]; dz = next[2] - prev[2];
    }

    let slopeX = 0, slopeY = 0;
    if (Math.abs(dz) > 0.0001) {
      slopeX = dx / dz;
      slopeY = dy / dz;
    }

    if (i === 0) {
      tangents1.push([...P]);
    } else {
      const prevP = anchors[i - 1]!;
      const distZ = (P[2] - prevP[2]) / 3;
      tangents1.push([
        P[0] - slopeX * Math.abs(distZ),
        P[1] - slopeY * Math.abs(distZ),
        P[2] - Math.abs(distZ)
      ]);
    }

    if (i === anchors.length - 1) {
      tangents2.push([...P]);
    } else {
      const nextP = anchors[i + 1]!;
      const distZ = (nextP[2] - P[2]) / 3;
      tangents2.push([
        P[0] + slopeX * Math.abs(distZ),
        P[1] + slopeY * Math.abs(distZ),
        P[2] + Math.abs(distZ)
      ]);
    }
  }

  return { controlPoints: anchors, tangents1, tangents2 };
};

const fitSliceBezierX = (pts: Point3D[]): BezierCurveData => {
  const t1: Point3D[] = [];
  const t2: Point3D[] = [];

  const distX = (pA: Point3D, pB: Point3D) => Math.abs(pA[0] - pB[0]) / 3;
  const distY = (pA: Point3D, pB: Point3D) => Math.abs(pA[1] - pB[1]) / 3;

  // P0: Stringer Bottom
  t1.push([...pts[0]!]);
  t2.push([pts[0]![0] + distX(pts[0]!, pts[1]!), pts[0]![1], pts[0]![2]]);

  // P1: Tuck Bottom
  let dx = pts[2]![0] - pts[0]![0];
  let dy = pts[2]![1] - pts[0]![1];
  let slope = Math.abs(dx) > 0.0001 ? dy / dx : 0;
  t1.push([pts[1]![0] - distX(pts[0]!, pts[1]!), pts[1]![1] - slope * distX(pts[0]!, pts[1]!), pts[1]![2]]);
  t2.push([pts[1]![0] + distX(pts[1]!, pts[2]!), pts[1]![1] + slope * distX(pts[1]!, pts[2]!), pts[1]![2]]);

  // P2: Rail Apex
  t1.push([pts[2]![0], pts[2]![1] - distY(pts[1]!, pts[2]!), pts[2]![2]]);
  t2.push([pts[2]![0], pts[2]![1] + distY(pts[2]!, pts[3]!), pts[2]![2]]);

  // P3: Deck Shoulder
  dx = pts[4]![0] - pts[2]![0];
  dy = pts[4]![1] - pts[2]![1];
  slope = Math.abs(dx) > 0.0001 ? dy / dx : 0;
  t1.push([pts[3]![0] - distX(pts[2]!, pts[3]!), pts[3]![1] - slope * distX(pts[2]!, pts[3]!), pts[3]![2]]);
  t2.push([pts[3]![0] + distX(pts[3]!, pts[4]!), pts[3]![1] + slope * distX(pts[3]!, pts[4]!), pts[3]![2]]);

  // P4: Deck Stringer
  t1.push([pts[4]![0] + distX(pts[3]!, pts[4]!), pts[4]![1], pts[4]![2]]);
  t2.push([...pts[4]!]);

  return { controlPoints: pts, tangents1: t1, tangents2: t2 };
};

export const extractCrossSectionsSS9000 = (model: BoardModel, curves: BoardCurves): BezierCurveData[] => {
  const slices: BezierCurveData[] = [];
  const fractions = [0.01, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 0.99];
  const L = model.length;
  
  if (curves.outline.length === 0) return slices;

  const minZ = curves.outline[0]![2];
  const maxZ = curves.outline[curves.outline.length - 1]![2];

  const getOutlineWidthAtZ = (zInches: number) => {
    for (let i = 0; i < curves.outline.length - 1; i++) {
      const p1 = curves.outline[i]!;
      const p2 = curves.outline[i+1]!;
      if (zInches >= p1[2] && zInches <= p2[2]) {
        if (p2[2] === p1[2]) return Math.max(p1[0], p2[0]);
        const t = (zInches - p1[2]) / (p2[2] - p1[2]);
        return p1[0] + t * (p2[0] - p1[0]);
      }
    }
    return 0;
  };

  const getRockerY = (zInches: number, isTop: boolean) => {
    const pts = isTop ? curves.rockerTop : curves.rockerBottom;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!; const p2 = pts[i+1]!;
      if (zInches >= p1[2] && zInches <= p2[2]) {
        const t = (zInches - p1[2]) / (p2[2] - p1[2]);
        return p1[1] + t * (p2[1] - p1[1]);
      }
    }
    return isTop ? pts[pts.length-1]![1] : pts[0]![1];
  };

  const smoothStep = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  fractions.forEach(t => {
    const zInches = minZ + t * L;
    const halfWidth = getOutlineWidthAtZ(zInches);
    const topY = getRockerY(zInches, true);
    const botY = getRockerY(zInches, false);
    const thickness = Math.max(0, topY - botY);
    const apexY = botY + thickness * model.apexRatio;

    const tailDist = Math.max(0, maxZ - zInches);
    const noseDist = Math.max(0, zInches - minZ);

    let railExp = 1.5 - model.railFullness;
    let deckExp = model.deckDome;
    const relaxZone = 2.0;
    if (noseDist < relaxZone) {
      const frac = noseDist / relaxZone;
      railExp = 1.0 - frac * (1.0 - railExp);
      deckExp = 1.0 - frac * (1.0 - deckExp);
    } else if (tailDist < relaxZone) {
      const frac = tailDist / relaxZone;
      railExp = 1.0 - frac * (1.0 - railExp);
      deckExp = 1.0 - frac * (1.0 - deckExp);
    }

    const nz = (zInches - minZ) / L;
    const blendVee = 1 - smoothStep(0.05, 0.4, nz);
    const blendConcave = smoothStep(0.15, 0.3, nz);
    const blendChannels = tailDist <= model.channelLength + 6.0 ? 1.0 - smoothStep(model.channelLength, model.channelLength + 6.0, tailDist) : 0;
    const widthFade = Math.max(0, Math.min(1.0, halfWidth / 1.0));

    const getContourY = (nx: number, isDeck: boolean): number => {
      const abs_cx = Math.pow(nx, 1 / railExp);
      const clamped_cx = Math.min(1, abs_cx);
      const abs_cy = Math.sqrt(1 - clamped_cx * clamped_cx);
      
      if (isDeck) {
        return apexY + Math.pow(abs_cy, deckExp) * (topY - apexY);
      }
      
      const py = apexY - Math.pow(abs_cy, 0.5) * (apexY - botY);
      
      let offset = 0;
      if (model.bottomContour === "vee_to_quad_channels") {
        const vee = -model.veeDepth * (1 - nx) * blendVee;
        const conc = model.concaveDepth * (1 - nx * nx) * blendConcave;
        let chan = 0;
        if (nx >= 0.2 && nx <= 0.8) {
          chan = model.channelDepth * Math.pow(Math.sin(((nx - 0.2) / 0.6) * Math.PI * 2), 2) * blendChannels;
        }
        offset = (vee + conc + chan) * widthFade;
      } else if (model.bottomContour === "single_to_double") {
        const single = model.concaveDepth * (1 - nx * nx);
        const double = model.concaveDepth * 0.8 * Math.pow(Math.sin(nx * Math.PI), 2);
        offset = (single * (1 - nz) + double * nz) * widthFade;
      } else if (model.bottomContour === "single") {
        offset = model.concaveDepth * (1 - nx * nx) * widthFade;
      }
      
      return py + (offset * abs_cy);
    };

    const pts: Point3D[] = [
      [0, getContourY(0.0, false), zInches],
      [0.75 * halfWidth, getContourY(0.75, false), zInches],
      [halfWidth, apexY, zInches],
      [0.75 * halfWidth, getContourY(0.75, true), zInches],
      [0, getContourY(0.0, true), zInches]
    ];

    slices.push(fitSliceBezierX(pts));
  });

  return slices;
};

export const bakeToManual = (model: BoardModel): Effect.Effect<{
  outline: BezierCurveData,
  rockerTop: BezierCurveData,
  rockerBottom: BezierCurveData,
  crossSections: BezierCurveData[]
}, Error> => Effect.gen(function* () {
  const curves = yield* Effect.tryPromise({
    try: () => generateBoardCurves(model),
    catch: (e) => new Error(String(e))
  });
  
  return {
    outline: fitBezierZ(curves.outline as Point3D[]),
    rockerTop: fitBezierZ(curves.rockerTop as Point3D[]),
    rockerBottom: fitBezierZ(curves.rockerBottom as Point3D[]),
    crossSections: extractCrossSectionsSS9000(model, curves)
  };
});
