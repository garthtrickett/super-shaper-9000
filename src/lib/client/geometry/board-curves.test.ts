// src/lib/client/geometry/board-curves.test.ts
import { expect } from "@open-wc/testing";
import { generateBoardCurves, deps } from "./board-curves";
import { INITIAL_STATE } from "../../../components/pages/board-builder-page.logic";
import sinon from "sinon";
import type { BoardModel } from "../../../components/pages/board-builder-page.logic";

describe("Board Curves Engine", () => {
  let getRhinoStub: sinon.SinonStub;

  beforeEach(() => {
    // Mock getRhino to fail safely and return the fallback geometry
    getRhinoStub = sinon.stub(deps, "getRhino").rejects(new Error("WASM not available in test env"));
  });

  afterEach(() => {
    getRhinoStub.restore();
  });

  it("should fall back to simple geometry if WASM fails to load", async () => {
    const curves = await generateBoardCurves(INITIAL_STATE);
    
    // Verify the fallback outline triangle
    expect(curves.outline).to.be.an("array").that.has.lengthOf(3);
    expect(curves.rockerTop).to.be.an("array").that.has.lengthOf(3);
    expect(curves.rockerBottom).to.be.an("array").that.has.lengthOf(3);

    const wpZ = curves.outline[1]![2];
    // The fallback center point Z should remain 0
    expect(wpZ).to.equal(0);
  });
});

describe("Board Curves Generator", () => {
  const originalGetRhino = deps.getRhino;

  afterEach(() => {
    // Restore original unmocked dependency
    deps.getRhino = originalGetRhino;
  });

  it("should use fallback math if rhino fails to load", async () => {
    deps.getRhino = () => Promise.reject(new Error("WASM block"));
    
    const model = { length: 72, width: 20, thickness: 2.5, tailType: "squash" as const };
    const result = await generateBoardCurves({ ...model } as unknown as BoardModel);
    
    // Verify fallback points derived from L, W, T
    expect(result.outline[0]).to.deep.equal([0, 0, -36]); // Nose
    expect(result.outline[1]).to.deep.equal([10, 0, 0]);  // Center wide point
    expect(result.outline[2]).to.deep.equal([0, 0, 36]);  // Tail
    
    expect(result.rockerTop[0]).to.deep.equal([0, 1.25, -36]);
    expect(result.rockerBottom[0]).to.deep.equal([0, -1.25, -36]);
  });

  it("should calculate correct tail widths for different tail types using Rhino math", async () => {
    // Stub Rhino behavior to just return the control points passed to it
    deps.getRhino = () => Promise.resolve({
      Point3dList: class {
        points: number[][] =[];
        add(x: number, y: number, z: number) { this.points.push([x, y, z]); }
        delete() {}
      },
      NurbsCurve: {
        create: (_periodic: boolean, _degree: number, ptsList: any) => {
          return {
            domain:[0, ptsList.points.length - 1],
            pointAt: (t: number) => {
              // Mock evaluation by simply returning the control points 
              const idx = Math.min(Math.floor(t), ptsList.points.length - 1);
              return ptsList.points[idx];
            },
            delete: () => {}
          };
        }
      }
    });
    
    // Pintail (5% of width)
    let model = { length: 72, width: 20, thickness: 2.5, tailType: "pintail" } as unknown as BoardModel;
    let result = await generateBoardCurves(model);
    let tailPoint = result.outline[result.outline.length - 1]!;
    expect(tailPoint[0]).to.equal(20 * 0.05);

    // Squash (30% of width)
    model = { ...model, tailType: "squash" };
    result = await generateBoardCurves(model);
    tailPoint = result.outline[result.outline.length - 1]!;
    expect(tailPoint[0]).to.equal(20 * 0.3);

    // Swallow (35% of width)
    model = { ...model, tailType: "swallow" };
    result = await generateBoardCurves(model);
    tailPoint = result.outline[result.outline.length - 1]!;
    expect(tailPoint[0]).to.equal(20 * 0.35);
  });
});
