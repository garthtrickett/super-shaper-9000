import { Effect, Fiber } from "effect";
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
  isComputing: boolean;
  meshData: string | null;
}

export const INITIAL_STATE: BoardModel = {
  // "Slab-Hunter" Defaults (65kg / Weak Paddler / Hold)
  length: 70, // 5'10"
  width: 18.75,
  thickness: 2.5,
  volume: 30.5, // Estimated placeholder until Step 5
  noseShape: "blunt",
  tailType: "round",
  widePointOffset: 2.0, // 2" Forward of center
  noseRocker: 5.2,
  tailRocker: 1.6,
  deckDome: 0.65,
  railProfile: "variable_sharp_tail",
  bottomContour: "vee_to_quad_channels",
  isComputing: false,
  meshData: null,
};

export type BoardAction =
  | { type: "UPDATE_NUMBER"; param: keyof BoardModel; value: number }
  | { type: "UPDATE_STRING"; param: keyof BoardModel; value: string }
  | { type: "UPDATE_DIMENSION"; param?: any; dimension?: any; payload?: any; value?: any }
  | { type: "UPDATE_TAIL"; tailType?: any; value?: any; param?: any; payload?: any }
  | { type: "TRIGGER_COMPUTE" }
  | { type: "COMPUTE_START" }
  | { type: "COMPUTE_SUCCESS"; meshData: string }
  | { type: "COMPUTE_FAILURE"; error: string };

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
    case "COMPUTE_START":
      return { ...state, isComputing: true };
    case "COMPUTE_SUCCESS":
      return { ...state, isComputing: false, meshData: action.meshData };
    case "COMPUTE_FAILURE":
      return { ...state, isComputing: false };
    default:
      return state;
  }
};
let computeFiber: Fiber.RuntimeFiber<void, unknown> | null = null;

export const handleAction = (
  action: BoardAction,
  state: BoardModel,
  dispatch: (a: BoardAction) => void,
): Effect.Effect<void, never, FullClientContext> =>
  Effect.gen(function* () {
    yield* clientLog("debug", "[BoardBuilder] State Action processed", action);

    if (
      action.type === "UPDATE_NUMBER" ||
      action.type === "UPDATE_STRING" ||
      action.type === "UPDATE_DIMENSION" ||
      action.type === "UPDATE_TAIL" ||
      action.type === "TRIGGER_COMPUTE"
    ) {
      if (computeFiber) {
        yield* Fiber.interrupt(computeFiber);
        computeFiber = null;
      }

      const task = Effect.gen(function* () {
        // 🚀 Instant 100% frontend native generation
        yield* Effect.sync(() => dispatch({ type: "COMPUTE_SUCCESS", meshData: "NATIVE_GENERATION" }));
      });

      computeFiber = yield* Effect.fork(task);
    }
  });
