import { Effect, Schema as S } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pintail" | "swallow" | "round" | "torpedo";
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
  tailType: S.Literal("squash", "pintail", "swallow", "round", "torpedo"),
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
  // Tomo Hydronaut / Symmetrical Torpedo Specs
  length: 70, // 5'10"
  width: 19.0, // Parallel rails
  thickness: 2.5,
  volume: 32.5, 
  noseWidth: 14.5, // N12: Wide and symmetrical
  tailWidth: 14.5, // T12: Symmetrical to nose
  noseShape: "torpedo",
  tailType: "torpedo",
  swallowDepth: 4.5, // Used only if tailType is swallow
  squashCornerRadius: 0.75, // Used only if tailType is squash
  widePointOffset: 0.0, // Dead center for perfect symmetry
  noseRocker: 4.5, // Flatter entry
  tailRocker: 2.0, // Continuous curve
  noseThickness: 1.5, // Balanced foil
  tailThickness: 1.5, // Balanced foil
  rockerFlatSpotLength: 24.0, // Huge flat spot for paddle speed
  deckDome: 0.65,
  apexRatio: 0.35, // Forgiving apex
  railFullness: 0.70, // Boxier rails to hold volume
  hardEdgeLength: 18.0, // Sharp edge starts ahead of fins
  veeDepth: 0.15, 
  concaveDepth: 0.25, 
  channelDepth: 0.1875, 
  channelLength: 18.0, 
  bottomContour: "single_to_double", // Standard high performance contour
  finSetup: "quad",
  frontFinZ: 11.0, 
  frontFinX: 1.25, 
  rearFinZ: 5.5, 
  rearFinX: 1.75, 
  toeAngle: 3.0, 
  cantAngle: 6.0, 
  coreMaterial: "eps", // Tomo boards are usually EPS
  glassingSchedule: "standard", 
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
