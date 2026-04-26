import { Effect, Schema as S } from "effect";
import { clientLog } from "../../lib/client/clientLog";
import type { FullClientContext } from "../../lib/client/runtime";

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
  showOutline: S.optional(S.Boolean),
  showRockerTop: S.optional(S.Boolean),
  showRockerBottom: S.optional(S.Boolean),
  showApexOutline: S.optional(S.Boolean),
  showRailOutline: S.optional(S.Boolean),
  showApexRocker: S.optional(S.Boolean),
  showCrossSections: S.optional(S.Boolean),
  selectedNode: S.optional(S.NullOr(SelectedNodeSchema)),
  history: S.optional(S.Array(S.Unknown)),
  historyIndex: S.optional(S.Number),
  outline: BezierCurveSchema,
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
  outline: BezierCurveData;
  railOutline?: BezierCurveData;
  apexOutline?: BezierCurveData;
  rockerTop: BezierCurveData;
  rockerBottom: BezierCurveData;
  apexRocker?: BezierCurveData;
  crossSections: BezierCurveData[];
}

export interface BoardModel {
  showGizmos?: boolean;
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
  selectedNode?: SelectedNode | null;
  history?: ManualSnapshot[];
  historyIndex?: number;
  outline: BezierCurveData;
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
  coreMaterial: CoreMaterial;
  glassingSchedule: GlassingSchedule;
}

const basicOutline: BezierCurveData = {
  controlPoints: [[0, 0, -35], [9.375, 0, 0], [0, 0, 35]],
  tangents1: [[0, 0, -35], [9.375, 0, -10], [0, 0, 25]],
  tangents2: [[0, 0, -25], [9.375, 0, 10], [0, 0, 35]]
};

const basicRockerTop: BezierCurveData = {
  controlPoints: [[0, 1.25, -35], [0, 1.25, 0], [0, 1.25, 35]],
  tangents1: [[0, 1.25, -35], [0, 1.25, -10], [0, 1.25, 25]],
  tangents2: [[0, 1.25, -25], [0, 1.25, 10], [0, 1.25, 35]]
};

const basicRockerBottom: BezierCurveData = {
  controlPoints: [[0, -1.25, -35], [0, -1.25, 0], [0, -1.25, 35]],
  tangents1: [[0, -1.25, -35], [0, -1.25, -10], [0, -1.25, 25]],
  tangents2: [[0, -1.25, -25], [0, -1.25, 10], [0, -1.25, 35]]
};

const basicCrossSection: BezierCurveData = {
  controlPoints: [[0, -1.25, 0], [6, -1.25, 0], [9.375, 0, 0], [6, 1.25, 0], [0, 1.25, 0]],
  tangents1: [[0, -1.25, 0], [4, -1.25, 0], [9.375, -0.5, 0], [8, 1.25, 0], [2, 1.25, 0]],
  tangents2: [[2, -1.25, 0], [8, -1.25, 0], [9.375, 0.5, 0], [4, 1.25, 0], [0, 1.25, 0]],
};

