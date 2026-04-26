import { Effect, Schema as S } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";
import { bakeToManual } from "../../lib/client/geometry/manual-baker";

export type TailType = "squash" | "pintail" | "swallow" | "round" | "torpedo";
export type NoseShape = "pointy" | "torpedo" | "clipped";
export type BottomContour = "flat" | "single" | "single_to_double" | "vee_to_quad_channels";
export type FinSetup = "thruster" | "quad" | "twin";
export type CoreMaterial = "pu" | "eps";
export type GlassingSchedule = "light" | "standard" | "heavy";

export const Point3DSchema = S.Tuple(S.Number, S.Number, S.Number);
export const BezierCurveSchema = S.Struct({
  controlPoints: S.Array(Point3DSchema),
  tangents1: S.Array(Point3DSchema),
  tangents2: S.Array(Point3DSchema),
});

export const SelectedNodeSchema = S.Struct({
  curve: S.String,
  index: S.Number,
  type: S.Literal("anchor", "tangent1", "tangent2")
});

export const BoardModelSchema = S.Struct({
  showGizmos: S.optional(S.Boolean),
  showHeatmap: S.optional(S.Boolean),
  showZebra: S.optional(S.Boolean),
  showApexLine: S.optional(S.Boolean),
  editMode: S.optional(S.Literal("parametric", "manual")),
  selectedNode: S.optional(S.NullOr(SelectedNodeSchema)),
  manualHistory: S.optional(S.Array(S.Unknown)),
  historyIndex: S.optional(S.Number),
  manualOutline: S.optional(BezierCurveSchema),
  manualRailOutline: S.optional(BezierCurveSchema),
  manualApexOutline: S.optional(BezierCurveSchema),
  manualRockerTop: S.optional(BezierCurveSchema),
  manualRockerBottom: S.optional(BezierCurveSchema),
  manualApexRocker: S.optional(BezierCurveSchema),
  manualCrossSections: S.optional(S.Array(BezierCurveSchema)),
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

export type Point3D = [number, number, number];
export interface BezierCurveData {
  controlPoints: Point3D[];
  tangents1: Point3D[];
  tangents2: Point3D[];
}

export type SelectedNode = {
  curve: string;
  index: number;
  type: "anchor" | "tangent1" | "tangent2";
};

export interface ManualSnapshot {
  outline?: BezierCurveData;
  railOutline?: BezierCurveData;
  apexOutline?: BezierCurveData;
  rockerTop?: BezierCurveData;
  rockerBottom?: BezierCurveData;
  apexRocker?: BezierCurveData;
  crossSections?: BezierCurveData[];
}

export interface BoardModel {
  showGizmos?: boolean;
  showHeatmap?: boolean;
  showZebra?: boolean;
  showApexLine?: boolean;
  editMode?: "parametric" | "manual";
  selectedNode?: SelectedNode | null;
  manualHistory?: ManualSnapshot[];
  historyIndex?: number;
  manualOutline?: BezierCurveData;
  manualRailOutline?: BezierCurveData;
  manualApexOutline?: BezierCurveData;
  manualRockerTop?: BezierCurveData;
  manualRockerBottom?: BezierCurveData;
  manualApexRocker?: BezierCurveData;
  manualCrossSections?: BezierCurveData[];
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
  showGizmos: true,
  showHeatmap: false,
  showZebra: false,
  showApexLine: false,
  editMode: "parametric",
  selectedNode: null,
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
  | { type: "UPDATE_BOOLEAN"; param: keyof BoardModel; value: boolean }
  | { type: "UPDATE_VOLUME"; volume: number }
  | { type: "LOAD_DESIGN"; state: BoardModel }
  | { type: "SET_EDIT_MODE"; mode: "parametric" | "manual" }
  | { type: "SET_MANUAL_CURVES"; outline?: BezierCurveData; railOutline?: BezierCurveData; apexOutline?: BezierCurveData; rockerTop?: BezierCurveData; rockerBottom?: BezierCurveData; apexRocker?: BezierCurveData; crossSections?: BezierCurveData[] }
  | { type: "CONVERT_TO_MANUAL" }
  | { type: "UPDATE_MANUAL_NODE_POSITION"; curve: string; index: number; nodeType: "anchor" | "tangent1" | "tangent2"; position: [number, number, number] }
  | { type: "SELECT_NODE"; node: SelectedNode | null }
  | { type: "UPDATE_NODE_EXACT"; curve: string; index: number; anchor?: Point3D; tangent1?: Point3D; tangent2?: Point3D }
  | { type: "SAVE_HISTORY_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "IMPORT_S3DX"; length: number; width: number; thickness: number; outline: BezierCurveData; railOutline: BezierCurveData; apexOutline: BezierCurveData; rockerTop: BezierCurveData; rockerBottom: BezierCurveData; apexRocker: BezierCurveData; crossSections: BezierCurveData[] };

// Helper to push an immutable snapshot to the history stack
const pushHistory = (currentState: BoardModel): BoardModel => {
  const snapshot: ManualSnapshot = {
    outline: currentState.manualOutline,
    railOutline: currentState.manualRailOutline,
    apexOutline: currentState.manualApexOutline,
    rockerTop: currentState.manualRockerTop,
    rockerBottom: currentState.manualRockerBottom,
    apexRocker: currentState.manualApexRocker,
    crossSections: currentState.manualCrossSections,
  };
  const currentHistory = currentState.manualHistory || [];
  const currentIndex = currentState.historyIndex ?? -1;
  
  // Drop any "Redo" futures if we branch off a new timeline
  const newHistory = currentHistory.slice(0, currentIndex + 1);
  newHistory.push(snapshot);
  
  // Prevent memory leaks by capping undo history at 50 actions
  if (newHistory.length > 50) newHistory.shift();
  
  return { ...currentState, manualHistory: newHistory, historyIndex: newHistory.length - 1 };
};

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_NUMBER":
    case "UPDATE_STRING":
    case "UPDATE_BOOLEAN": {
      const newState = { ...state, [action.param]: action.value } as unknown as BoardModel;
      // Enforce mutually exclusive diagnostic visualizers
      if (action.param === "showHeatmap" && action.value === true) {
        newState.showZebra = false;
      }
      if (action.param === "showZebra" && action.value === true) {
        newState.showHeatmap = false;
      }
      return newState;
    }
    case "UPDATE_VOLUME":
      return { ...state, volume: action.volume };
    case "LOAD_DESIGN":
      return { ...action.state };
    case "SET_EDIT_MODE":
      return { ...state, editMode: action.mode };
    case "SELECT_NODE":
      return { ...state, selectedNode: action.node };
    case "UPDATE_NODE_EXACT": {
      if (state.editMode !== "manual") return state;
      const { curve, index, anchor, tangent1, tangent2 } = action;
      
      let targetCurve: BezierCurveData | undefined;
      let crossSectionIdx = -1;

      if (curve === "outline") targetCurve = state.manualOutline;
      else if (curve === "rockerTop") targetCurve = state.manualRockerTop;
      else if (curve === "rockerBottom") targetCurve = state.manualRockerBottom;
      else if (curve.startsWith("crossSection_")) {
        crossSectionIdx = parseInt(curve.split("_")[1]!, 10);
        targetCurve = state.manualCrossSections?.[crossSectionIdx];
      }

      if (!targetCurve) return state;

      const updatedCurve: BezierCurveData = {
        controlPoints: [...targetCurve.controlPoints],
        tangents1: [...targetCurve.tangents1],
        tangents2: [...targetCurve.tangents2],
      };

      // Apply exact overrides supplied by the UI Inspector
      if (anchor) updatedCurve.controlPoints[index] = [...anchor];
      if (tangent1) updatedCurve.tangents1[index] = [...tangent1];
      if (tangent2) updatedCurve.tangents2[index] = [...tangent2];

      let newState = state;
      if (curve === "outline") newState = { ...state, manualOutline: updatedCurve };
      else if (curve === "rockerTop") newState = { ...state, manualRockerTop: updatedCurve };
      else if (curve === "rockerBottom") newState = { ...state, manualRockerBottom: updatedCurve };
      else if (crossSectionIdx !== -1 && state.manualCrossSections) {
        const newCrossSections = [...state.manualCrossSections];
        newCrossSections[crossSectionIdx] = updatedCurve;
        newState = { ...state, manualCrossSections: newCrossSections };
      }
      // Auto-snapshot history when directly typing exact numbers into the UI
      return pushHistory(newState);
    }
    case "SAVE_HISTORY_SNAPSHOT":
      return pushHistory(state);
    case "UNDO": {
      if (!state.manualHistory || state.historyIndex === undefined || state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      const snap = state.manualHistory[newIndex]!;
      return {
        ...state,
        historyIndex: newIndex,
        manualOutline: snap.outline,
        manualRailOutline: snap.railOutline,
        manualApexOutline: snap.apexOutline,
        manualRockerTop: snap.rockerTop,
        manualRockerBottom: snap.rockerBottom,
        manualApexRocker: snap.apexRocker,
        manualCrossSections: snap.crossSections
      };
    }
    case "REDO": {
      if (!state.manualHistory || state.historyIndex === undefined || state.historyIndex >= state.manualHistory.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      const snap = state.manualHistory[newIndex]!;
      return {
        ...state,
        historyIndex: newIndex,
        manualOutline: snap.outline,
        manualRailOutline: snap.railOutline,
        manualApexOutline: snap.apexOutline,
        manualRockerTop: snap.rockerTop,
        manualRockerBottom: snap.rockerBottom,
        manualApexRocker: snap.apexRocker,
        manualCrossSections: snap.crossSections
      };
    }
    case "SET_MANUAL_CURVES": {
      const newState = {
        ...state,
        ...(action.outline && { manualOutline: action.outline }),
        ...(action.railOutline && { manualRailOutline: action.railOutline }),
        ...(action.apexOutline && { manualApexOutline: action.apexOutline }),
        ...(action.rockerTop && { manualRockerTop: action.rockerTop }),
        ...(action.rockerBottom && { manualRockerBottom: action.rockerBottom }),
        ...(action.apexRocker && { manualApexRocker: action.apexRocker }),
        ...(action.crossSections && { manualCrossSections: action.crossSections }),
      };
      // We initialize the first history snapshot immediately upon entering manual mode
      return pushHistory(newState);
    }
    case "IMPORT_S3DX": {
      const newState = {
        ...state,
        editMode: "manual" as const,
        length: action.length,
        width: action.width,
        thickness: action.thickness,
        manualOutline: action.outline,
        manualRailOutline: action.railOutline,
        manualApexOutline: action.apexOutline,
        manualRockerTop: action.rockerTop,
        manualRockerBottom: action.rockerBottom,
        manualApexRocker: action.apexRocker,
        manualCrossSections: action.crossSections,
      };
      return pushHistory(newState);
    }
    case "CONVERT_TO_MANUAL":
      // Handled asynchronously in the handleAction effect
      return state;
    case "UPDATE_MANUAL_NODE_POSITION": {
      if (state.editMode !== "manual") return state;
      const { curve, index, nodeType, position } = action;
      
      let targetCurve: BezierCurveData | undefined;
      let crossSectionIdx = -1;

      if (curve === "outline") targetCurve = state.manualOutline;
      else if (curve === "rockerTop") targetCurve = state.manualRockerTop;
      else if (curve === "rockerBottom") targetCurve = state.manualRockerBottom;
      else if (curve.startsWith("crossSection_")) {
        crossSectionIdx = parseInt(curve.split("_")[1]!, 10);
        targetCurve = state.manualCrossSections?.[crossSectionIdx];
      }

      if (!targetCurve) return state;

      // Deep copy the curve to maintain immutability
      const updatedCurve: BezierCurveData = {
        controlPoints: [...targetCurve.controlPoints],
        tangents1: [...targetCurve.tangents1],
        tangents2: [...targetCurve.tangents2],
      };

      // --- STEP 4: Planar & Stringer Locks ---
      if (curve === "outline") position[1] = 0;
      if (curve === "rockerTop" || curve === "rockerBottom") position[0] = 0;
      if (crossSectionIdx !== -1) position[2] = targetCurve.controlPoints[index]![2];

      // Only force Rockers to the stringer. Outline can have wide tails (squash/square).
      if ((curve === "rockerTop" || curve === "rockerBottom") && 
          (index === 0 || index === targetCurve.controlPoints.length - 1)) {
        position[0] = 0; 
      }

      // --- Math Helpers for Kinematics ---
      const vec3Sub = (a: Point3D, b: Point3D): Point3D => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
      const vec3Add = (a: Point3D, b: Point3D): Point3D => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
      const vec3Len = (v: Point3D): number => Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
      const vec3Scale = (v: Point3D, s: number): Point3D => [v[0]*s, v[1]*s, v[2]*s];

      const oldAnchor = targetCurve.controlPoints[index];
      const oldT1 = targetCurve.tangents1[index];
      const oldT2 = targetCurve.tangents2[index];

      // --- STEP 4: C1 Continuity & Translation ---
      if (nodeType === "anchor" && oldAnchor) {
        const delta = vec3Sub(position, oldAnchor);
        updatedCurve.controlPoints[index] = [...position];
        
        // Move handles relative to anchor
        if (oldT1) updatedCurve.tangents1[index] = vec3Add(oldT1, delta);
        if (oldT2) updatedCurve.tangents2[index] = vec3Add(oldT2, delta);
        
      } else if (nodeType === "tangent1" && oldAnchor && oldT1) {
        updatedCurve.tangents1[index] = [...position];
        
        // Pivot opposite handle (C1 Continuity)
        if (oldT2) {
          const dir1 = vec3Sub(position, oldAnchor);
          const len1 = vec3Len(dir1);
          if (len1 > 0.001) {
            const norm1 = vec3Scale(dir1, 1 / len1);
            const origDist2 = vec3Len(vec3Sub(oldT2, oldAnchor));
            updatedCurve.tangents2[index] = vec3Sub(oldAnchor, vec3Scale(norm1, origDist2));
          }
        }
        
      } else if (nodeType === "tangent2" && oldAnchor && oldT2) {
        updatedCurve.tangents2[index] = [...position];
        
        // Pivot opposite handle (C1 Continuity)
        if (oldT1) {
          const dir2 = vec3Sub(position, oldAnchor);
          const len2 = vec3Len(dir2);
          if (len2 > 0.001) {
            const norm2 = vec3Scale(dir2, 1 / len2);
            const origDist1 = vec3Len(vec3Sub(oldT1, oldAnchor));
            updatedCurve.tangents1[index] = vec3Sub(oldAnchor, vec3Scale(norm2, origDist1));
          }
        }
      }

      if (curve === "outline") return { ...state, outline: updatedCurve };
      if (curve === "rockerTop") return { ...state, rockerTop: updatedCurve };
      if (curve === "rockerBottom") return { ...state, rockerBottom: updatedCurve };
      if (curve === "apexOutline") return { ...state, apexOutline: updatedCurve };
      if (curve === "railOutline") return { ...state, railOutline: updatedCurve };
      if (curve === "apexRocker") return { ...state, apexRocker: updatedCurve };
      if (crossSectionIdx !== -1) {
        const newCrossSections =[...state.crossSections];
        newCrossSections[crossSectionIdx] = updatedCurve;
        return { ...state, crossSections: newCrossSections };
      }
      return state;
    }
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
    
    if (action.type === "IMPORT_S3DX") {
      yield* clientLog("info", "[BoardBuilder] Imported S3DX file", {
        length: action.length,
        width: action.width,
        thickness: action.thickness
      });
    }
    if (action.type === "SET_CURVES") {
      yield* clientLog("info", "[BoardBuilder] Curves have been baked into state", {
        hasOutline: !!action.outline,
        hasRockerTop: !!action.rockerTop,
        hasRockerBottom: !!action.rockerBottom,
        crossSectionsCount: action.crossSections?.length ?? 0
      });
    }
  });
