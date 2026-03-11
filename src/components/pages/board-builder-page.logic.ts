import { Effect } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round";
export type NoseShape = "pointy" | "torpedo" | "clipped";
export type RailProfile = "soft" | "boxy" | "variable_sharp_tail";
export type BottomContour = "flat" | "single" | "single_to_double" | "vee_to_quad_channels";

export interface BoardModel {
  length: number;
  width: number;
  thickness: number;
  volume: number;
  noseWidth: number; // N12 (12" from nose)
  tailWidth: number; // T12 (12" from tail)
  noseShape: NoseShape;
  tailType: TailType;
  widePointOffset: number;
  noseRocker: number;
  tailRocker: number;
  noseThickness: number; // N12 Foil
  tailThickness: number; // T12 Foil
  rockerFlatSpotLength: number; // Staging belly
  deckDome: number;
  railProfile: RailProfile;
  bottomContour: BottomContour;
}

export const INITIAL_STATE: BoardModel = {
  // 65kg Slab-Hunter Specs
  length: 70, // 5'10"
  width: 18.75,
  thickness: 2.5,
  volume: 30.5, 
  noseWidth: 13.5, // N12: Wide enough to paddle, but chopped
  tailWidth: 14.0, // T12: Ultra-narrow rounded pin for hold
  noseShape: "clipped",
  tailType: "round",
  widePointOffset: 2.0, // 2" Forward of center for paddle engine
  noseRocker: 5.2, // Slightly lower entry
  tailRocker: 1.6, // Flat exit for paddle speed
  noseThickness: 1.45, // Keep foam forward for paddle power
  tailThickness: 1.35, // Taper out the back for bite
  rockerFlatSpotLength: 20.0, // Massive 20" flat spot under the chest
  deckDome: 0.65,
  railProfile: "variable_sharp_tail",
  bottomContour: "vee_to_quad_channels",
};

export type BoardAction =
  | { type: "UPDATE_NUMBER"; param: keyof BoardModel; value: number }
  | { type: "UPDATE_STRING"; param: keyof BoardModel; value: string }
  | { type: "UPDATE_DIMENSION"; param?: any; dimension?: any; payload?: any; value?: any }
  | { type: "UPDATE_TAIL"; tailType?: any; value?: any; param?: any; payload?: any }
  | { type: "UPDATE_VOLUME"; volume: number };

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_NUMBER":
    case "UPDATE_STRING": {
      return { ...state, [action.param]: action.value };
    }
    case "UPDATE_DIMENSION": {
      const payload = (action as any).payload || action;
      const p = payload.param || payload.dimension;
      return { ...state, [p]: payload.value };
    }
    case "UPDATE_TAIL": {
      const payload = (action as any).payload || action;
      const t = payload.tailType || payload.value || payload.param;
      return { ...state, tailType: t };
    }
    case "UPDATE_VOLUME":
      return { ...state, volume: action.volume };
    default:
      return state;
  }
};

export const handleAction = (
  action: BoardAction,
  state: BoardModel,
  dispatch: (a: BoardAction) => void,
): Effect.Effect<void, never, FullClientContext> =>
  Effect.gen(function* () {
    yield* clientLog("debug", "[BoardBuilder] State Action processed", action);
  });
