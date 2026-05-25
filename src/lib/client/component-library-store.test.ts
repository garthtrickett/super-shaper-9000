import { expect } from "@open-wc/testing";
import {
  getComponentIndex,
  saveComponentToLibrary,
  loadComponentFromLibrary,
  deleteComponentFromLibrary,
} from "./component-library-store";
import { type ComponentPayload } from "../../components/pages/board-builder-page.logic";

describe("ComponentLibraryStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should return an empty array when no components are saved", () => {
    const index = getComponentIndex();
    expect(index).to.be.an("array").that.is.empty;
  });

  it("should successfully save an outline component and update index", () => {
    const payload: ComponentPayload = {
      outline: {
        controlPoints: [[0, 0, -35], [9, 0, 0], [0, 0, 35]],
        tangents1: [[0, 0, -45], [9, 0, -10], [0, 0, 25]],
        tangents2: [[0, 0, -25], [9, 0, 10], [0, 0, 45]],
        weights: [1, 1, 1],
      },
    };

    const id = saveComponentToLibrary("My Wide Tail", "outline", payload);
    expect(id).to.be.a("string");

    const index = getComponentIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id);
    expect(index[0]!.name).to.equal("My Wide Tail");
    expect(index[0]!.type).to.equal("outline");

    const loaded = loadComponentFromLibrary(id);
    expect(loaded).to.exist;
    expect((loaded as any).outline).to.exist;
  });

  it("should reject invalid payloads with a validation error during save", () => {
    const invalidPayload = {
      outline: {
        controlPoints: "not-an-array",
      },
    } as unknown as ComponentPayload;

    expect(() => saveComponentToLibrary("Corrupted", "outline", invalidPayload)).to.throw(
      "Schema validation failed"
    );
    expect(getComponentIndex()).to.be.an("array").that.is.empty;
  });

  it("should return null if the loaded component has a corrupted structure", () => {
    const payload: ComponentPayload = {
      crossSections: [
        {
          controlPoints: [[0, -1.25, 0], [6, -1.25, 0], [9.375, 0, 0]],
          tangents1: [[-2, -1.25, 0], [4, -1.25, 0], [9.375, -0.5, 0]],
          tangents2: [[2, -1.25, 0], [8, -1.25, 0], [9.375, 0.5, 0]],
          weights: [1, 1, 1],
        },
      ],
    };

    const id = saveComponentToLibrary("Slices", "slices", payload);
    localStorage.setItem(`super_shaper_component_${id}`, "{ invalid json");

    const loaded = loadComponentFromLibrary(id);
    expect(loaded).to.be.null;
  });

  it("should delete components and correctly update index", () => {
    const payload: ComponentPayload = {
      finSetup: "quad",
      frontFinZ: 11.0,
      frontFinX: 1.25,
      rearFinZ: 6.0,
      rearFinX: 1.5,
      toeAngle: 3.0,
      cantAngle: 6.0,
    };

    const id1 = saveComponentToLibrary("Fins 1", "fins", payload);
    const id2 = saveComponentToLibrary("Fins 2", "fins", payload);

    expect(getComponentIndex().length).to.equal(2);

    deleteComponentFromLibrary(id1);

    const index = getComponentIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id2);
    expect(loadComponentFromLibrary(id1)).to.be.null;
  });
});