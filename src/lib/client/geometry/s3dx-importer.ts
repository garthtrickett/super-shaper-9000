import { Effect } from "effect";
import type { BezierCurveData, Point3D } from "../../../components/pages/board-builder-page.logic";
import { clientLog } from "../clientLog";

const CM_TO_INCHES = 1 / 2.54;

/**
 * Translates Shape3d [X, Y, Z] (cm) to Super Shaper 9000[X, Y, Z] (inches)
 *
 * Shape3d:
 * - X: Length (0 at Absolute Tail, +L at Nose)
 * - Y: Width (0 at stringer)
 * - Z: Thickness (0 at bottom bounding box)
 * 
 * SS9000:
 * - X: Width (0 at stringer)
 * - Y: Thickness (0 at center of board, bottom is -T/2)
 * - Z: Length (0 at center, -L/2 at nose, +L/2 at tail)
 */
export const translateFromShape3d = (
[x, y, z]: [number, number, number],
  boardLengthInches: number,
  boardThicknessInches: number
): Point3D => {
  const x_ss = y * CM_TO_INCHES;
  const y_ss = (z * CM_TO_INCHES) - (boardThicknessInches / 2);
  const z_ss = boardLengthInches / 2 - (x * CM_TO_INCHES);

  return [x_ss, y_ss, z_ss];
};

export interface ImportedS3dxData {
  length: number;
  width: number;
  thickness: number;
  outline: BezierCurveData;
  rockerBottom: BezierCurveData;
  rockerTop: BezierCurveData;
  crossSections: BezierCurveData[];
}

