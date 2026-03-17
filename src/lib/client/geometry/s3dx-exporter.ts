import { Effect } from "effect";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";
import { clientLog } from "../clientLog";

const INCHES_TO_CM = 2.54;

/**
 * Translates Super Shaper 9000 [X, Y, Z] (inches) to Shape3d [X, Y, Z] (cm)
 * 
 * SS9000:
 * - X: Width (0 at stringer)
 * - Y: Thickness (0 at center of board, bottom is -T/2)
 * - Z: Length (0 at center, -L/2 at nose, +L/2 at tail)
 * 
 * Shape3d:
 * - X: Length (0 at Absolute Tail, +L at Nose)
 * - Y: Width (0 at stringer)
 * - Z: Thickness (0 at bottom bounding box)
 */
export const translateToShape3d = (
  [x, y, z]: [number, number, number],
  boardLengthInches: number,
  boardThicknessInches: number
): [number, number, number] => {
  // 1. X_s3d (Length): Distance from tail. Tail in SS9000 is +L/2.
  const x_s3d = (boardLengthInches / 2 - z) * INCHES_TO_CM;
  
  // 2. Y_s3d (Width): Maps directly from X_ss9000
  const y_s3d = x * INCHES_TO_CM;
  
  // 3. Z_s3d (Thickness): Offset so bottom plane (-T/2) is at 0
  const z_s3d = (y + boardThicknessInches / 2) * INCHES_TO_CM;

  // Format to 6 decimal places as requested by .s3dx spec precision
  return [
    Number(x_s3d.toFixed(6)),
    Number(y_s3d.toFixed(6)),
    Number(z_s3d.toFixed(6))
  ];
};

export const exportS3dx = (model: BoardModel, curves: BoardCurves): Effect.Effect<string> => 
  Effect.gen(function* () {
    yield* clientLog("info", "[s3dx-exporter] Starting Step 1: Coordinate Translation Pipeline");
    
    // Test the mapping on critical boundary points to verify translation math
    const tailPoint = curves.outline[curves.outline.length - 1];
    const nosePoint = curves.outline[0];
    
    if (tailPoint && nosePoint) {
      const tailS3d = translateToShape3d(tailPoint, model.length, model.thickness);
      const noseS3d = translateToShape3d(nosePoint, model.length, model.thickness);
      
      yield* clientLog("debug", "[s3dx-exporter] Coordinate Translation Validation", {
        ss9000_tail: tailPoint,
        s3d_tail: tailS3d,
        ss9000_nose: nosePoint,
        s3d_nose: noseS3d
      });
    }

    // Step 2: Translate dense NURBS points to Shape3d World Coordinates
    // We map Outline, Rocker Bottom, and Rocker Top
    const mapCurve = (curve: [number, number, number][], flattenZ: boolean = false) => 
      curve.map(p => {
        const pt = translateToShape3d(p, model.length, model.thickness);
        if (flattenZ) pt[2] = 0.000000;
        return pt;
      });

    // Shape3D requires the Outline curve to be strictly 2D at Z=0
    const outlineS3d = mapCurve(curves.outline, true);
    const botS3d = mapCurve(curves.rockerBottom);
    const deckS3d = mapCurve(curves.rockerTop);

    // Generate Cubic Beziers via Curve Fitting
    const otlBezier = fitBezier(outlineS3d);
    const botBezier = fitBezier(botS3d);
    const deckBezier = fitBezier(deckS3d);

    yield* clientLog("debug", "[s3dx-exporter] Bezier Curves Generated", { 
      outlineAnchors: otlBezier.controlPoints.length,
      bottomAnchors: botBezier.controlPoints.length
    });

    // Step 3 & 4: XML Serialization & Metadata Injection
    return `<?xml version="1.0" encoding="iso-8859-1"?>
<Shape3d_design>
	<Board>
		<Version>9</Version>
		<VersionNumber>9.1.1.2</VersionNumber>
		<Name>SuperShaper_${model.length.toFixed(1)}_${model.tailType}</Name>
		<Author>Super Shaper 9000</Author>
		<Comment>Generated parametrically</Comment>
		<Length>${(model.length * INCHES_TO_CM).toFixed(3)}</Length>
		<Width>${(model.width * INCHES_TO_CM).toFixed(3)}</Width>
		<Thickness>${(model.thickness * INCHES_TO_CM).toFixed(3)}</Thickness>
		<Tail_rocker>${(model.tailRocker * INCHES_TO_CM).toFixed(3)}</Tail_rocker>
		<Nose_rocker>${(model.noseRocker * INCHES_TO_CM).toFixed(3)}</Nose_rocker>
		<Volume>${model.volume.toFixed(3)}</Volume>
		<Symmetry>6</Symmetry>
${serializeBezier3d("Otl", "", 1, otlBezier, model.length)}
${serializeBezier3d("StrBot", "Stringer Bot", 2, botBezier, model.length)}
${serializeBezier3d("StrDeck", "Stringer Top", 2, deckBezier, model.length)}
		<Number_of_slices>8</Number_of_slices>
${bakeCrossSections(model, curves)}
	</Board>
</Shape3d_design>`;
  });

