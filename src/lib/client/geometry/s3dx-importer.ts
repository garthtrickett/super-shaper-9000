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

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");

    // Check for parsing errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      yield* Effect.fail(new Error("Invalid XML format"));
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

        const points: Point3D[] =[];
        polyNode.querySelectorAll("Point3d").forEach(ptNode => {
          const x = parseFloat(ptNode.querySelector("x")?.textContent || "0");
          const y = parseFloat(ptNode.querySelector("y")?.textContent || "0");
          const z = parseFloat(ptNode.querySelector("z")?.textContent || "0");
          
          const pt = translateFromShape3d([x, y, z], lengthInches, thicknessInches);
          
          if (isOutline) pt[1] = 0; // Force Y to 0 for outline
          if (isRocker) pt[0] = 0; // Force X to 0 for rockers

          points.push(pt);
        });
        return points;
      };

      return {
        controlPoints: parsePoints("Control_points"),
        tangents1: parsePoints("Tangents_1"),
        tangents2: parsePoints("Tangents_2")
      };
    };

    // 3. Extract Main Curves
    const outline = extractBezier("Otl", true, false);
    const rockerBottom = extractBezier("StrBot", false, true);
    const rockerTop = extractBezier("StrDeck", false, true);

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

    yield* clientLog("info", "[s3dx-importer] Successfully extracted curves", {
      outlinePoints: outline.controlPoints.length,
      crossSections: crossSections.length
    });

    return {
      length: lengthInches,
      width: widthInches,
      thickness: thicknessInches,
      outline,
      rockerBottom,
      rockerTop,
      crossSections
    };
  });
