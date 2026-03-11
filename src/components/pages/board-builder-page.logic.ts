import { Effect, Schema as S } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round";
export type NoseShape = "pointy" | "torpedo" | "clipped";
export type BottomContour = "flat" | "single" | "single_to_double" | "vee_to_quad_channels";
export type FinSetup = "thruster" | "quad" | "twin";
export type CoreMaterial = "pu" | "eps";
export type GlassingSchedule = "light" | "standard" | "heavy";

export const BoardModelSchema = S.Struct({
  length: S.Number,
  width: S.Number,
  thickness: S.Number,
  volume: S.Number,
  noseWidth: S.Number,
  tailWidth: S.Number,
  noseShape: S.Literal("pointy", "torpedo", "clipped"),
  tailType: S.Literal("squash", "pintail", "swallow", "round"),
  swallowDepth: S.Number,
  squashCornerRadius: S.Number,
  widePointOffset: S.Number,
  noseRocker: S.Number,
  tailRocker: S.Number,
  noseThickness: S.Number,
  tailThickness: S.Number,
  rockerFlatSpotLength: S.Number,
  deckDome: S.Number,
  apexRatio: S.Number,
  railFullness: S.Number,
  hardEdgeLength: S.Number,
  veeDepth: S.Number,
  concaveDepth: S.Number,
  channelDepth: S.Number,
  channelLength: S.Number,
  bottomContour: S.Literal("flat", "single", "single_to_double", "vee_to_quad_channels"),
  finSetup: S.Literal("thruster", "quad", "twin"),
  frontFinZ: S.Number,
  frontFinX: S.Number,
  rearFinZ: S.Number,
  rearFinX: S.Number,
  toeAngle: S.Number,
  cantAngle: S.Number,
  coreMaterial: S.Literal("pu", "eps"),
  glassingSchedule: S.Literal("light", "standard", "heavy"),
});

export interface BoardModel {
  length: number;
  width: number;
  thickness: number;
  volume: number;
  noseWidth: number; // N12 (12" from nose)
  tailWidth: number; // T12 (12" from tail)
  noseShape: NoseShape;
  tailType: TailType;
  swallowDepth: number;
  squashCornerRadius: number;
  widePointOffset: number;
  noseRocker: number;
  tailRocker: number;
  noseThickness: number; // N12 Foil
  tailThickness: number; // T12 Foil
  rockerFlatSpotLength: number; // Staging belly
  deckDome: number;
  apexRatio: number;
  railFullness: number;
  hardEdgeLength: number;
  veeDepth: number;
  concaveDepth: number;
  channelDepth: number;
  channelLength: number;
  bottomContour: BottomContour;
  finSetup: FinSetup;
  frontFinZ: number;
  frontFinX: number;
  rearFinZ: number;
  rearFinX: number;
  toeAngle: number;
  cantAngle: number;
  coreMaterial: CoreMaterial;
  glassingSchedule: GlassingSchedule;
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
  swallowDepth: 4.5, // Used only if tailType is swallow
  squashCornerRadius: 0.75, // Used only if tailType is squash
  widePointOffset: 2.0, // 2" Forward of center for paddle engine
  noseRocker: 5.2, // Slightly lower entry
  tailRocker: 1.6, // Flat exit for paddle speed
  noseThickness: 1.45, // Keep foam forward for paddle power
  tailThickness: 1.35, // Taper out the back for bite
  rockerFlatSpotLength: 20.0, // Massive 20" flat spot under the chest
  deckDome: 0.65,
  apexRatio: 0.30, // 30% up from bottom (Low apex for knife hold)
  railFullness: 0.65, // Pinched, sloped profile for 65kg surfer
  hardEdgeLength: 20.0, // Sharp edge starts 20" from tail (right ahead of fins)
  veeDepth: 0.15, // Slight entry vee to split water
  concaveDepth: 0.25, // 1/4" Deep single concave engine
  channelDepth: 0.1875, // 3/16" Deep channels for bite
  channelLength: 18.0, // Channels start 18" from tail
  bottomContour: "vee_to_quad_channels",
  finSetup: "quad",
  frontFinZ: 11.0, // 11" from tail
  frontFinX: 1.25, // 1.25" off rail
  rearFinZ: 5.5, // 5.5" from tail (Clustered tightly to fronts)
  rearFinX: 1.75, // 1.75" off rail (Pulled in for hold)
  toeAngle: 3.0, // 3 degrees toe-in toward nose
  cantAngle: 6.0, // 6 degrees splay outward
  coreMaterial: "pu",
  glassingSchedule: "heavy", // 6+4/6oz to add momentum for weak paddler
};

export type BoardAction =
  | { type: "UPDATE_NUMBER"; param: keyof BoardModel; value: number }
  | { type: "UPDATE_STRING"; param: keyof BoardModel; value: string }
  | { type: "UPDATE_DIMENSION"; param?: any; dimension?: any; payload?: any; value?: any }
  | { type: "UPDATE_TAIL"; tailType?: any; value?: any; param?: any; payload?: any }
  | { type: "UPDATE_VOLUME"; volume: number }
  | { type: "LOAD_DESIGN"; state: BoardModel };

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
    case "LOAD_DESIGN":
      return { ...action.state };
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
