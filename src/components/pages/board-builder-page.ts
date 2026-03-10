import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import "../3d/board-viewport"; // Import the new 3D viewport component

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
  protected override createRenderRoot() { return this; }
  
  override render() {
    return html`
      <div class="flex h-full w-full bg-zinc-950">
        <!-- Render the 3D scene taking up the full remaining area -->
        <board-viewport class="flex-1 w-full h-full"></board-viewport>
      </div>
    `;
  }
}
