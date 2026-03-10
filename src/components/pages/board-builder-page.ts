import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { ReactiveSamController } from "../../lib/client/reactive-sam-controller";
import { INITIAL_STATE, update, handleAction, type BoardModel, type BoardAction, type TailType } from "./board-builder-page.logic";
import "../3d/board-viewport";
import "../ui/board-controls";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
  private ctrl = new ReactiveSamController<this, BoardModel, BoardAction, never>(
    this,
    INITIAL_STATE,
    update,
    handleAction
  );

  protected override createRenderRoot() { return this; }
  
  override render() {
    const state = this.ctrl.model;

    return html`
      <div class="flex h-full w-full bg-zinc-950 text-zinc-50 relative">
        <!-- UI Controls Panel -->
        <board-controls
          class="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900 z-10 h-full overflow-y-auto"
          .length=${state.length}
          .width=${state.width}
          .thickness=${state.thickness}
          .tailType=${state.tailType}
          @dimension-changed=${(e: CustomEvent<{ dimension: "length" | "width" | "thickness"; value: number }>) => this.ctrl.propose({ type: "UPDATE_DIMENSION", dimension: e.detail.dimension, value: e.detail.value })}
          @tail-changed=${(e: CustomEvent<{ value: TailType }>) => this.ctrl.propose({ type: "UPDATE_TAIL", tailType: e.detail.value })}
        ></board-controls>

        <!-- Render the 3D scene taking up the full remaining area -->
        <board-viewport class="flex-1 w-full h-full relative z-0"></board-viewport>
      </div>
    `;
  }
}
