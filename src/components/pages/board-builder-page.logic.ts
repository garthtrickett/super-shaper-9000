// File: src/components/pages/board-builder-page.logic.ts
import { Effect, Schema as S } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

export type TailType = "squash" | "pin" | "swallow";
export type FinSetup = "thruster" | "quad" | "twin";
export type CoreMaterial = "pu" | "eps";
export type GlassingSchedule = "light" | "standard" | "heavy";

export const Point3DSchema = S.Tuple(S.Number, S.Number, S.Number);
export const BezierCurveSchema = S.Struct({
  controlPoints: S.Array(Point3DSchema),
  tangents1: S.Array(Point3DSchema),
  tangents2: S.Array(Point3DSchema),
  weights: S.optional(S.Array(S.Number)),
});

export const ChannelLayerSchema = S.Struct({
  name: S.String,
  isSymmetric: S.Boolean,
  leftOutline: BezierCurveSchema,
  rightOutline: BezierCurveSchema,
  leftDepth: BezierCurveSchema,
  rightDepth: BezierCurveSchema,
});

export const SelectedNodeSchema = S.Struct({
  curve: S.String,
  index: S.Number,
  type: S.Literal("anchor", "tangent1", "tangent2")
});

export const BoardModelSchema = S.Struct({
  showGizmos: S.optional(S.Boolean),
  showSolidMesh: S.optional(S.Boolean),
  showHeatmap: S.optional(S.Boolean),
  showZebra: S.optional(S.Boolean),
  showApexLine: S.optional(S.Boolean),
  showOutline: S.optional(S.Boolean),
  showRockerTop: S.optional(S.Boolean),
  showRockerBottom: S.optional(S.Boolean),
  showApexOutline: S.optional(S.Boolean),
  showRailOutline: S.optional(S.Boolean),
  showApexRocker: S.optional(S.Boolean),
  showCrossSections: S.optional(S.Boolean),
  showCurvature: S.optional(S.Boolean),
  showMriView: S.optional(S.Boolean),
  mriSlicePosition: S.optional(S.Number),
  selectedNode: S.optional(S.NullOr(SelectedNodeSchema)),
  history: S.optional(S.Array(S.Unknown)),
  historyIndex: S.optional(S.Number),
  outline: BezierCurveSchema,
  outlineLayers: S.optional(S.Array(S.Struct({
    name: S.String,
    otlExt: BezierCurveSchema,
    otlInt: BezierCurveSchema
  }))),
  bottomChannels: S.optional(S.Array(ChannelLayerSchema)),
  railOutline: S.optional(BezierCurveSchema),
  apexOutline: S.optional(BezierCurveSchema),
  rockerTop: BezierCurveSchema,
  rockerBottom: BezierCurveSchema,
  apexRocker: S.optional(BezierCurveSchema),
  crossSections: S.Array(BezierCurveSchema),
  length: S.Number,
  width: S.Number,
  thickness: S.Number,
  volume: S.Number,
  finSetup: S.Literal("thruster", "quad", "twin"),
  frontFinZ: S.Number,
  frontFinX: S.Number,
  rearFinZ: S.Number,
  rearFinX: S.Number,
  toeAngle: S.Number,
  cantAngle: S.Number,
    tailType: S.Literal("squash", "pin", "swallow"),
  swallowDepth: S.Number,
  vConcaveTail: S.optional(S.Number),
  vConcaveNose: S.optional(S.Number),
  railCoefficientTail: S.optional(S.Number),
  railCoefficientNose: S.optional(S.Number),
  thicknessZStretch: S.optional(S.Number),
  coreMaterial: S.Literal("pu", "eps"),
  glassingSchedule: S.Literal("light", "standard", "heavy"),
});

export type Point3D = [number, number, number];
export interface BezierCurveData {
  controlPoints: Point3D[];
  tangents1: Point3D[];
  tangents2: Point3D[];
  weights?: number[];
}

export interface ChannelLayer {
  name: string;
  isSymmetric: boolean;
  leftOutline: BezierCurveData;
  rightOutline: BezierCurveData;
  leftDepth: BezierCurveData;
  rightDepth: BezierCurveData;
}