// --- STEP 2 UTILITIES: Curve Fitting & XML Serialization ---

export interface S3DBezier {
  controlPoints: [number, number, number][];
  tangents1: [number, number, number][]; // Incoming (left) handles
  tangents2: [number, number, number][]; // Outgoing (right) handles
}

/**
 * Evaluates procedural formulas at 8 strategic lengths to bake dynamic math into static Slices.
 */
export const bakeCrossSections = (model: BoardModel, curves: BoardCurves): string => {
  const slices: string[] = [];
  
  // 8 Strategic Stations along the board. 
  // Shape3D requires Couples_0 to be at the TAIL (t=0.99) and Couples_7 at the NOSE (t=0.01)
  const fractions = [0.99, 0.95, 0.8, 0.6, 0.4, 0.2, 0.05, 0.01];
  
  const L = model.length;
  const minZ = curves.outline[0]![2];
  const maxZ = curves.outline[curves.outline.length - 1]![2];
  
  // --- Helper math ported from board-viewport.ts ---
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

  // Generate each cross-section
  fractions.forEach((t, index) => {
    const zInches = minZ + t * L;
    const x_s3d = (L / 2 - zInches) * INCHES_TO_CM;
    
    const halfWidth = getOutlineWidthAtZ(zInches);
    const topY = getRockerY(zInches, true);
    const botY = getRockerY(zInches, false);
    
    const thickness = Math.max(0, topY - botY);
    const apexY = botY + thickness * model.apexRatio;

    const tailDist = Math.max(0, maxZ - zInches);
    const noseDist = Math.max(0, zInches - minZ);

    // Polar relaxation to prevent creases at tips
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

    // Extracts the precise vertical Y coordinate given an X fraction (nx)
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

    // Baseline for Z MUST be exactly the bottom stringer to satisfy Shape3D's relative Z-coordinate requirement
    const baselineY = getContourY(0.0, false);
    
    // Calculate absolute Z center of the board at this slice for Shape3D's Symmetry_center
    const centerZ = (((topY + botY) / 2) + model.thickness / 2) * INCHES_TO_CM;

    // The 5 key points defining a standard CAD surfboard cross-section
    // [X_s3d (const), Y_s3d (width), Z_s3d (height relative to bottom)]
    const pts: [number, number, number][] = [
      [x_s3d, 0, (getContourY(0.0, false) - baselineY) * INCHES_TO_CM],                            // Bottom Stringer
      [x_s3d, 0.75 * halfWidth * INCHES_TO_CM, (getContourY(0.75, false) - baselineY) * INCHES_TO_CM], // Bottom Tuck
      [x_s3d, halfWidth * INCHES_TO_CM, (apexY - baselineY) * INCHES_TO_CM],                       // Rail Apex
      [x_s3d, 0.75 * halfWidth * INCHES_TO_CM, (getContourY(0.75, true) - baselineY) * INCHES_TO_CM],  // Deck Shoulder
      [x_s3d, 0, (getContourY(0.0, true) - baselineY) * INCHES_TO_CM]                              // Deck Stringer
    ];

    const sliceBezier = fitSliceBezier(pts);
    slices.push(serializeCoupleXML(index, sliceBezier, centerZ));
  });

  return slices.join("\n");
};

