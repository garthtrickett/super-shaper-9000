import { expect } from "@open-wc/testing";
import { update, INITIAL_STATE, type BoardAction } from "./board-builder-page.logic";

describe("BoardBuilder Logic", () => {
  it("should correctly update a dimension", () => {
    const action: BoardAction = { type: "UPDATE_DIMENSION", dimension: "length", value: 80 };
    const nextState = update(INITIAL_STATE, action);
    
    expect(nextState.length).to.equal(80);
    // Ensure immutability / other props preserved
    expect(nextState.width).to.equal(INITIAL_STATE.width);
    expect(nextState.tailType).to.equal(INITIAL_STATE.tailType);
  });

  it("should correctly update tail type", () => {
    const action: BoardAction = { type: "UPDATE_TAIL", tailType: "swallow" };
    const nextState = update(INITIAL_STATE, action);
    
    expect(nextState.tailType).to.equal("swallow");
    expect(nextState.length).to.equal(INITIAL_STATE.length);
  });
});