export const parseS3dx = (xmlString: string): Effect.Effect<ImportedS3dxData, Error> =>
  Effect.gen(function* () {
    yield* clientLog("info", "[s3dx-importer] Starting XML parsing");

    // Shape3D outputs illegal XML tags (e.g. <Ref. point>) which the browser's DOMParser rejects.
    // We must sanitize these known invalid tags before parsing to make it strictly valid XML.
    const sanitizedXml = xmlString
      .replace(/<Ref\. point>/g, "<Ref_point>")
      .replace(/<\/Ref\. point>/g, "</Ref_point>");

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitizedXml, "application/xml");

    // Check for parsing errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      const errorMsg = parserError.textContent || "Unknown parsing error";
      yield* clientLog("error", "[s3dx-importer] XML Parsing Failed", {
        error: errorMsg,
        snippet: xmlString.substring(0, 200)
      });
      yield* Effect.fail(new Error(`Invalid XML format: ${errorMsg}`));
    }

    // 1. Extract Metadata Dimensions (Stored in cm, need to convert to inches)
    const getText = (tag: string) => doc.querySelector(tag)?.textContent?.trim() || "0";
    
    const lengthCm = parseFloat(getText("Length"));
    const widthCm = parseFloat(getText("Width"));
    const thicknessCm = parseFloat(getText("Thickness"));

    if (!lengthCm || !thicknessCm) {
      yield* Effect.fail(new Error("Missing core dimensions in s3dx file"));
    }

    const lengthInches = lengthCm * CM_TO_INCHES;
    const widthInches = widthCm * CM_TO_INCHES;
    const thicknessInches = thicknessCm * CM_TO_INCHES;

    // 2. Helper to extract Bezier Curve from a parent node
    const extractBezier = (parentSelector: string, isOutline: boolean = false, isRocker: boolean = false): BezierCurveData => {
      const parent = doc.querySelector(parentSelector);
      if (!parent) return { controlPoints: [], tangents1: [], tangents2:[] };

      const parsePoints = (subTag: string): Point3D[] => {
        const polyNode = parent.querySelector(`${subTag} > Polygone3d`);
        if (!polyNode) return [];

        const points: Point3D[] = [];
        // ✅ FIX: Iterate direct children to exclude the nested <Symmetry_center><Point3d> node
        for (const child of Array.from(polyNode.children)) {
          if (child.tagName === 'Point3d') {
            const ptNode = child;
            const x = parseFloat(ptNode.querySelector("x")?.textContent || "0");
            const y = parseFloat(ptNode.querySelector("y")?.textContent || "0");
            const z = parseFloat(ptNode.querySelector("z")?.textContent || "0");
            
            const pt = translateFromShape3d([x, y, z], lengthInches, thicknessInches);
            
            if (isOutline) pt[1] = 0; // Force Y to 0 for outline
            if (isRocker) pt[0] = 0; // Force X to 0 for rockers
  
            points.push(pt);
          }
        }
        return points;
      };

      return {
        controlPoints: parsePoints("Control_points"),
        tangents1: parsePoints("Tangents_1"),
        tangents2: parsePoints("Tangents_2")
      };
    };

    // Helper to reverse the direction of a Bezier curve (Nose-to-Tail vs Tail-to-Nose)
    const reverseCurve = (curve: BezierCurveData): BezierCurveData => {
      return {
        controlPoints: [...curve.controlPoints].reverse(),
        tangents1: [...curve.tangents2].reverse(),
        tangents2:[...curve.tangents1].reverse()
      };
    };

    // 3. Extract Main Curves
    // Shape3D stores points from Tail to Nose. SS9000 requires Nose to Tail (increasing Z).
    const outline = reverseCurve(extractBezier("Otl", true, false));
    const rockerBottom = reverseCurve(extractBezier("StrBot", false, true));
    const rockerTop = reverseCurve(extractBezier("StrDeck", false, true));

    // 4. Extract Cross Sections (Couples)
    const crossSections: BezierCurveData[] =[];
    let coupleIdx = 0;
    while (true) {
      const coupleSelector = `Couples_${coupleIdx}`;
      const coupleNode = doc.querySelector(coupleSelector);
      if (!coupleNode) break;

      const sliceBezier = extractBezier(coupleSelector, false, false);
      if (sliceBezier.controlPoints.length > 0) {
        crossSections.push(sliceBezier);
      }
      coupleIdx++;
    }
    
    // Sort cross sections from Nose to Tail (increasing Z)
    crossSections.sort((a, b) => (a.controlPoints[0]?.[2] || 0) - (b.controlPoints[0]?.[2] || 0));

    // --- FIX FOR SLICE Y-OFFSET ---
    // Shape3D slices are stored with Z=0 at the local bottom stringer.
    // translateFromShape3d maps this to y = -thickness/2.
    // We must shift them up to match the actual Rocker Bottom curve.
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

    const getRockerYAtZ = (bezier: BezierCurveData, targetZ: number): number => {
      let t0 = 0; let t1 = 1;
      let p = evaluateBezier3D(bezier, 0.5);
      for (let i = 0; i < 15; i++) {
        const tMid = (t0 + t1) / 2;
        p = evaluateBezier3D(bezier, tMid);
        if (p[2] < targetZ) t0 = tMid;
        else t1 = tMid;
      }
      return p[1];
    };

    for (const slice of crossSections) {
      if (slice.controlPoints.length === 0) continue;
      const sliceZ = slice.controlPoints[0]![2];
      const rockerY = getRockerYAtZ(rockerBottom, sliceZ);
      const shiftY = rockerY + (thicknessInches / 2);

      const shiftPoint = (pt: Point3D) => {
        if (pt) pt[1] += shiftY;
      };

      slice.controlPoints.forEach(shiftPoint);
      slice.tangents1.forEach(shiftPoint);
      slice.tangents2.forEach(shiftPoint);
    }
    // --- END FIX ---

    // Filter out microscopic slices at the absolute tips (nose/tail)
    // that cause interpolation math to explode during mesh generation.
    const cleanCrossSections = crossSections.filter((slice) => {
      // Calculate slice half-width (max X coordinate)
      const xs = slice.controlPoints.map(p => p[0]);
      const halfWidth = Math.max(...xs);
      
      // If the slice is narrower than ~0.25 inches, it's a microscopic tip cap.
      // Discard it so the mesh generator can interpolate naturally to a point.
      return halfWidth > 0.25;
    });

    yield* clientLog("info", "[s3dx-importer] Successfully extracted curves", {
      outlinePoints: outline.controlPoints.length,
      crossSections: cleanCrossSections.length,
      strippedSlices: crossSections.length - cleanCrossSections.length
    });

    return {
      length: lengthInches,
      width: widthInches,
      thickness: thicknessInches,
      outline,
      rockerBottom,
      rockerTop,
      crossSections: cleanCrossSections
    };
  });
