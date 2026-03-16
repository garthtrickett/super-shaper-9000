import { Effect } from "effect";
import type { BoardModel, BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import { generateBoardCurves, type BoardCurves } from "./board-curves";

const fitBezierZ = (points: Point3D[]): BezierCurveData => {
  if (points.length === 0) return { controlPoints: [], tangents1: [], tangents2: [] };

  // 1. Clean data: Remove exact 3D duplicates to prevent division by zero,
  // but KEEP identical Zs if X/Y differ (vital for squash/square tails).
  const cleanPoints: Point3D[] = [];
  for (const p of points) {
    if (cleanPoints.length === 0) {
      cleanPoints.push(p);
    } else {
      const last = cleanPoints[cleanPoints.length - 1]!;
      const dist = Math.sqrt(Math.pow(p[0]-last[0],2) + Math.pow(p[1]-last[1],2) + Math.pow(p[2]-last[2],2));
      if (dist > 0.001) cleanPoints.push(p);
    }
  }

  if (cleanPoints.length < 2) {
    return { controlPoints: cleanPoints, tangents1: cleanPoints.map(p => [...p]), tangents2: cleanPoints.map(p => [...p]) };
  }

  const minZ = cleanPoints[0]![2];
  const maxZ = cleanPoints[cleanPoints.length - 1]![2];
  const L = maxZ - minZ;

  // 2. Select strategic anchor stations
  const fractions = [0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0];
  const anchors: Point3D[] = [];

  for (const t of fractions) {
    const targetZ = minZ + t * L;
    let closestPt = cleanPoints[0]!;
    let minDist = Infinity;
    for (let i = 0; i < cleanPoints.length; i++) {
      const dist = Math.abs(cleanPoints[i]![2] - targetZ);
      if (dist < minDist) {
        minDist = dist;
        closestPt = cleanPoints[i]!;
      }
    }
    // Prevent duplicate anchors if fractions are too close
    if (anchors.length === 0 || Math.abs(anchors[anchors.length - 1]![2] - closestPt[2]) > 0.1) {
      anchors.push([...closestPt]);
    }
  }

  const tangents1: Point3D[] = [];
  const tangents2: Point3D[] = [];

  const getDist = (a: Point3D, b: Point3D) => 
    Math.sqrt(Math.pow(a[0]-b[0], 2) + Math.pow(a[1]-b[1], 2) + Math.pow(a[2]-b[2], 2));

  // 3. Catmull-Rom style Tangent Generation (Distance-scaled, NO division by dz)
  for (let i = 0; i < anchors.length; i++) {
    const P = anchors[i]!;
    
    let dirX = 0, dirY = 0, dirZ = 1;

    if (i === 0) {
      const next = anchors[i + 1]!;
      const d = getDist(P, next);
      if (d > 0) { dirX = (next[0]-P[0])/d; dirY = (next[1]-P[1])/d; dirZ = (next[2]-P[2])/d; }
    } else if (i === anchors.length - 1) {
      const prev = anchors[i - 1]!;
      const d = getDist(prev, P);
      if (d > 0) { dirX = (P[0]-prev[0])/d; dirY = (P[1]-prev[1])/d; dirZ = (P[2]-prev[2])/d; }
    } else {
      const next = anchors[i + 1]!;
      const prev = anchors[i - 1]!;
      const d = getDist(prev, next);
      if (d > 0) { dirX = (next[0]-prev[0])/d; dirY = (next[1]-prev[1])/d; dirZ = (next[2]-prev[2])/d; }
    }

    // Tangent 1 (Left Handle)
    if (i === 0) {
      tangents1.push([...P]);
    } else {
      const prev = anchors[i - 1]!;
      const d0 = getDist(prev, P);
      const handleLen = d0 / 3;
      const t1: Point3D = [
        P[0] - dirX * handleLen,
        P[1] - dirY * handleLen,
        P[2] - dirZ * handleLen
      ];
      // CRITICAL: Force monotonic Z so `evaluateBezierAtZ` binary search doesn't fail.
      // Do not use static offsets (like 0.001), as points can be closer than that at the tail!
      t1[2] = Math.max(prev[2], Math.min(P[2], t1[2]));
      tangents1.push(t1);
    }

    // Tangent 2 (Right Handle)
    if (i === anchors.length - 1) {
      tangents2.push([...P]);
    } else {
      const next = anchors[i + 1]!;
      const d1 = getDist(P, next);
      const handleLen = d1 / 3;
      const t2: Point3D = [
        P[0] + dirX * handleLen,
        P[1] + dirY * handleLen,
        P[2] + dirZ * handleLen
      ];
      // CRITICAL: Force monotonic Z strictly inside bounds
      t2[2] = Math.max(P[2], Math.min(next[2], t2[2]));
      tangents2.push(t2);
    }
  }

  // 4. Force stringer locks for the absolute tips ONLY if they naturally converge to 0 (Pintails/Nose)
  if (anchors.length > 0) {
    if (Math.abs(anchors[0]![0]) < 0.05) {
      anchors[0]![0] = 0; 
      tangents1[0]![0] = 0; 
      tangents2[0]![0] = 0;
    }

    const last = anchors.length - 1;
    if (Math.abs(anchors[last]![0]) < 0.05) {
      anchors[last]![0] = 0;
      tangents1[last]![0] = 0;
      tangents2[last]![0] = 0;
    }
  }

  return { controlPoints: anchors, tangents1, tangents2 };
};

const getDist2D = (pA: Point3D, pB: Point3D) => Math.sqrt(Math.pow(pA[0]-pB[0], 2) + Math.pow(pA[1]-pB[1], 2));

const fitSliceBezierX = (pts: Point3D[]): BezierCurveData => {
  const t1: Point3D[] = [];
  const t2: Point3D[] = [];

  // P0: Stringer Bottom (Flat)
  t1.push([...pts[0]!]);
  t2.push([pts[0]![0] + Math.abs(pts[1]![0] - pts[0]![0])/3, pts[0]![1], pts[0]![2]]);

  // P1: Tuck Bottom
  let dirX = pts[2]![0] - pts[0]![0];
  let dirY = pts[2]![1] - pts[0]![1];
  let len = Math.sqrt(dirX*dirX + dirY*dirY);
  if (len > 0.0001) { dirX /= len; dirY /= len; } else { dirX = 1; dirY = 0; }
  let d0 = getDist2D(pts[0]!, pts[1]!) / 3;
  t1.push([pts[1]![0] - dirX * d0, pts[1]![1] - dirY * d0, pts[1]![2]]);
  let d1 = getDist2D(pts[1]!, pts[2]!) / 3;
  t2.push([pts[1]![0] + dirX * d1, pts[1]![1] + dirY * d1, pts[1]![2]]);

  // P2: Rail Apex (Vertical)
  t1.push([pts[2]![0], pts[2]![1] - Math.abs(pts[2]![1] - pts[1]![1])/3, pts[2]![2]]);
  t2.push([pts[2]![0], pts[2]![1] + Math.abs(pts[3]![1] - pts[2]![1])/3, pts[2]![2]]);

  // P3: Deck Shoulder
  dirX = pts[4]![0] - pts[2]![0];
  dirY = pts[4]![1] - pts[2]![1];
  len = Math.sqrt(dirX*dirX + dirY*dirY);
  if (len > 0.0001) { dirX /= len; dirY /= len; } else { dirX = -1; dirY = 0; }
  d0 = getDist2D(pts[2]!, pts[3]!) / 3;
  t1.push([pts[3]![0] - dirX * d0, pts[3]![1] - dirY * d0, pts[3]![2]]);
  d1 = getDist2D(pts[3]!, pts[4]!) / 3;
  t2.push([pts[3]![0] + dirX * d1, pts[3]![1] + dirY * d1, pts[3]![2]]);

  // P4: Deck Stringer (Flat)
  t1.push([pts[4]![0] - Math.abs(pts[4]![0] - pts[3]![0])/3, pts[4]![1], pts[4]![2]]);
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

  // --- FIX: Strip non-differentiable end-caps ---
  // The parametric model adds 90-degree stringer closures and backward swallow cuts.
  // These destroy Bezier tangents. We remove them so the curve cleanly represents the rail.
  const cleanOutline = [...curves.outline];
  while (cleanOutline.length > 2) {
    const last = cleanOutline[cleanOutline.length - 1]!;
    const prev = cleanOutline[cleanOutline.length - 2]!;
    
    // 1. Strip Z-backtracking (Swallow tail caps)
    if (last[2] < prev[2]) {
        cleanOutline.pop();
        continue;
    }
    
    // 2. Strip 90-degree stringer caps (Squash/Square tails)
    if (Math.abs(last[2] - prev[2]) < 0.001 && last[0] === 0 && prev[0] > 0.01) {
        cleanOutline.pop();
        continue;
    }
    
    break;
  }
  
  // Check nose too just in case (e.g. blunt torpedo noses)
  while (cleanOutline.length > 2) {
    const first = cleanOutline[0]!;
    const second = cleanOutline[1]!;
    if (Math.abs(first[2] - second[2]) < 0.001 && first[0] === 0 && second[0] > 0.01) {
        cleanOutline.shift();
        continue;
    }
    break;
  }
  
  return {
    outline: fitBezierZ(cleanOutline as Point3D[]),
    rockerTop: fitBezierZ(curves.rockerTop as Point3D[]),
    rockerBottom: fitBezierZ(curves.rockerBottom as Point3D[]),
    crossSections: extractCrossSectionsSS9000(model, curves)
  };
});