export type SelectedNode = {
  curve: string;
  index: number;
  type: "anchor" | "tangent1" | "tangent2";
};

export interface ManualSnapshot {
  outline: BezierCurveData;
  outlineLayers?: { name: string; otlExt: BezierCurveData; otlInt: BezierCurveData }[];
  bottomChannels?: ChannelLayer[];
  railOutline?: BezierCurveData;
  apexOutline?: BezierCurveData;
  rockerTop: BezierCurveData;
  rockerBottom: BezierCurveData;
  apexRocker?: BezierCurveData;
  crossSections: BezierCurveData[];
}

export interface BoardModel {
  showGizmos?: boolean;
  showSolidMesh?: boolean;
  showHeatmap?: boolean;
  showZebra?: boolean;
  showApexLine?: boolean;
  showOutline?: boolean;
  showRockerTop?: boolean;
  showRockerBottom?: boolean;
  showApexOutline?: boolean;
  showRailOutline?: boolean;
  showApexRocker?: boolean;
  showCrossSections?: boolean;
  showCurvature?: boolean;
  showMriView?: boolean;
  mriSlicePosition?: number;
  selectedNode?: SelectedNode | null;
  history?: ManualSnapshot[];
  historyIndex?: number;
  outline: BezierCurveData;
  outlineLayers?: { name: string; otlExt: BezierCurveData; otlInt: BezierCurveData }[];
  bottomChannels?: ChannelLayer[];
  railOutline?: BezierCurveData;
  apexOutline?: BezierCurveData;
  rockerTop: BezierCurveData;
  rockerBottom: BezierCurveData;
  apexRocker?: BezierCurveData;
  crossSections: BezierCurveData[];
  length: number;
  width: number;
  thickness: number;
  volume: number;
  finSetup: FinSetup;
  frontFinZ: number;
  frontFinX: number;
  rearFinZ: number;
  rearFinX: number;
  toeAngle: number;
  cantAngle: number;
    tailType: TailType;
  swallowDepth: number;
  vConcaveTail?: number;
  vConcaveNose?: number;
  railCoefficientTail?: number;
  railCoefficientNose?: number;
  thicknessZStretch?: number;
  coreMaterial: CoreMaterial;
  glassingSchedule: GlassingSchedule;
}

const basicOutline: BezierCurveData = {
  controlPoints: [[0, 0, -35],[9.375, 0, 0],[0, 0, 35]],
  tangents1: [[0, 0, -35],[9.375, 0, -10], [0, 0, 25]],
  tangents2: [[0, 0, -25],[9.375, 0, 10],[0, 0, 35]],
  weights: [1, 1, 1]
};

const basicRockerTop: BezierCurveData = {
  controlPoints: [[0, 1.25, -35],[0, 1.25, 0],[0, 1.25, 35]],
  tangents1: [[0, 1.25, -35], [0, 1.25, -10],[0, 1.25, 25]],
  tangents2: [[0, 1.25, -25],[0, 1.25, 10],[0, 1.25, 35]],
  weights: [1, 1, 1]
};

const basicRockerBottom: BezierCurveData = {
  controlPoints: [[0, -1.25, -35],[0, -1.25, 0],[0, -1.25, 35]],
  tangents1: [[0, -1.25, -35],[0, -1.25, -10], [0, -1.25, 25]],
  tangents2: [[0, -1.25, -25],[0, -1.25, 10],[0, -1.25, 35]],
  weights: [1, 1, 1]
};

const basicCrossSection: BezierCurveData = {
  controlPoints: [[0, -1.25, 0],[6, -1.25, 0],[9.375, 0, 0],[6, 1.25, 0],[0, 1.25, 0]],
  tangents1: [[0, -1.25, 0],[4, -1.25, 0],[9.375, -0.5, 0],[8, 1.25, 0],[2, 1.25, 0]],
  tangents2: [[2, -1.25, 0],[8, -1.25, 0],[9.375, 0.5, 0],[4, 1.25, 0],[0, 1.25, 0]],
  weights:[1, 1, 1, 1, 1]
};

