import { expect } from "@open-wc/testing";
import { Schema as S } from "effect";
import {
  BoardModelSchema,
  INITIAL_STATE,
  OutlineComponentSchema,
  RockerComponentSchema,
  FinsComponentSchema,
  type BoardModel,
  type OutlineComponent,
  type RockerComponent,
  type FinsComponent,
} from "./board-builder-page.logic";

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

  it("successfully decodes and encodes BoardModel with stringers and decals", () => {
    const modelWithAesthetics: BoardModel = {
      ...INITIAL_STATE,
      stringers: [
        {
          name: "Center Stringer",
          width: 0.25,
          shift: 0.0,
          tilt: 0.0,
          colorD3d: 10320,
          mappingD3d: 0,
          imageMappedD3d: "Cedar",
          displayD3d: true,
          superpositionOrder: 1,
        },
      ],
      decals: [
        {
          file: "logo.png",
          fileRel: "logo.png",
          name: "JSB Logo",
          length: 5.0,
          width: 5.0,
          reverseLeftRight: false,
          keepProp: true,
          tilt: 0.0,
          centreX: 0.0,
          centreY: 0.0,
          centreColor: 0,
          displayD3d: true,
          deck: true,
          bottom: false,
          projectedMapping: true,
          limitRail: false,
          limitApex: false,
          limitOppositeRail: true,
          superpositionOrder: 1,
          reflexionCoef: -1.0,
          opacity: 1.0,
          resizeWithBoard: false,
          replaceWithBoard: true,
        },
      ],
    };

    const decode = S.decodeUnknownSync(BoardModelSchema);
    const encoded = S.encodeSync(BoardModelSchema)(modelWithAesthetics);

    const decoded = decode(encoded);
    expect(decoded.stringers).to.exist;
    expect(decoded.stringers!.length).to.equal(1);
    expect(decoded.stringers![0]!.name).to.equal("Center Stringer");

    expect(decoded.decals).to.exist;
    expect(decoded.decals!.length).to.equal(1);
    expect(decoded.decals![0]!.name).to.equal("JSB Logo");
    expect(decoded.decals![0]!.deck).to.be.true;
  });

  it("successfully validates, decodes, and encodes OutlineComponentSchema", () => {
    const outlineComp: OutlineComponent = {
      outline: {
        controlPoints: [[0, 0, -35], [9.375, 0, 0], [0, 0, 35]],
        tangents1: [[0, 0, -45], [9.375, 0, -10], [0, 0, 25]],
        tangents2: [[0, 0, -25], [9.375, 0, 10], [0, 0, 45]],
        weights: [1, 1, 1],
      },
      outlineLayers: [
        {
          name: "Swallow Layer",
          active: true,
          otlExt: {
            controlPoints: [[0, 0, 30], [2, 0, 35]],
            tangents1: [[0, 0, 30], [2, 0, 35]],
            tangents2: [[0, 0, 30], [2, 0, 35]],
          },
          otlInt: {
            controlPoints: [[0, 0, 30], [1.5, 0, 35]],
            tangents1: [[0, 0, 30], [1.5, 0, 35]],
            tangents2: [[0, 0, 30], [1.5, 0, 35]],
          },
        },
      ],
    };

    const decode = S.decodeUnknownSync(OutlineComponentSchema);
    const encoded = S.encodeSync(OutlineComponentSchema)(outlineComp);
    const decoded = decode(encoded);

    expect(decoded.outline).to.exist;
    expect(decoded.outlineLayers!.length).to.equal(1);
    expect(decoded.outlineLayers![0]!.name).to.equal("Swallow Layer");
  });

  it("successfully validates, decodes, and encodes RockerComponentSchema", () => {
    const rockerComp: RockerComponent = {
      rockerTop: {
        controlPoints: [[0, 1.25, -35], [0, 1.25, 35]],
        tangents1: [[0, 1.25, -45], [0, 1.25, 25]],
        tangents2: [[0, 1.25, -25], [0, 1.25, 45]],
      },
      rockerBottom: {
        controlPoints: [[0, -1.25, -35], [0, -1.25, 35]],
        tangents1: [[0, -1.25, -45], [0, -1.25, 25]],
        tangents2: [[0, -1.25, -25], [0, -1.25, 45]],
      },
    };

    const decode = S.decodeUnknownSync(RockerComponentSchema);
    const encoded = S.encodeSync(RockerComponentSchema)(rockerComp);
    const decoded = decode(encoded);

    expect(decoded.rockerTop).to.exist;
    expect(decoded.rockerBottom).to.exist;
  });

  it("successfully validates, decodes, and encodes FinsComponentSchema", () => {
    const finsComp: FinsComponent = {
      finSetup: "quad",
      frontFinZ: 11.0,
      frontFinX: 1.25,
      rearFinZ: 6.0,
      rearFinX: 1.5,
      toeAngle: 3.0,
      cantAngle: 6.0,
    };

    const decode = S.decodeUnknownSync(FinsComponentSchema);
    const encoded = S.encodeSync(FinsComponentSchema)(finsComp);
    const decoded = decode(encoded);

    expect(decoded.finSetup).to.equal("quad");
    expect(decoded.frontFinZ).to.equal(11.0);
    expect(decoded.cantAngle).to.equal(6.0);
  });
});