/**
 * Custom 5-Point Curve Fitter tailored specifically for Surfboard Physics.
 * Enforces vertical tangents at the apex and horizontal tangents at the stringer.
 */
const fitSliceBezier = (pts: [number, number, number][]): S3DBezier => {
  const t1: [number, number, number][] = [];
  const t2: [number, number, number][] = [];

  const distY = (pA: [number, number, number], pB: [number, number, number]) => Math.abs(pA[1] - pB[1]) / 3;
  const distZ = (pA: [number, number, number], pB: [number, number, number]) => Math.abs(pA[2] - pB[2]) / 3;

  // P0: Bottom Stringer (Horizontal tangent towards Tuck)
  t1.push([...pts[0]!]);
  t2.push([pts[0]![0], pts[0]![1] + distY(pts[0]!, pts[1]!), pts[0]![2]]);

  // P1: Tuck (Central Difference)
  let dy = pts[2]![1] - pts[0]![1];
  let dz = pts[2]![2] - pts[0]![2];
  let slope = Math.abs(dy) > 0.0001 ? dz / dy : 0;
  t1.push([pts[1]![0], pts[1]![1] - distY(pts[0]!, pts[1]!), pts[1]![2] - slope * distY(pts[0]!, pts[1]!)]);
  t2.push([pts[1]![0], pts[1]![1] + distY(pts[1]!, pts[2]!), pts[1]![2] + slope * distY(pts[1]!, pts[2]!)]);

  // P2: Rail Apex (Strictly Vertical Tangent to prevent wobbles)
  t1.push([pts[2]![0], pts[2]![1], pts[2]![2] - distZ(pts[1]!, pts[2]!)]);
  t2.push([pts[2]![0], pts[2]![1], pts[2]![2] + distZ(pts[2]!, pts[3]!)]);

  // P3: Deck Shoulder (Central Difference)
  dy = pts[4]![1] - pts[2]![1];
  dz = pts[4]![2] - pts[2]![2];
  slope = Math.abs(dy) > 0.0001 ? dz / dy : 0;
  t1.push([pts[3]![0], pts[3]![1] - distY(pts[2]!, pts[3]!), pts[3]![2] - slope * distY(pts[2]!, pts[3]!)]);
  t2.push([pts[3]![0], pts[3]![1] + distY(pts[3]!, pts[4]!), pts[3]![2] + slope * distY(pts[3]!, pts[4]!)]);

  // P4: Deck Stringer (Horizontal tangent towards Shoulder)
  t1.push([pts[4]![0], pts[4]![1] - distY(pts[3]!, pts[4]!), pts[4]![2]]);
  t2.push([...pts[4]!]);

  return { controlPoints: pts, tangents1: t1, tangents2: t2 };
};

