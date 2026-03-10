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