export const INITIAL_STATE: BoardModel = {
  showGizmos: true,
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
  | { type: "UPDATE_NODE_EXACT"; curve: string; index: number; anchor?: Point3D; tangent1?: Point3D; tangent2?: Point3D }
  | { type: "SAVE_HISTORY_SNAPSHOT" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SCALE_WIDTH"; factor: number }
  | { type: "SCALE_THICKNESS"; factor: number }
  | { type: "IMPORT_S3DX"; length: number; width: number; thickness: number; outline: BezierCurveData; railOutline: BezierCurveData; apexOutline: BezierCurveData; rockerTop: BezierCurveData; rockerBottom: BezierCurveData; apexRocker: BezierCurveData; crossSections: BezierCurveData[] };

const pushHistory = (currentState: BoardModel): BoardModel => {
  const snapshot: ManualSnapshot = {
    outline: currentState.outline,
    railOutline: currentState.railOutline,
    apexOutline: currentState.apexOutline,
    rockerTop: currentState.rockerTop,
    rockerBottom: currentState.rockerBottom,
    apexRocker: currentState.apexRocker,
    crossSections: currentState.crossSections,
  };
  const currentHistory = currentState.history || [];
  const currentIndex = currentState.historyIndex ?? -1;
  const newHistory = currentHistory.slice(0, currentIndex + 1);
  newHistory.push(snapshot);
  if (newHistory.length > 50) newHistory.shift();
  return { ...currentState, history: newHistory, historyIndex: newHistory.length - 1 };
};

export const update = (state: BoardModel, action: BoardAction): BoardModel => {
  switch (action.type) {
    case "UPDATE_NUMBER":
    case "UPDATE_STRING":
    case "UPDATE_BOOLEAN": {
      const newState = { ...state, [action.param]: action.value } as unknown as BoardModel;
      if (action.param === "showHeatmap" && action.value === true) newState.showZebra = false;
      if (action.param === "showZebra" && action.value === true) newState.showHeatmap = false;
      return newState;
    }
    case "UPDATE_VOLUME":
      return { ...state, volume: action.volume };
    case "LOAD_DESIGN":
      return { ...action.state };
    case "SELECT_NODE":
      return { ...state, selectedNode: action.node };
    case "SCALE_WIDTH": {
      const scaleCurveWidth = (curve: BezierCurveData | undefined): BezierCurveData | undefined => {
        if (!curve) return undefined;
        return {
          controlPoints: curve.controlPoints.map(p => [p[0] * action.factor, p[1], p[2]]),
          tangents1: curve.tangents1.map(p => [p[0] * action.factor, p[1], p[2]]),
          tangents2: curve.tangents2.map(p => [p[0] * action.factor, p[1], p[2]]),
        };
      };
      
      const newState = {
        ...state,
        width: state.width * action.factor,
        outline: scaleCurveWidth(state.outline)!,
        railOutline: scaleCurveWidth(state.railOutline),
        apexOutline: scaleCurveWidth(state.apexOutline),
        crossSections: state.crossSections.map(cs => scaleCurveWidth(cs)!),
      };
      return pushHistory(newState);
    }
    case "SCALE_THICKNESS": {
      const scaleCurveThickness = (curve: BezierCurveData | undefined): BezierCurveData | undefined => {
        if (!curve) return undefined;
        return {
          controlPoints: curve.controlPoints.map(p => [p[0], p[1] * action.factor, p[2]]),
          tangents1: curve.tangents1.map(p => [p[0], p[1] * action.factor, p[2]]),
          tangents2: curve.tangents2.map(p => [p[0], p[1] * action.factor, p[2]]),
        };
      };
      
      const newState = {
        ...state,
        thickness: state.thickness * action.factor,
        rockerTop: scaleCurveThickness(state.rockerTop)!,
        rockerBottom: scaleCurveThickness(state.rockerBottom)!,
        apexRocker: scaleCurveThickness(state.apexRocker),
        crossSections: state.crossSections.map(cs => scaleCurveThickness(cs)!),
      };
      return pushHistory(newState);
    }
    case "UPDATE_NODE_EXACT": {
      const { curve, index, anchor, tangent1, tangent2 } = action;
      let targetCurve: BezierCurveData | undefined;
      let crossSectionIdx = -1;

      if (curve === "outline") targetCurve = state.outline;
      else if (curve === "rockerTop") targetCurve = state.rockerTop;
      else if (curve === "rockerBottom") targetCurve = state.rockerBottom;
      else if (curve === "apexOutline") targetCurve = state.apexOutline;
      else if (curve === "railOutline") targetCurve = state.railOutline;
      else if (curve === "apexRocker") targetCurve = state.apexRocker;
      else if (curve.startsWith("crossSection_")) {
        crossSectionIdx = parseInt(curve.split("_")[1]!, 10);
        targetCurve = state.crossSections[crossSectionIdx];
      }

      if (!targetCurve) return state;

      const updatedCurve: BezierCurveData = {
        controlPoints: [...targetCurve.controlPoints],
        tangents1: [...targetCurve.tangents1],
        tangents2: [...targetCurve.tangents2],
      };

      if (anchor) {
        updatedCurve.controlPoints[index] =[...anchor];
        if (crossSectionIdx !== -1 && (index === 0 || index === targetCurve.controlPoints.length - 1)) {
          updatedCurve.controlPoints[index]![0] = 0;
        }
        if ((curve === "outline" || curve === "apexOutline" || curve === "railOutline") && (index === 0 || index === targetCurve.controlPoints.length - 1)) {
          updatedCurve.controlPoints[index]![0] = 0;
        }

        if (curve === "outline" || curve === "apexOutline" || curve === "railOutline" || crossSectionIdx !== -1) {
          if (updatedCurve.controlPoints[index]![0] < 0) updatedCurve.controlPoints[index]![0] = 0;
        }
      }
      if (tangent1) updatedCurve.tangents1[index] = [...tangent1];
      if (tangent2) updatedCurve.tangents2[index] = [...tangent2];

      let newState = state;
      if (curve === "outline") newState = { ...state, outline: updatedCurve };
      else if (curve === "rockerTop") newState = { ...state, rockerTop: updatedCurve };
      else if (curve === "rockerBottom") newState = { ...state, rockerBottom: updatedCurve };
      else if (curve === "apexOutline") newState = { ...state, apexOutline: updatedCurve };
      else if (curve === "railOutline") newState = { ...state, railOutline: updatedCurve };
      else if (curve === "apexRocker") newState = { ...state, apexRocker: updatedCurve };
      else if (crossSectionIdx !== -1) {
        const newCrossSections = [...state.crossSections];
        newCrossSections[crossSectionIdx] = updatedCurve;
        newState = { ...state, crossSections: newCrossSections };
      }
      return pushHistory(newState);
    }
    case "SAVE_HISTORY_SNAPSHOT":
      return pushHistory(state);
    case "UNDO": {
      if (!state.history || state.historyIndex === undefined || state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      const snap = state.history[newIndex]! as ManualSnapshot;
      return {
        ...state,
        historyIndex: newIndex,
        outline: snap.outline,
        railOutline: snap.railOutline,
        apexOutline: snap.apexOutline,
        rockerTop: snap.rockerTop,
        rockerBottom: snap.rockerBottom,
        apexRocker: snap.apexRocker,
        crossSections: snap.crossSections
      };
    }
    case "REDO": {
      if (!state.history || state.historyIndex === undefined || state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      const snap = state.history[newIndex]! as ManualSnapshot;
      return {
        ...state,
        historyIndex: newIndex,
        outline: snap.outline,
        railOutline: snap.railOutline,
        apexOutline: snap.apexOutline,
        rockerTop: snap.rockerTop,
        rockerBottom: snap.rockerBottom,
        apexRocker: snap.apexRocker,
        crossSections: snap.crossSections
      };
    }
    case "SET_CURVES": {
      const newState = {
        ...state,
        ...(action.outline && { outline: action.outline }),
        ...(action.railOutline && { railOutline: action.railOutline }),
        ...(action.apexOutline && { apexOutline: action.apexOutline }),
        ...(action.rockerTop && { rockerTop: action.rockerTop }),
        ...(action.rockerBottom && { rockerBottom: action.rockerBottom }),
        ...(action.apexRocker && { apexRocker: action.apexRocker }),
        ...(action.crossSections && { crossSections: action.crossSections }),
      };
      return pushHistory(newState);
    }
    case "IMPORT_S3DX": {
      const newState = {
        ...state,
        length: action.length,
        width: action.width,
        thickness: action.thickness,
        outline: action.outline,
        railOutline: action.railOutline,
        apexOutline: action.apexOutline,
        rockerTop: action.rockerTop,
        rockerBottom: action.rockerBottom,
        apexRocker: action.apexRocker,
        crossSections: action.crossSections,
      };
      return pushHistory(newState);
    }
    case "UPDATE_NODE_POSITION": {
      const { curve, index, nodeType, position } = action;
      let targetCurve: BezierCurveData | undefined;
      let crossSectionIdx = -1;

      if (curve === "outline") targetCurve = state.outline;
      else if (curve === "rockerTop") targetCurve = state.rockerTop;
      else if (curve === "rockerBottom") targetCurve = state.rockerBottom;
      else if (curve === "apexOutline") targetCurve = state.apexOutline;
      else if (curve === "railOutline") targetCurve = state.railOutline;
      else if (curve === "apexRocker") targetCurve = state.apexRocker;
      else if (curve.startsWith("crossSection_")) {
        crossSectionIdx = parseInt(curve.split("_")[1]!, 10);
        targetCurve = state.crossSections[crossSectionIdx];
      }

      if (!targetCurve) return state;

      const updatedCurve: BezierCurveData = {
        controlPoints: [...targetCurve.controlPoints],
        tangents1: [...targetCurve.tangents1],
        tangents2: [...targetCurve.tangents2],
      };

      if (curve === "outline" || curve === "apexOutline" || curve === "railOutline") position[1] = 0;
      if (curve === "rockerTop" || curve === "rockerBottom" || curve === "apexRocker") position[0] = 0;
      if (crossSectionIdx !== -1) position[2] = targetCurve.controlPoints[index]![2];

      if (nodeType === "anchor") {
        if (crossSectionIdx !== -1 && (index === 0 || index === targetCurve.controlPoints.length - 1)) {
          position[0] = 0;
        }
        if ((curve === "outline" || curve === "apexOutline" || curve === "railOutline") && (index === 0 || index === targetCurve.controlPoints.length - 1)) {
          position[0] = 0;
        }
        
        if (curve === "outline" || curve === "apexOutline" || curve === "railOutline" || crossSectionIdx !== -1) {
          if (position[0] < 0) position[0] = 0;
        }
      }

      const vec3Sub = (a: Point3D, b: Point3D): Point3D =>[a[0]-b[0], a[1]-b[1], a[2]-b[2]];
      const vec3Add = (a: Point3D, b: Point3D): Point3D => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
      const vec3Len = (v: Point3D): number => Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
      const vec3Scale = (v: Point3D, s: number): Point3D => [v[0]*s, v[1]*s, v[2]*s];

      const oldAnchor = targetCurve.controlPoints[index];
      const oldT1 = targetCurve.tangents1[index];
      const oldT2 = targetCurve.tangents2[index];

      if (nodeType === "anchor" && oldAnchor) {
        const delta = vec3Sub(position, oldAnchor);
        updatedCurve.controlPoints[index] = [...position];
        if (oldT1) updatedCurve.tangents1[index] = vec3Add(oldT1, delta);
        if (oldT2) updatedCurve.tangents2[index] = vec3Add(oldT2, delta);
      } else if (nodeType === "tangent1" && oldAnchor && oldT1) {
        updatedCurve.tangents1[index] = [...position];
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
        const newCrossSections = [...state.crossSections];
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
        length: action.length, width: action.width, thickness: action.thickness
      });
    }
    if (action.type === "SET_CURVES") {
      yield* clientLog("info", "[BoardBuilder] Curves have been baked into state");
    }
  });
