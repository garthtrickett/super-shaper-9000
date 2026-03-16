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
  noseTipWidth: S.Number,
  noseTipCurveZ: S.Number,
  tailBlockWidth: S.Number,
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
  noseTipWidth: number;
  noseTipCurveZ: number;
  tailBlockWidth: number;
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
  // 65kg Slab-Hunter Specs (Maximum Hold / Weak Paddler)
  length: 70, // 5'10"
  width: 18.75,
  thickness: 2.5,
  volume: 30.5, 
  noseWidth: 14.0, // N12: Wide enough to paddle, but clipped
  tailWidth: 13.5, // T12: Ultra-narrow rounded pin for hold
  noseShape: "clipped",
  tailType: "round",
  swallowDepth: 4.5,
  noseTipWidth: 4.0,
  noseTipCurveZ: 1.5,
  tailBlockWidth: 6.0,
  widePointOffset: 2.0, // 2" Forward of center for paddle engine
  noseRocker: 5.2, // Slab Entry flip
  tailRocker: 1.6, // Flat exit for paddle speed
  noseThickness: 1.45,
  tailThickness: 1.35,
  rockerFlatSpotLength: 20.0, // Long flat belly under chest
  deckDome: 0.65, // Slight dome to taper the rails
  apexRatio: 0.30, // Low apex for knife hold
  railFullness: 0.60, // Pinched, tapered rails for 65kg
  hardEdgeLength: 20.0, // Sharp edge starts ahead of fins
  veeDepth: 0.15, // Entry vee to split water
  concaveDepth: 0.25, // Single concave engine
  channelDepth: 0.125, // 1/8" deep channels for monorail tracking
  channelLength: 12.0, // Running out the last 12" of the tail
  bottomContour: "vee_to_quad_channels",
  finSetup: "quad",
  frontFinZ: 11.0, 
  frontFinX: 1.25, 
  rearFinZ: 6.0, // Clustered close to fronts
  rearFinX: 1.5, // Pulled in slightly for tracking
  toeAngle: 3.0, 
  cantAngle: 6.0, 
  coreMaterial: "pu", // High-Density PU
  glassingSchedule: "heavy", // 6+4/6oz to add momentum
};

export type BoardAction =
  | { type: "UPDATE_NUMBER"; param: keyof BoardModel; value: number }
  | { type: "UPDATE_STRING"; param: keyof BoardModel; value: string }
  | { type: "UPDATE_VOLUME"; volume: number }
  | { type: "LOAD_DESIGN"; state: BoardModel };

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_NUMBER":
    case "UPDATE_STRING": {
      return { ...state, [action.param]: action.value } as unknown as BoardModel;
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
  _state: BoardModel,
  _dispatch: (a: BoardAction) => void,
): Effect.Effect<void, never, FullClientContext> =>
  Effect.gen(function* () {
    yield* clientLog("debug", "[BoardBuilder] State Action processed", action);
  });
