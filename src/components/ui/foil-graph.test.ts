import { expect, fixture, html } from "@open-wc/testing";
import "./foil-graph";
import type { FoilGraph } from "./foil-graph";

describe("FoilGraph", () => {
  it("renders a fallback message when no data is provided", async () => {
    const el = await fixture<FoilGraph>(html`<foil-graph></foil-graph>`);
    expect(el.textContent).to.include("No foil data");
    const svg = el.querySelector("svg");
    expect(svg).to.not.exist;
  });

  it("renders an SVG with two paths when data is provided", async () => {
    // Mock data: [z1, ct1, rt1, z2, ct2, rt2, ...]
    const mockData = new Float32Array([
      -35, 2.5, 1.0,
      0, 2.6, 1.5,
      35, 2.5, 1.0,
    ]);

    const el = await fixture<FoilGraph>(html`<foil-graph .data=${mockData}></foil-graph>`);
    
    const svg = el.querySelector("svg");
    expect(svg).to.exist;

    const paths = el.querySelectorAll("path");
    // Should have 3 paths: center thickness fill, center thickness line, rail thickness line
    expect(paths.length).to.equal(3);

        // Check that the line paths have valid 'd' attributes
    const ctPath = paths[1];
    const rtPath = paths[2];
    
    expect(ctPath!.getAttribute("d")).to.match(/^M/); // Starts with "Move to"
    expect(rtPath!.getAttribute("d")).to.match(/^M/);
    expect(ctPath!.getAttribute("d")!.split(" ").length).to.be.greaterThan(5);
    expect(rtPath!.getAttribute("d")!.split(" ").length).to.be.greaterThan(5);
  });
});
