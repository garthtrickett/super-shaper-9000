import { Effect } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round";
export type NoseShape = "pointy" | "blunt";
export type RailProfile = "soft" | "boxy" | "variable_sharp_tail";
export type BottomContour = "flat" | "single" | "single_to_double" | "vee_to_quad_channels";

export interface BoardModel {
  length: number;
  width: number;
  thickness: number;
  volume: number;
  noseShape: NoseShape;
  tailType: TailType;
  widePointOffset: number;
  noseRocker: number;
  tailRocker: number;
  deckDome: number;
  railProfile: RailProfile;
  bottomContour: BottomContour;
}

export const INITIAL_STATE: BoardModel = {
  // Traditional High-Performance Shortboard Defaults
  length: 70, // 5'10"
  width: 18.75,
  thickness: 2.5,
  volume: 30.5, // Estimated placeholder until Step 5
  noseShape: "pointy",
  tailType: "squash",
  widePointOffset: -1.0, // 1" Back from center for standard HPSB
  noseRocker: 5.2,
  tailRocker: 1.6,
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
