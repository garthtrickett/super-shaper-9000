// src/lib/client/geometry/board-curves.test.ts
import { expect } from "@open-wc/testing";
import { generateBoardCurves } from "./board-curves";
import { INITIAL_STATE } from "../../../components/pages/board-builder-page.logic";

describe("Board Curves Engine", () => {
  it("should sample Bezier curves from INITIAL_STATE", async () => {
    const curves = await generateBoardCurves(INITIAL_STATE);
    
    // Verify sampled arrays
    expect(curves.outline).to.be.an("array");
    expect(curves.rockerTop).to.be.an("array");
    expect(curves.rockerBottom).to.be.an("array");
  });
});
