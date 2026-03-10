import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("board-controls")
export class BoardControls extends LitElement {
  @property({ type: Number }) length = 72;
  @property({ type: Number }) width = 19.5;
  @property({ type: Number }) thickness = 2.5;
  @property({ type: String }) tailType = "squash";

  protected override createRenderRoot() { 
    return this; // Light DOM for Tailwind 
  }

  private _dispatchDimension(dimension: "length" | "width" | "thickness", value: number) {
    this.dispatchEvent(new CustomEvent("dimension-changed", { 
      detail: { dimension, value },
      bubbles: true,
      composed: true
    }));
  }

  private _dispatchTail(value: string) {
    this.dispatchEvent(new CustomEvent("tail-changed", { 
      detail: { value },
      bubbles: true,
      composed: true
    }));
  }

  private _renderSlider(label: string, key: "length" | "width" | "thickness", min: number, max: number, step: number, value: number) {
    return html`
      <div class="mb-6">
        <div class="flex justify-between items-center mb-2">
          <label class="text-sm font-semibold text-zinc-300 uppercase tracking-wider">${label}</label>
          <span class="text-sm font-mono bg-zinc-800 text-blue-400 px-2 py-0.5 rounded">${value.toFixed(2)}"</span>
        </div>
        <input 
          type="range" 
          min="${min}" max="${max}" step="${step}" 
          .value="${String(value)}"
          @input=${(e: Event) => this._dispatchDimension(key, parseFloat((e.target as HTMLInputElement).value))}
          class="w-full accent-blue-500 cursor-pointer"
        />
      </div>
    `;
  }

  override render() {
    return html`
      <div class="p-6 flex flex-col h-full">
        <h2 class="text-lg font-black text-zinc-100 mb-6 pb-4 border-b border-zinc-800">
          Board Parameters
        </h2>

        ${this._renderSlider("Length", "length", 60, 96, 0.5, this.length)}
        ${this._renderSlider("Width", "width", 17, 24, 0.125, this.width)}
        ${this._renderSlider("Thickness", "thickness", 2, 3.5, 0.0625, this.thickness)}

        <div class="mb-6">
          <label class="block text-sm font-semibold text-zinc-300 uppercase tracking-wider mb-2">Tail Type</label>
          <div class="relative">
            <select 
              class="w-full appearance-none bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md py-2.5 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              .value=${this.tailType}
              @change=${(e: Event) => this._dispatchTail((e.target as HTMLSelectElement).value)}
            >
              <option value="squash">Squash</option>
              <option value="pintail">Pintail</option>
              <option value="swallow">Swallow</option>
              <option value="round">Round</option>
            </select>
            <!-- Custom Select Arrow -->
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
