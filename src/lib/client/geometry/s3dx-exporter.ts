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

    // Return the XML skeleton. Step 2 will inject the translated Bezier fits here.
    return `<?xml version="1.0" encoding="iso-8859-1"?>
<Shape3d_design>
	<Board>
		<Name>SuperShaper_${model.length.toFixed(1)}_${model.tailType}</Name>
		<Length>${(model.length * INCHES_TO_CM).toFixed(3)}</Length>
		<Width>${(model.width * INCHES_TO_CM).toFixed(3)}</Width>
		<Thickness>${(model.thickness * INCHES_TO_CM).toFixed(3)}</Thickness>
		<!-- Coordinate translation utility active. Bezier Curves coming in Step 2. -->
	</Board>
</Shape3d_design>`;
  });
