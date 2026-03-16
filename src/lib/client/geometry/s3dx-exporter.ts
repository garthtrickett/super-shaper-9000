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
    const mapCurve = (curve: [number, number, number][]) => 
      curve.map(p => translateToShape3d(p, model.length, model.thickness));

    const outlineS3d = mapCurve(curves.outline);
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

    // Step 3: XML Serialization
    return `<?xml version="1.0" encoding="iso-8859-1"?>
<Shape3d_design>
	<Board>
		<Name>SuperShaper_${model.length.toFixed(1)}_${model.tailType}</Name>
		<Length>${(model.length * INCHES_TO_CM).toFixed(3)}</Length>
		<Width>${(model.width * INCHES_TO_CM).toFixed(3)}</Width>
		<Thickness>${(model.thickness * INCHES_TO_CM).toFixed(3)}</Thickness>
${serializeBezier3d("Otl", "", 1, otlBezier)}
${serializeBezier3d("StrBot", "Stringer Bot", 2, botBezier)}
${serializeBezier3d("StrDeck", "Stringer Top", 2, deckBezier)}
		<!-- Cross-Sections (Couples) coming in Step 3. -->
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
 * Samples a dense array of NURBS points and fits a C1-continuous Cubic Bezier Curve
 * using 7 strategic stations along the length of the board.
 */
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
const serializeBezier3d = (tag: string, name: string, plan: number, bezier: S3DBezier): string => {
  const formatPt = (p: [number, number, number]) => 
    `\t\t\t\t\t\t\t<Point3d>\n\t\t\t\t\t\t\t\t<x>${p[0].toFixed(6)}</x><y>${p[1].toFixed(6)}</y><z>${p[2].toFixed(6)}</z><u>-1.000000</u><color>0</color>\n\t\t\t\t\t\t\t</Point3d>`;
  
  const buildPoly = (pts: [number, number, number][]) => 
    `\t\t\t\t\t<Polygone3d>\n\t\t\t\t\t\t<Nb_of_points>${pts.length}</Nb_of_points>\n\t\t\t\t\t\t<Open>1</Open>\n\t\t\t\t\t\t<Symmetry>${tag === "Otl" ? 6 : 0}</Symmetry>\n\t\t\t\t\t\t<Plan>${plan}</Plan>\n${pts.map(formatPt).join("\n")}\n\t\t\t\t\t</Polygone3d>`;

  return `\t	<${tag}>
\t\t\t<Bezier3d>
\t\t\t\t<Name>${name}</Name>
\t\t\t\t<Degree>3</Degree>
\t\t\t\t<Open>${tag === "Otl" ? 0 : 1}</Open>
\t\t\t\t<Symmetry>${tag === "Otl" ? 6 : 0}</Symmetry>
\t\t\t\t<Plan>${plan}</Plan>
\t\t\t\t<Control_points>\n${buildPoly(bezier.controlPoints)}\n\t\t\t\t</Control_points>
\t\t\t\t<Tangents_1>\n${buildPoly(bezier.tangents1)}\n\t\t\t\t</Tangents_1>
\t\t\t\t<Tangents_2>\n${buildPoly(bezier.tangents2)}\n\t\t\t\t</Tangents_2>
\t\t\t</Bezier3d>
\t\t</${tag}>`;
};
