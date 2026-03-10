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
import { html, fixture, expect } from '@open-wc/testing';
import './board-viewport';
import type { BoardViewport } from './board-viewport';

describe('board-viewport', () => {
  it('mounts and renders a canvas', async () => {
    // Mount the Lit element
    const el = await fixture<BoardViewport>(html`<board-viewport></board-viewport>`);
    
    // Ensure the canvas element exists within the shadow DOM
    const canvas = el.shadowRoot!.querySelector('canvas');
    expect(canvas).to.exist;
    expect(canvas).to.be.instanceOf(HTMLCanvasElement);
  });
});
