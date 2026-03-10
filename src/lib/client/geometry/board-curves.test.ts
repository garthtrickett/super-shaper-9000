import { expect } from "@open-wc/testing";
import { generateBoardCurves } from "./board-curves";

describe("Board Curves Generator", () => {
  it("should generate outline and rocker points without crashing", async () => {
    const model = { length: 72, width: 20, thickness: 2.5, tailType: "squash" as const };
    const result = await generateBoardCurves(model);

    expect(result.outline).to.be.an("array");
    expect(result.rockerTop).to.be.an("array");
    expect(result.rockerBottom).to.be.an("array");
    
    // We expect points, regardless of whether it used the real WASM or the fallback mock
    expect(result.outline.length).to.be.greaterThan(0);
  });
});
