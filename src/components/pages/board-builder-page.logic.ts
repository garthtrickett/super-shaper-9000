import { Effect, Fiber } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round";

export interface BoardModel {
  length: number;
  width: number;
  thickness: number;
  tailType: TailType;
  isComputing: boolean;
  meshData: string | null;
}

export const INITIAL_STATE: BoardModel = {
  length: 72, // 6'0" in inches
  width: 19.5,
  thickness: 2.5,
  tailType: "squash",
  isComputing: false,
  meshData: null,
};

export type BoardAction =
  | { type: "UPDATE_DIMENSION"; dimension: "length" | "width" | "thickness"; value: number }
  | { type: "UPDATE_TAIL"; tailType: TailType }
  | { type: "TRIGGER_COMPUTE" }
  | { type: "COMPUTE_START" }
  | { type: "COMPUTE_SUCCESS"; meshData: string }
  | { type: "COMPUTE_FAILURE"; error: string };

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_DIMENSION":
      return { ...state, [action.dimension]: action.value };
    case "UPDATE_TAIL":
      return { ...state, tailType: action.tailType };
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
