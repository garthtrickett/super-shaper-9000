import { expect } from "@open-wc/testing";
import { update, INITIAL_STATE, type BoardAction } from "./board-builder-page.logic";

describe("Board Builder State Logic", () => {
  it("should initialize with parametric editMode", () => {
    expect(INITIAL_STATE.editMode).to.equal("parametric");
  });

  it("should update editMode to manual", () => {
    const nextState = update(INITIAL_STATE, { type: "SET_EDIT_MODE", mode: "manual" });
    expect(nextState.editMode).to.equal("manual");
  });

  it("should set manual curves", () => {
    const mockBezier = {
      controlPoints: [[0, 0, 0] as [number, number, number]],
      tangents1: [[0, 0, 0] as [number, number, number]],
      tangents2: [[0, 0, 0] as [number, number, number]],
    };
    
    const nextState = update(INITIAL_STATE, {
      type: "SET_MANUAL_CURVES",
      outline: mockBezier
    });
    
    expect(nextState.manualOutline).to.deep.equal(mockBezier);
    expect(nextState.manualRockerTop).to.be.undefined;
  });

  it("should ignore state mutation for CONVERT_TO_MANUAL because it is async", () => {
    const nextState = update(INITIAL_STATE, { type: "CONVERT_TO_MANUAL" });
    expect(nextState).to.equal(INITIAL_STATE);
  });
});

describe("Board Builder Logic", () => {
  it("should correctly update a number parameter", () => {
    const action: BoardAction = { type: "UPDATE_NUMBER", param: "length", value: 75 };
    const newState = update(INITIAL_STATE, action);
    expect(newState.length).to.equal(75);
    // Ensure immutable
    expect(INITIAL_STATE.length).to.equal(70);
  });

  it("should correctly update a string parameter", () => {
    const action: BoardAction = { type: "UPDATE_STRING", param: "noseShape", value: "pointy" };
    const newState = update(INITIAL_STATE, action);
    expect(newState.noseShape).to.equal("pointy");
  });

});

describe("BoardBuilder Logic", () => {
  it("should correctly update a dimension", () => {
    const action: BoardAction = { type: "UPDATE_NUMBER", param: "length", value: 80 };
    const nextState = update(INITIAL_STATE, action);
    
    expect(nextState.length).to.equal(80);
    // Ensure immutability / other props preserved
    expect(nextState.width).to.equal(INITIAL_STATE.width);
    expect(nextState.tailType).to.equal(INITIAL_STATE.tailType);
  });

  it("should correctly update tail type", () => {
    const action: BoardAction = { type: "UPDATE_STRING", param: "tailType", value: "swallow" };
    const nextState = update(INITIAL_STATE, action);
    
    expect(nextState.tailType).to.equal("swallow");
    expect(nextState.length).to.equal(INITIAL_STATE.length);
  });
});
