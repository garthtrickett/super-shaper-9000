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

  override firstUpdated() {
    this.ctrl.propose({ type: "TRIGGER_COMPUTE" });
  }
  
  override render() {
    const state = this.ctrl.model;

    return html`
      <div class="flex h-full w-full bg-zinc-950 text-zinc-50 relative">
        <!-- UI Controls Panel -->
        <board-controls
          class="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900 z-10 h-full overflow-y-auto shadow-2xl"
          .length=${state.length}
          .width=${state.width}
          .thickness=${state.thickness}
          .volume=${state.volume}
          .noseShape=${state.noseShape}
          .tailType=${state.tailType}
          .widePointOffset=${state.widePointOffset}
          .noseRocker=${state.noseRocker}
          .tailRocker=${state.tailRocker}
          .deckDome=${state.deckDome}
          .railProfile=${state.railProfile}
          .bottomContour=${state.bottomContour}
          @number-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => this.ctrl.propose({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value })}
          @string-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: string }>) => this.ctrl.propose({ type: "UPDATE_STRING", param: e.detail.param, value: e.detail.value })}
        ></board-controls>

        <!-- Render the 3D scene taking up the full remaining area -->
        ${state.isComputing 
          ? html`
              <div class="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm pointer-events-none">
                <div class="text-2xl font-black text-blue-500 tracking-widest uppercase animate-pulse">Shaping...</div>
              </div>
            `
          : ""}
        <board-viewport 
          class="flex-1 w-full h-full relative z-0"
          .boardState=${state}
        ></board-viewport>
      </div>
    `;
  }
}