const serializeCoupleXML = (index: number, bezier: S3DBezier, centerZ: number): string => {
  const formatPt = (p: [number, number, number]) => 
    `\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>${p[0].toFixed(6)}</x><y>${p[1].toFixed(6)}</y><z>${p[2].toFixed(6)}</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>`;
  
  const buildPoly = (pts: [number, number, number][], overridePlan: number = 3, overrideSymmetry: number = 6) => 
    `\t\t\t\t\t<Polygone3d>\n\t\t\t\t\t\t<Nb_of_points>5</Nb_of_points>\n\t\t\t\t\t\t<Open>1</Open>\n\t\t\t\t\t\t<Symmetry>${overrideSymmetry}</Symmetry>\n\t\t\t\t\t\t<Symmetry_center>\n\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>0.000000</x><y>0.000000</y><z>${centerZ.toFixed(6)}</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>\n\t\t\t\t\t\t</Symmetry_center>\n\t\t\t\t\t\t<Plan>${overridePlan}</Plan>\n${pts.map(formatPt).join("\n")}\n\t\t\t\t\t</Polygone3d>`;

  // Tangents_m is always zeroed out in couples
  const emptyPt = `\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>0.000000</x><y>0.000000</y><z>0.000000</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>`;
  const tangM = `\t\t\t\t\t<Polygone3d>\n\t\t\t\t\t\t<Nb_of_points>5</Nb_of_points>\n\t\t\t\t\t\t<Open>1</Open>\n\t\t\t\t\t\t<Symmetry>0</Symmetry>\n\t\t\t\t\t\t<Plan>0</Plan>\n${Array(5).fill(emptyPt).join("\n")}\n\t\t\t\t\t</Polygone3d>`;

  return `\t\t<Couples_${index}>
\t\t\t\t<Dessus>1</Dessus>
\t\t\t\t<Dessous>1</Dessous>
\t\t\t\t<Displayed>0</Displayed>
\t\t\t<Bezier3d>
\t\t\t\t<Name>cpl</Name>
\t\t\t\t<Degree>3</Degree>
\t\t\t\t<Open>0</Open>
\t\t\t\t<Symmetry>6</Symmetry>
\t\t\t\t<Plan>3</Plan>
\t\t\t\t<Control_points>\n${buildPoly(bezier.controlPoints)}\n\t\t\t\t</Control_points>
\t\t\t\t<Tangents_1>\n${buildPoly(bezier.tangents1)}\n\t\t\t\t</Tangents_1>
\t\t\t\t<Tangents_2>\n${buildPoly(bezier.tangents2)}\n\t\t\t\t</Tangents_2>
\t\t\t\t<Tangents_m>\n${tangM}\n\t\t\t\t</Tangents_m>
\t\t\t\t<Control_type_point_0> 224 </Control_type_point_0>
\t\t\t\t<Control_type_point_1> 33 </Control_type_point_1>
\t\t\t\t<Control_type_point_2> 98 </Control_type_point_2>
\t\t\t\t<Control_type_point_3> 32 </Control_type_point_3>
\t\t\t\t<Control_type_point_4> 224 </Control_type_point_4>
\t\t\t\t<Tangent_type_point_0> 0 </Tangent_type_point_0>
\t\t\t\t<Tangent_type_point_1> 0 </Tangent_type_point_1>
\t\t\t\t<Tangent_type_point_2> 16 </Tangent_type_point_2>
\t\t\t\t<Tangent_type_point_3> 2 </Tangent_type_point_3>
\t\t\t\t<Tangent_type_point_4> 0 </Tangent_type_point_4>
\t\t\t</Bezier3d>
\t\t</Couples_${index}>`;
};

