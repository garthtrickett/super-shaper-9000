import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
  protected override createRenderRoot() { return this; }
  
  override render() {
    return html`
      <div class="flex h-full w-full items-center justify-center">
        <h1 class="text-2xl font-bold text-zinc-500 animate-pulse">3D Canvas & Shaper Controls Loading...</h1>
      </div>
    `;
  }
}