export const INITIAL_STATE: BoardModel = {
  showGizmos: true,
  showSolidMesh: true,
  showHeatmap: false,
  showZebra: false,
  showApexLine: false,
  showOutline: true,
  showRockerTop: true,
  showRockerBottom: true,
  showApexOutline: true,
  showRailOutline: true,
  showApexRocker: true,
  showCrossSections: true,
  showCurvature: false,
  showMriView: false,
  mriSlicePosition: 50.0,
  selectedNode: null,
  length: 70, 
  width: 18.75,
  thickness: 2.5,
  volume: 30.5, 
  outline: basicOutline,
  rockerTop: basicRockerTop,
  rockerBottom: basicRockerBottom,
  crossSections: [basicCrossSection],
  finSetup: "quad",
  frontFinZ: 11.0, 
  frontFinX: 1.25, 
  rearFinZ: 6.0, 
  rearFinX: 1.5, 
  toeAngle: 3.0, 
  cantAngle: 6.0, 
    tailType: "squash",
  swallowDepth: 4.0,
  vConcaveTail: 0.0,
  vConcaveNose: 0.0,
  railCoefficientTail: 1.0,
  railCoefficientNose: 1.0,
  thicknessZStretch: 1.0,
  coreMaterial: "pu", 
  glassingSchedule: "heavy", 
};

export type BoardAction =
  | { type: "UPDATE_NUMBER"; param: keyof BoardModel; value: number }
  | { type: "UPDATE_STRING"; param: keyof BoardModel; value: string }
  | { type: "UPDATE_BOOLEAN"; param: keyof BoardModel; value: boolean }
  | { type: "UPDATE_VOLUME"; volume: number }
  | { type: "LOAD_DESIGN"; state: BoardModel }
  | { type: "SET_CURVES"; outline?: BezierCurveData; railOutline?: BezierCurveData; apexOutline?: BezierCurveData; rockerTop?: BezierCurveData; rockerBottom?: BezierCurveData; apexRocker?: BezierCurveData; crossSections?: BezierCurveData[] }
  | { type: "UPDATE_NODE_POSITION"; curve: string; index: number; nodeType: "anchor" | "tangent1" | "tangent2"; position: [number, number, number] }
  | { type: "SELECT_NODE"; node: SelectedNode | null }
  | { type: "UPDATE_NODE_EXACT"; curve: string; index: number; anchor?: Point3D; tangent1?: Point3D; tangent2?: Point3D; weight?: number }
  | { type: "APPLY_CONTINUITY"; curve: string; index: number; level: "G0" | "G1" | "G2"; master?: string }
  | { type: "SAVE_HISTORY_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SCALE_WIDTH"; factor: number }
  | { type: "SCALE_THICKNESS"; factor: number }
    | { type: "IMPORT_S3DX"; xml: string }
  | { type: "ADD_OUTLINE_LAYER" }
  | { type: "REMOVE_OUTLINE_LAYER"; index: number }
    | { type: "ADD_BOTTOM_CHANNEL" }
  | { type: "TOGGLE_CHANNEL_SYMMETRY"; index: number }
  | { type: "REMOVE_BOTTOM_CHANNEL"; index: number };

export const update = (state: BoardModel, _action: BoardAction): BoardModel => state;

export const handleAction = (
  action: BoardAction,
  _state: BoardModel,
  _dispatch: (a: BoardAction) => void,
): Effect.Effect<void, never, FullClientContext> =>
  Effect.gen(function* () {
    yield* clientLog("debug", "[BoardBuilder] State Action processed", action);
    if (action.type === "IMPORT_S3DX") {
      yield* clientLog("info", "[BoardBuilder] Sent S3DX XML to Rust Core for parsing", {
        xmlLength: action.xml.length
      });
    }
    if (action.type === "SET_CURVES") {
      yield* clientLog("info", "[BoardBuilder] Curves have been baked into state");
    }
  });
