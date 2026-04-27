import { expect } from "@open-wc/testing";
import { update, INITIAL_STATE, type BoardAction, type BoardModel, type BezierCurveData } from "./board-builder-page.logic";

describe("Board Builder Logic (SAM Reducer)", () => {
  const mockCurve: BezierCurveData = {
    controlPoints: [[0, 0, 0],[0, 0, 0], [0, 0, 0]],
    tangents1: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    tangents2: [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  };

  describe("Undo / Redo History Stack", () => {
    it("initializes the history stack when setting curves", () => {
      const state = update(INITIAL_STATE, {
        type: "SET_CURVES",
        outline: mockCurve
      });

      expect(state.history).to.exist;
      expect(state.history?.length).to.equal(1);
      expect(state.historyIndex).to.equal(0);
    });

    it("navigates backward and forward safely through history", () => {
      // 1. Init
      let state = update(INITIAL_STATE, { type: "SET_CURVES", outline: mockCurve });

      // 2. Make an edit (Snapshot 2)
      state = update(state, {
        type: "UPDATE_NODE_EXACT",
        curve: "outline",
        index: 1,
        anchor: [10, 0, 0]
      });

      expect(state.historyIndex).to.equal(1);
      expect(state.outline?.controlPoints[1]![0]).to.equal(10);

      // 3. UNDO
      state = update(state, { type: "UNDO" });
      expect(state.historyIndex).to.equal(0);
      expect(state.outline?.controlPoints[1]![0]).to.equal(0); // Back to original

      // 4. REDO
      state = update(state, { type: "REDO" });
      expect(state.historyIndex).to.equal(1);
      expect(state.outline?.controlPoints[1]![0]).to.equal(10); // Forward to edit
    });

    it("drops redo futures when a new timeline branch is created", () => {
      let state = update(INITIAL_STATE, { type: "SET_CURVES", outline: mockCurve });

      // State 1:[10, 0, 0]
      state = update(state, { type: "UPDATE_NODE_EXACT", curve: "outline", index: 1, anchor:[10, 0, 0] });
      // State 2: [20, 0, 0]
      state = update(state, { type: "UPDATE_NODE_EXACT", curve: "outline", index: 1, anchor:[20, 0, 0] });

      expect(state.history?.length).to.equal(3); // [Init, State 1, State 2]
      expect(state.historyIndex).to.equal(2);

      // Undo back to Init
      state = update(state, { type: "UNDO" });
      state = update(state, { type: "UNDO" });
      expect(state.historyIndex).to.equal(0);

      // Branch the timeline! Make a new edit from Init.
      state = update(state, { type: "UPDATE_NODE_EXACT", curve: "outline", index: 1, anchor:[99, 0, 0] });

      // The futures (State 1 and State 2) should be destroyed.
      expect(state.history?.length).to.equal(2); // [Init, New State]
      expect(state.historyIndex).to.equal(1);
      expect(state.outline?.controlPoints[1]![0]).to.equal(99);
    });
  });

  describe("Node Inspector (Exact Updates)", () => {
    it("updates exact coordinates of an anchor and tangents simultaneously", () => {
      let state = update(INITIAL_STATE, { type: "SET_CURVES", outline: mockCurve });

      state = update(state, {
        type: "UPDATE_NODE_EXACT",
        curve: "outline",
        index: 1,
        anchor: [1, 1, 1],
        tangent1:[2, 2, 2],
        tangent2: [3, 3, 3]
      });

      const out = state.outline!;
      expect(out.controlPoints[1]).to.deep.equal([1, 1, 1]);
      expect(out.tangents1[1]).to.deep.equal([2, 2, 2]);
      expect(out.tangents2[1]).to.deep.equal([3, 3, 3]);
    });
  });
});

describe("Board Builder State & Kinematic Logic", () => {
  describe("Parameters", () => {
    it("should correctly update a number parameter", () => {
      const action: BoardAction = { type: "UPDATE_NUMBER", param: "length", value: 75 };
      const newState = update(INITIAL_STATE, action);
      expect(newState.length).to.equal(75);
      expect(INITIAL_STATE.length).to.equal(70); // Ensure immutable
    });

    it("should disable Zebra Flow when Heatmap is enabled", () => {
      const stateWithZebra = { ...INITIAL_STATE, showZebra: true, showHeatmap: false };
      const action: BoardAction = { type: "UPDATE_BOOLEAN", param: "showHeatmap", value: true };
      const newState = update(stateWithZebra, action);
      expect(newState.showHeatmap).to.be.true;
      expect(newState.showZebra).to.be.false;
    });

    it("should disable Heatmap when Zebra Flow is enabled", () => {
      const stateWithHeatmap = { ...INITIAL_STATE, showHeatmap: true, showZebra: false };
      const action: BoardAction = { type: "UPDATE_BOOLEAN", param: "showZebra", value: true };
      const newState = update(stateWithHeatmap, action);
      expect(newState.showZebra).to.be.true;
      expect(newState.showHeatmap).to.be.false;
    });

    it("should handle IMPORT_S3DX by pushing history", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockCurve = { controlPoints: [[1,1,1]], tangents1: [[1,1,1]], tangents2: [[1,1,1]] } as any;
      const action: BoardAction = {
        type: "IMPORT_S3DX",
        length: 70,
        width: 20,
        thickness: 3,
        outline: mockCurve,
        railOutline: mockCurve,
        apexOutline: mockCurve,
        rockerTop: mockCurve,
        rockerBottom: mockCurve,
        apexRocker: mockCurve,
        crossSections:[mockCurve]
      };
      const newState = update(INITIAL_STATE, action);
      
      expect(newState.length).to.equal(70);
      expect(newState.width).to.equal(20);
      expect(newState.thickness).to.equal(3);
      expect(newState.history?.length).to.equal(1);
      expect(newState.outline).to.deep.equal(mockCurve);
    });
  });

  describe("Kinematic Constraints", () => {
    // Setup a mock state with basic straight lines to verify math
    const MOCK_STATE: BoardModel = {
      ...INITIAL_STATE,
      outline: {
        controlPoints: [[0, 0, -10],[5, 0, 0], [0, 0, 10]],
        tangents1: [[0, 0, -10], [5, 0, -2], [0, 0, 8]],
        tangents2: [[0, 0, -8], [5, 0, 2], [0, 0, 10]],
      },
      rockerTop: {
        controlPoints: [[0, 2, -10], [0, 2, 0],[0, 2, 10]],
        tangents1: [[0, 2, -10],[0, 2, -2], [0, 2, 8]],
        tangents2: [[0, 2, -8], [0, 2, 2],[0, 2, 10]],
      },
      rockerBottom: {
        controlPoints: [[0, -1, -10], [0, -1, 0], [0, -1, 10]],
        tangents1: [[0, -1, -10], [0, -1, -2],[0, -1, 8]],
        tangents2: [[0, -1, -8],[0, -1, 2], [0, -1, 10]],
      }
    };

    it("should clamp stringer locks (Nose/Tail anchors cannot move off X=0)", () => {
      // Try to move nose (index 0) to x=5
      const action: BoardAction = {
        type: "UPDATE_NODE_POSITION",
        curve: "outline",
        index: 0,
        nodeType: "anchor",
        position:[5, 0, -10]
      };
      const newState = update(MOCK_STATE, action);
      
      // X should be clamped back to 0
      expect(newState.outline?.controlPoints[0]?.[0]).to.equal(0);
    });

    it("should clamp planar locks for Outline (Y cannot change)", () => {
      // Try to move center anchor (index 1) to y=5
      const action: BoardAction = {
        type: "UPDATE_NODE_POSITION",
        curve: "outline",
        index: 1,
        nodeType: "anchor",
        position:[6, 5, 0]
      };
      const newState = update(MOCK_STATE, action);
      
      // Y should be clamped back to 0, X should be 6
      expect(newState.outline?.controlPoints[1]?.[1]).to.equal(0);
      expect(newState.outline?.controlPoints[1]?.[0]).to.equal(6);
    });

    it("should clamp planar locks for Rocker (X cannot change)", () => {
      // Try to move center rocker anchor to x=5
      const action: BoardAction = {
        type: "UPDATE_NODE_POSITION",
        curve: "rockerTop",
        index: 1,
        nodeType: "anchor",
        position:[5, 3, 0]
      };
      const newState = update(MOCK_STATE, action);
      
      // X should be clamped back to 0, Y should be 3
      expect(newState.rockerTop?.controlPoints[1]?.[0]).to.equal(0);
      expect(newState.rockerTop?.controlPoints[1]?.[1]).to.equal(3);
    });

    it("should translate handles when anchor is moved", () => {
      const action: BoardAction = {
        type: "UPDATE_NODE_POSITION",
        curve: "outline",
        index: 1,
        nodeType: "anchor",
        position: [6, 0, 1] // Moved +1 in X and +1 in Z
      };
      const newState = update(MOCK_STATE, action);
      
      // Anchor moved
      expect(newState.outline?.controlPoints[1]).to.deep.equal([6, 0, 1]);
      // Handles translated equally (+1 X, +1 Z)
      expect(newState.outline?.tangents1[1]).to.deep.equal([6, 0, -1]); // Was [5, 0, -2]
      expect(newState.outline?.tangents2[1]).to.deep.equal([6, 0, 3]);  // Was[5, 0, 2]
    });

    it("should enforce C1 Continuity (pivoting T2 when T1 moves)", () => {
      // Move T1 from [5, 0, -2] to [3, 0, -2] (shifting it inward in X)
      const action: BoardAction = {
        type: "UPDATE_NODE_POSITION",
        curve: "outline",
        index: 1,
        nodeType: "tangent1",
        position:[3, 0, -2]
      };
      const newState = update(MOCK_STATE, action);
      
      // Anchor remains the same
      expect(newState.outline?.controlPoints[1]).to.deep.equal([5, 0, 0]);
      
      // T1 is successfully updated
      expect(newState.outline?.tangents1[1]).to.deep.equal([3, 0, -2]);
      
      // T2 should have pivoted to remain collinear with T1 and Anchor.
      // Dir1 =[3-5, 0, -2-0] = [-2, 0, -2]
      // Len1 = sqrt(8) ~ 2.828
      // Norm1 =[-0.707, 0, -0.707]
      // Orig T2 dist = 2
      // Target T2 = Anchor - (Norm1 * 2) = [5,0,0] - [-1.414, 0, -1.414] =[6.414, 0, 1.414]
      
      const t2 = newState.outline?.tangents2[1];
      expect(t2).to.not.be.undefined;
      expect(t2![0]).to.be.closeTo(6.414, 0.01);
      expect(t2![1]).to.equal(0);
      expect(t2![2]).to.be.closeTo(1.414, 0.01);
    });
  });
});
