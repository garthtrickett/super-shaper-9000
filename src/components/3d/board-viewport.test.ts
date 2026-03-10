import { expect, fixture, html } from "@open-wc/testing";
import "./board-viewport";
import type { BoardViewport } from "./board-viewport";

describe("BoardViewport", () => {
  it("should render a canvas element inside its shadow DOM", async () => {
    const el = await fixture<BoardViewport>(
      html`<board-viewport></board-viewport>`
    );
    
    const canvas = el.shadowRoot?.querySelector("canvas");
    expect(canvas).to.exist;
    expect(canvas?.tagName.toLowerCase()).to.equal("canvas");
  });
});
