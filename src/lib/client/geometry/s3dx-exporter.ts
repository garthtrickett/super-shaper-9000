import { Effect } from "effect";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";
import type { BoardCurves } from "./board-curves";
import { clientLog } from "../clientLog";
import { getBoardProfileAtZ, getBottomYAt } from "./mesh-generator";

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
  return[
    Number(x_s3d.toFixed(6)),
    Number(y_s3d.toFixed(6)),
    Number(z_s3d.toFixed(6)),
  ];
};

export const exportS3dx = (
  model: BoardModel,
  curves: BoardCurves
): Effect.Effect<string> =>
  Effect.gen(function* () {
    yield* clientLog(
      "info",
      "[s3dx-exporter] Starting Step 1: Coordinate Translation Pipeline"
    );

    // Step 2: Translate dense NURBS points to Shape3d World Coordinates
    const mapCurve = (
      curve: [number, number, number][],
      flattenZ: boolean = false
    ) =>
      curve.map((p) => {
        const pt = translateToShape3d(p, model.length, model.thickness);
        if (flattenZ) pt[2] = 0.000000;
        return pt;
      });

    // Shape3D requires the Outline curve to be strictly 2D at Z=0
    const outlineS3d = mapCurve(curves.outline, true);
    const botS3d = mapCurve(curves.rockerBottom);
    const deckS3d = mapCurve(curves.rockerTop);

    // Generate Cubic Beziers via Curve Fitting
    const otlBezier = fitBezier(outlineS3d, "outline");
    const botBezier = fitBezier(botS3d, "rocker");
    const deckBezier = fitBezier(deckS3d, "rocker");

    yield* clientLog("debug", "[s3dx-exporter] Bezier Curves Generated", {
      outlineAnchors: otlBezier.controlPoints.length,
      bottomAnchors: botBezier.controlPoints.length,
    });
    
    // ✅ NEW: Generate Fin Box and Leash Plug XML
    const plugsAndFinsXML = generatePlugsAndFinsXML(model, curves);

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
${plugsAndFinsXML}
	</Board>
</Shape3d_design>`;
  });

// --- STEP 2 UTILITIES: Curve Fitting & XML Serialization ---

export interface S3DBezier {
  controlPoints: [number, number, number][];
  tangents1: [number, number, number][]; // Incoming (left) handles
  tangents2: [number, number, number][]; // Outgoing (right) handles
}

export const bakeCrossSections = (model: BoardModel, curves: BoardCurves): string => {
  const slices: string[] =[];
  
  // 8 Strategic Stations along the board. 
  // Shape3D requires Couples_0 to be at the TAIL (t=0.99) and Couples_7 at the NOSE (t=0.01)
  const fractions =[0.99, 0.95, 0.8, 0.6, 0.4, 0.2, 0.05, 0.01];
  
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
    let railExp = 1.5 - ((model as any).railFullness || 0.65);
    let deckExp = ((model as any).deckDome || 0.65);
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
    const channelLength = (model as any).channelLength || 12;
    const blendChannels = tailDist <= channelLength + 6.0 ? 1.0 - smoothStep(channelLength, channelLength + 6.0, tailDist) : 0;
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
      const bottomContour = (model as any).bottomContour || "vee_to_quad_channels";
      if (bottomContour === "vee_to_quad_channels") {
        const vee = -((model as any).veeDepth || 0.15) * (1 - nx) * blendVee;
        const conc = ((model as any).concaveDepth || 0.25) * (1 - nx * nx) * blendConcave;
        let chan = 0;
        if (nx >= 0.2 && nx <= 0.8) {
          chan = ((model as any).channelDepth || 0.125) * Math.pow(Math.sin(((nx - 0.2) / 0.6) * Math.PI * 2), 2) * blendChannels;
        }
        offset = (vee + conc + chan) * widthFade;
      } else if (bottomContour === "single_to_double") {
        const single = ((model as any).concaveDepth || 0.25) * (1 - nx * nx);
        const double = ((model as any).concaveDepth || 0.25) * 0.8 * Math.pow(Math.sin(nx * Math.PI), 2);
        offset = (single * (1 - nz) + double * nz) * widthFade;
      } else if (bottomContour === "single") {
        offset = ((model as any).concaveDepth || 0.25) * (1 - nx * nx) * widthFade;
      }
      
      return py + (offset * abs_cy);
    };

    // Baseline for Z MUST be exactly the bottom stringer to satisfy Shape3D's relative Z-coordinate requirement
    const baselineY = getContourY(0.0, false);
    
    // Calculate absolute Z center of the board at this slice for Shape3D's Symmetry_center
    const centerZ = (((topY + botY) / 2) + model.thickness / 2) * INCHES_TO_CM;

    // The 5 key points defining a standard CAD surfboard cross-section
    const pts: [number, number, number][] = [[x_s3d, 0, (getContourY(0.0, false) - baselineY) * INCHES_TO_CM],[x_s3d, 0.75 * halfWidth * INCHES_TO_CM, (getContourY(0.75, false) - baselineY) * INCHES_TO_CM],[x_s3d, halfWidth * INCHES_TO_CM, (apexY - baselineY) * INCHES_TO_CM],[x_s3d, 0.75 * halfWidth * INCHES_TO_CM, (getContourY(0.75, true) - baselineY) * INCHES_TO_CM],[x_s3d, 0, (getContourY(0.0, true) - baselineY) * INCHES_TO_CM]
    ];

    const sliceBezier = fitSliceBezier(pts);
    slices.push(serializeCoupleXML(index, sliceBezier, centerZ));
  });

  return slices.join("\n");
};

const fitSliceBezier = (pts: [number, number, number][]): S3DBezier => {
  const t1:[number, number, number][] = [];
  const t2: [number, number, number][] =[];

  const distY = (pA: [number, number, number], pB:[number, number, number]) => Math.abs(pA[1] - pB[1]) / 3;
  const distZ = (pA: [number, number, number], pB:[number, number, number]) => Math.abs(pA[2] - pB[2]) / 3;

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
  const formatPt = (p:[number, number, number]) => 
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

export const fitBezier = (points:[number, number, number][], curveType: 'outline' | 'rocker'): S3DBezier => {
  // 1. Ensure points are sorted from Tail (x=0) to Nose (x=L)
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const L = sorted.length > 0 ? sorted[sorted.length - 1]![0] : 0;

  // ✅ FIX: Use different sampling fractions based on curve type to match reference file
  const fractions = curveType === 'outline' 
    ?[0.0, 0.025, 0.47, 1.0] // 4 points for outline
    :[0.0, 0.5, 1.0];        // 3 points for rockers

  const anchors:[number, number, number][] = [];
  const indices: number[] =[];

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
    // Prevent duplicate points if fractions resolve to the same sample
    if (indices.indexOf(closestIdx) === -1) {
      anchors.push(sorted[closestIdx]!);
      indices.push(closestIdx);
    }
  }

  const tangents1: [number, number, number][] =[];
  const tangents2: [number, number, number][] =[];

  // ✅ FIX: Use a more stable tangent calculation based on adjacent anchors
  for (let i = 0; i < anchors.length; i++) {
    const P = anchors[i]!;

    let tangentVec: [number, number, number] = [0, 0, 0];
    if (i === 0) {
      const nextP = anchors[i + 1]!;
      tangentVec = [nextP[0] - P[0], nextP[1] - P[1], nextP[2] - P[2]];
    } else if (i === anchors.length - 1) {
      const prevP = anchors[i - 1]!;
      tangentVec = [P[0] - prevP[0], P[1] - prevP[1], P[2] - prevP[2]];
    } else {
      const nextP = anchors[i + 1]!;
      const prevP = anchors[i - 1]!;
      tangentVec = [nextP[0] - prevP[0], nextP[1] - prevP[1], nextP[2] - prevP[2]];
    }

    const len = Math.hypot(tangentVec[0], tangentVec[1], tangentVec[2]);
    if (len > 1e-6) {
      tangentVec[0] /= len;
      tangentVec[1] /= len;
      tangentVec[2] /= len;
    }

    const distToPrev = i > 0 ? Math.hypot(P[0] - anchors[i-1]![0], P[1] - anchors[i-1]![1], P[2] - anchors[i-1]![2]) : 0;
    const distToNext = i < anchors.length - 1 ? Math.hypot(anchors[i+1]![0] - P[0], anchors[i+1]![1] - P[1], anchors[i+1]![2] - P[2]) : 0;
    
    const handleLen1 = distToPrev / 3;
    const handleLen2 = distToNext / 3;

    if (i === 0) {
      tangents1.push([...P]);
    } else {
      tangents1.push([
        P[0] - tangentVec[0] * handleLen1,
        P[1] - tangentVec[1] * handleLen1,
        P[2] - tangentVec[2] * handleLen1,
      ]);
    }

    if (i === anchors.length - 1) {
      tangents2.push([...P]);
    } else {
      tangents2.push([
        P[0] + tangentVec[0] * handleLen2,
        P[1] + tangentVec[1] * handleLen2,
        P[2] + tangentVec[2] * handleLen2,
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
  
  const buildPoly = (pts:[number, number, number][], overridePlan: number = plan, overrideSymmetry: number = tag === "Otl" ? 6 : 0) => 
    `\t\t\t\t\t<Polygone3d>\n\t\t\t\t\t\t<Nb_of_points>${pts.length}</Nb_of_points>\n\t\t\t\t\t\t<Open>1</Open>\n\t\t\t\t\t\t<Symmetry>${overrideSymmetry}</Symmetry>\n\t\t\t\t\t\t<Symmetry_center>\n\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>${centerLengthCm.toFixed(6)}</x><y>0.000000</y><z>0.000000</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>\n\t\t\t\t\t\t</Symmetry_center>\n\t\t\t\t\t\t<Plan>${overridePlan}</Plan>\n${pts.map(formatPt).join("\n")}\n\t\t\t\t\t</Polygone3d>`;

  const tangM = `\t\t\t\t<Tangents_m>\n${buildPoly(bezier.controlPoints.map(() => [0,0,0] as[number,number,number]), 0, 0)}\n\t\t\t\t</Tangents_m>`;
  
  // ✅ FIX: Implement dynamic control and tangent types based on reference files
  const getControlType = (i: number, total: number) => {
    // End points are '32', intermediate points are '0'
    if (i === 0 || i === total - 1) return 32;
    return 0;
  };

  const getTangentType = (i: number, total: number, curveType: 'outline' | 'rocker' ) => {
    if (i === 0 || i === total - 1) return 0;
    if (curveType === 'outline') {
      // Pattern from reference: 0, 2, 16, 0
      if (i === 1) return 2;
      if (i === 2) return 16;
    } else {
      // Rocker pattern: 0, 32, 0
      if (i === 1) return 32;
    }
    return 0;
  };

  const controlTypes = bezier.controlPoints.map((_, i) => 
    `\t\t\t\t<Control_type_point_${i}> ${getControlType(i, bezier.controlPoints.length)} </Control_type_point_${i}>`
  ).join("\n");
  
  const tangentTypes = bezier.controlPoints.map((_, i) => 
    `\t\t\t\t<Tangent_type_point_${i}> ${getTangentType(i, bezier.controlPoints.length, tag === 'Otl' ? 'outline' : 'rocker')} </Tangent_type_point_${i}>`
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

// ====================================================================
// ✅ NEW: FIN BOX & LEASH PLUG GENERATION LOGIC
// ====================================================================

const generatePlugsAndFinsXML = (model: BoardModel, curves: BoardCurves): string => {
  const boxConfigs: { name: string; zFromTail: number; xFromCenter: number; isCenter: boolean; isSide: boolean; isPlug: boolean }[] =[];

  // 1. Fins
  if (model.finSetup === 'thruster') {
    boxConfigs.push({ name: "Fin sides", zFromTail: model.frontFinZ, xFromCenter: model.frontFinX, isCenter: false, isSide: true, isPlug: false });
    boxConfigs.push({ name: "Fin center", zFromTail: model.rearFinZ, xFromCenter: 0, isCenter: true, isSide: false, isPlug: false });
  } else if (model.finSetup === 'quad') {
    boxConfigs.push({ name: "Fin sides", zFromTail: model.frontFinZ, xFromCenter: model.frontFinX, isCenter: false, isSide: true, isPlug: false });
    boxConfigs.push({ name: "Fin sides", zFromTail: model.rearFinZ, xFromCenter: model.rearFinX, isCenter: false, isSide: true, isPlug: false });
  } else if (model.finSetup === 'twin') {
    boxConfigs.push({ name: "Fin sides", zFromTail: model.frontFinZ, xFromCenter: model.frontFinX, isCenter: false, isSide: true, isPlug: false });
  }

  // 2. Leash Plug (Standard placement: 3.5 inches from tail on the stringer)
  boxConfigs.push({ name: "Leash 1", zFromTail: 3.5, xFromCenter: 0, isCenter: false, isSide: false, isPlug: true });

  if (boxConfigs.length === 0) {
    return "<Nb_Boxes>0</Nb_Boxes>";
  }

  const boxesXML = boxConfigs.map((box, i) => {
    // 1. Calculate position in our coordinate system
    const z_ss = model.length / 2 - box.zFromTail;
    const profile = getBoardProfileAtZ(model, curves, z_ss);
    const x_ss = box.isCenter || box.isPlug ? 0 : profile.halfWidth - box.xFromCenter;
    
    let y_ss = 0;
    if (box.isPlug) {
      // Leash plug sits flush on the deck
      y_ss = profile.topY;
    } else {
      // Fins sit flush on the bottom contours
      y_ss = getBottomYAt(model, curves, x_ss, z_ss);
    }

    // 2. Translate to S3D coordinates for the <Ref. point>
    const refPointS3D = translateToShape3d([x_ss, y_ss, z_ss], model.length, model.thickness);
    
    // Helper to format 3D points exactly like Shape3D expects
    const formatPt = (pt: [number, number, number]) => 
      `\t\t\t<Point3d>\n\t\t\t\t<x>${pt[0].toFixed(6)}</x><y>${pt[1].toFixed(6)}</y><z>${pt[2].toFixed(6)}</z><u>-1.000000</u><color>0</color>\n\t\t\t</Point3d>`;

    // 3. Static values from reference for standard elements
    const boxLengthCm = box.isPlug ? 2.7 : 15.0;
    const boxWidthCm = box.isPlug ? 2.7 : 3.2;
    const boxHeightCm = box.isPlug ? 1.6 : 1.55;
    const diameter = box.isPlug ? 2.7 : 3.2;
    const c1c2 = box.isPlug ? 0.0 : 11.8;
    const reflexion = box.isPlug ? 0 : 20;
    
    const face = box.isPlug ? 0 : 1; // 0 = Deck, 1 = Bottom
    const style = box.isPlug ? 4 : 3; // 4 = Plug, 3 = Fin Box
    const toeInRad = box.isSide ? (model.toeAngle * Math.PI / 180).toFixed(4) : "0.0000";
    
    const ptConvergence = box.isSide ? `\n\t\t\t<PtConvergence>250.000000</PtConvergence>` : "";

    return `\t\t<Box_${i}>
\t\t<Box>
\t\t\t<Name>${box.name}</Name>
\t\t\t<Length>${boxLengthCm.toFixed(3)}</Length>
\t\t\t<Width>${boxWidthCm.toFixed(3)}</Width>
\t\t\t<Height>${boxHeightCm.toFixed(3)}</Height>
\t\t\t<Diameter>${diameter.toFixed(3)}</Diameter>
\t\t\t<C1C2>${c1c2.toFixed(3)}</C1C2>
\t\t\t<Color>0</Color>
\t\t\t<Reflexion_coef>${reflexion}</Reflexion_coef>
\t\t\t<Even>${box.isSide ? 1 : 0}</Even>
\t\t\t<Central>${box.isCenter ? 1 : 0}</Central>
\t\t\t<SymNoseTail>0</SymNoseTail>
\t\t\t<IFixedToBt>-1</IFixedToBt>
\t\t\t<DistFixedTo>0.000</DistFixedTo>
\t\t\t<AFixedTo>0.000</AFixedTo>
\t\t\t<FixedTail>${box.isPlug ? 0 : 1}</FixedTail>
\t\t\t<FixedNose>0</FixedNose>
\t\t\t<FixedCenter>0</FixedCenter>
\t\t\t<FixedRail>${box.isSide ? 1 : 0}</FixedRail>
\t\t\t<Face>${face}</Face>
\t\t\t<Style>${style}</Style>
\t\t\t<Ref. point>
${formatPt(refPointS3D)}</Ref. point>
\t\t\t<PointRef>
${formatPt(refPointS3D)}</PointRef>
\t\t\t<PointRefDx>${box.isCenter || box.isPlug ? '0.000' : '-1.500'}</PointRefDx>
\t\t\t<PointRefDy>${box.isSide ? '0.320' : '0.000'}</PointRefDy>
\t\t\t<PointCenter>
${formatPt(refPointS3D)}</PointCenter>
\t\t\t<FinLength>10.160</FinLength>${ptConvergence}
\t\t\t<AngleOz>${toeInRad}</AngleOz>
\t\t\t<DisplayD3D>1</DisplayD3D>
\t\t\t<MappingD3D>1</MappingD3D>
\t\t\t<ImageMappedD3D>White</ImageMappedD3D>
\t\t\t<CutCNC>1</CutCNC>
\t\t\t<DpLibelle>
\t\t\t<Point2d>
\t\t\t\t<x>0.000000</x><y>0.000000</y><color>337156096</color>
\t\t\t</Point2d></DpLibelle>
\t\t</Box>
\t\t</Box_${i}>`;
  }).join('\n');

  return `<Nb_Boxes>${boxConfigs.length}</Nb_Boxes>\n${boxesXML}`;
};