export const fitBezier = (points: [number, number, number][]): S3DBezier => {
  // 1. Ensure points are sorted from Tail (x=0) to Nose (x=L)
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const L = sorted[sorted.length - 1]![0];

  // 2. Strategic sampling fractions: Tail, Fin Area, Hip, Wide Point, Chest, Nose-Entry, Nose tip.
  const fractions = [0.0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0];
  
  const anchors: [number, number, number][] = [];
  const indices: number[] = [];

  for (const t of fractions) {
    const targetX = t * L;
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const dist = Math.abs(sorted[i]![0] - targetX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    anchors.push(sorted[closestIdx]!);
    indices.push(closestIdx);
  }

  const tangents1: [number, number, number][] = [];
  const tangents2: [number, number, number][] = [];

  // 3. Hermite-to-Bezier Tangent Estimation
  for (let i = 0; i < anchors.length; i++) {
    const idx = indices[i]!;
    const P = anchors[i]!;

    // Calculate central difference (slope) across this anchor
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

    let slopeY = 0, slopeZ = 0;
    if (Math.abs(dx) > 0.0001) {
      slopeY = dy / dx;
      slopeZ = dz / dx;
    }

    // Tangent 1 (Left Handle - Points toward Tail)
    if (i === 0) {
      tangents1.push([...P]); // Tail anchor has no left handle
    } else {
      const prevP = anchors[i - 1]!;
      const distX = (P[0] - prevP[0]) / 3;
      tangents1.push([
        P[0] - Math.abs(distX),
        P[1] - slopeY * Math.abs(distX),
        P[2] - slopeZ * Math.abs(distX)
      ]);
    }

    // Tangent 2 (Right Handle - Points toward Nose)
    if (i === anchors.length - 1) {
      tangents2.push([...P]); // Nose anchor has no right handle
    } else {
      const nextP = anchors[i + 1]!;
      const distX = (nextP[0] - P[0]) / 3;
      tangents2.push([
        P[0] + Math.abs(distX),
        P[1] + slopeY * Math.abs(distX),
        P[2] + slopeZ * Math.abs(distX)
      ]);
    }
  }

  return { controlPoints: anchors, tangents1, tangents2 };
};

/**
 * Serializes a fitted Bezier curve into Shape3d's proprietary XML format.
 */
const serializeBezier3d = (tag: string, name: string, plan: number, bezier: S3DBezier, boardLengthInches: number): string => {
  const centerLengthCm = (boardLengthInches / 2) * INCHES_TO_CM;
  
  const formatPt = (p: [number, number, number]) => 
    `\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>${p[0].toFixed(6)}</x><y>${p[1].toFixed(6)}</y><z>${p[2].toFixed(6)}</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>`;
  
  const buildPoly = (pts: [number, number, number][], overridePlan: number = plan, overrideSymmetry: number = tag === "Otl" ? 6 : 0) => 
    `\t\t\t\t\t<Polygone3d>\n\t\t\t\t\t\t<Nb_of_points>${pts.length}</Nb_of_points>\n\t\t\t\t\t\t<Open>1</Open>\n\t\t\t\t\t\t<Symmetry>${overrideSymmetry}</Symmetry>\n\t\t\t\t\t\t<Symmetry_center>\n\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>${centerLengthCm.toFixed(6)}</x><y>0.000000</y><z>0.000000</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>\n\t\t\t\t\t\t</Symmetry_center>\n\t\t\t\t\t\t<Plan>${overridePlan}</Plan>\n${pts.map(formatPt).join("\n")}\n\t\t\t\t\t</Polygone3d>`;

  const tangM = `\t\t\t\t<Tangents_m>\n${buildPoly(bezier.controlPoints.map(() => [0,0,0] as [number,number,number]), 0, 0)}\n\t\t\t\t</Tangents_m>`;
  
  // Shape3D requires Control types to be grouped, followed by Tangent types grouped.
  const controlTypes = bezier.controlPoints.map((_, i) => 
    `\t\t\t\t<Control_type_point_${i}> 32 </Control_type_point_${i}>`
  ).join("\n");
  
  const tangentTypes = bezier.controlPoints.map((_, i) => 
    `\t\t\t\t<Tangent_type_point_${i}> 0 </Tangent_type_point_${i}>`
  ).join("\n");

  return `\t\t<${tag}>
\t\t\t<Bezier3d>
\t\t\t\t<Name>${name}</Name>
\t\t\t\t<Degree>3</Degree>
\t\t\t\t<Open>${tag === "Otl" ? 0 : 1}</Open>
\t\t\t\t<Symmetry>${tag === "Otl" ? 6 : 0}</Symmetry>
\t\t\t\t<Plan>${plan}</Plan>
\t\t\t\t<Control_points>\n${buildPoly(bezier.controlPoints)}\n\t\t\t\t</Control_points>
\t\t\t\t<Tangents_1>\n${buildPoly(bezier.tangents1)}\n\t\t\t\t</Tangents_1>
\t\t\t\t<Tangents_2>\n${buildPoly(bezier.tangents2)}\n\t\t\t\t</Tangents_2>
${tangM}
${controlTypes}
${tangentTypes}
\t\t\t</Bezier3d>
\t\t</${tag}>`;
};
