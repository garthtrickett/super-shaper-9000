import { expect } from "@open-wc/testing";
import { Schema as S } from "effect";
import { BoardModelSchema, INITIAL_STATE, type BoardModel } from "./board-builder-page.logic";

describe("board-builder-page.logic (Effect-TS Schema)", () => {
  it("successfully decodes and encodes BoardModel with importedFinBoxes", () => {
    const modelWithFins: BoardModel = {
      ...INITIAL_STATE,
      importedFinBoxes: [
        {
          name: "Fin Center",
          style: 5,
          length: 12.0,
          width: 1.5,
          height: 4.5,
          x: 7.5,
          y: 0.0,
          z: 4.2,
          angleOz: 0.0,
          even: false,
          central: true,
          ptConvergence: 0.0,
        },
      ],
    };

    const decode = S.decodeUnknownSync(BoardModelSchema);
    const encoded = S.encodeSync(BoardModelSchema)(modelWithFins);

    const decoded = decode(encoded);
    expect(decoded.importedFinBoxes).to.exist;
    expect(decoded.importedFinBoxes!.length).to.equal(1);
    expect(decoded.importedFinBoxes![0]!.name).to.equal("Fin Center");
    expect(decoded.importedFinBoxes![0]!.central).to.be.true;
  });
});