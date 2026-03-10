import { Effect } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round";

export interface BoardModel {
  length: number;
  width: number;
  thickness: number;
  tailType: TailType;
}

export const INITIAL_STATE: BoardModel = {
  length: 72, // 6'0" in inches
  width: 19.5,
  thickness: 2.5,
  tailType: "squash",
};

export type BoardAction =
  | { type: "UPDATE_DIMENSION"; dimension: "length" | "width" | "thickness"; value: number }
  | { type: "UPDATE_TAIL"; tailType: TailType };

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_DIMENSION":
      return { ...state, [action.dimension]: action.value };
    case "UPDATE_TAIL":
      return { ...state, tailType: action.tailType };
    default:
      return state;
  }
};

export const handleAction = (
  action: BoardAction,
  _state: BoardModel,
  _dispatch: (a: BoardAction) => void,
): Effect.Effect<void, never, FullClientContext> =>
  Effect.gen(function* () {
    yield* clientLog("debug", "[BoardBuilder] State Action processed", action);
  });
