import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("board-controls")
export class BoardControls extends LitElement {
  @property({ type: Number }) length = 70;
  @property({ type: Number }) width = 18.75;
  @property({ type: Number }) thickness = 2.5;
  @property({ type: Number }) volume = 30.5;
  @property({ type: Number }) noseWidth = 13.5;
  @property({ type: Number }) tailWidth = 14.0;
  @property({ type: String }) tailType = "round";
  @property({ type: String }) noseShape = "clipped";
  @property({ type: Number }) widePointOffset = 2.0;
  @property({ type: Number }) noseRocker = 5.2;
  @property({ type: Number }) tailRocker = 1.6;
  @property({ type: Number }) deckDome = 0.65;
  @property({ type: String }) railProfile = "variable_sharp_tail";
  @property({ type: String }) bottomContour = "vee_to_quad_channels";

  protected override createRenderRoot() { 
    return this; // Light DOM for Tailwind 
  }

  private _dispatchNumber(param: string, value: number) {
    this.dispatchEvent(new CustomEvent("number-changed", { 
      detail: { param, value },
      bubbles: true,
      composed: true
    }));
  }

  private _dispatchString(param: string, value: string) {
    this.dispatchEvent(new CustomEvent("string-changed", { 
      detail: { param, value },
      bubbles: true,
      composed: true
    }));
  }

  private _renderSlider(label: string, key: string, min: number, max: number, step: number, value: number, unit = "\"") {
    return html`
      <div class="mb-4">
        <div class="flex justify-between items-center mb-1">
          <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">${label}</label>
          <span class="text-xs font-mono bg-zinc-800 text-blue-400 px-1.5 py-0.5 rounded">${value.toFixed(2)}${unit}</span>
        </div>
        <input 
          type="range" 
          min="${min}" max="${max}" step="${step}" 
          .value="${String(value)}"
          @input=${(e: Event) => this._dispatchNumber(key, parseFloat((e.target as HTMLInputElement).value))}
          class="w-full accent-blue-500 cursor-pointer"
        />
      </div>
    `;
  }

  private _renderSelect(label: string, key: string, options: {value: string, label: string}[], value: string) {
    return html`
        <div class="mb-4">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">${label}</label>
          <div class="relative">
            <select 
              class="text-sm w-full appearance-none bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              .value=${value}
              @change=${(e: Event) => this._dispatchString(key, (e.target as HTMLSelectElement).value)}
            >
              ${options.map(opt => html`<option value="${opt.value}" ?selected=${value === opt.value}>${opt.label}</option>`)}
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-400">
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
              </svg>
            </div>
          </div>
        </div>
    `;
  }

  private _renderAccordion(title: string, content: unknown, open = false) {
    return html`
      <details class="group mb-2" ?open=${open}>
        <summary class="flex justify-between items-center font-bold cursor-pointer list-none text-zinc-100 uppercase tracking-widest text-xs border-b border-zinc-800 pb-2 pt-2">
          <span>${title}</span>
          <span class="transition group-open:rotate-180 text-zinc-500">
            <svg fill="none" height="16" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16"><path d="M19 9l-7 7-7-7"></path></svg>
          </span>
        </summary>
        <div class="pt-4 pb-2 text-zinc-400">
          ${content}
        </div>
      </details>
    `;
  }

  override render() {
    return html`
      <div class="p-6 flex flex-col h-full bg-zinc-900 overflow-y-auto custom-scrollbar">
        <!-- Top HUD Panel -->
        <div class="bg-zinc-950 p-4 rounded-lg border border-zinc-800 mb-6 flex flex-col items-center justify-center shadow-inner">
          <span class="text-xs text-zinc-500 uppercase tracking-widest font-semibold mb-1">Estimated Volume</span>
          <div class="text-3xl font-black text-blue-500 tracking-tighter">
            ${this.volume.toFixed(1)}<span class="text-lg text-zinc-400 ml-1">L</span>
          </div>
        </div>

        ${this._renderAccordion("Core Dimensions", html`
          ${this._renderSlider("Length", "length", 60, 96, 0.5, this.length)}
          ${this._renderSlider("Width", "width", 17, 24, 0.125, this.width)}
          ${this._renderSlider("Thickness", "thickness", 2, 3.5, 0.0625, this.thickness)}
        `, true)}

        ${this._renderAccordion("Outline & Tail", html`
          ${this._renderSelect("Nose Shape", "noseShape",[{value: "pointy", label: "Standard Point"}, {value: "torpedo", label: "Torpedo"}, {value: "clipped", label: "Clipped (Tomo)"}], this.noseShape)}
          ${this._renderSlider("Nose Width (N12)", "noseWidth", 10.0, 16.0, 0.125, this.noseWidth)}
          ${this._renderSlider("Wide Point Offset", "widePointOffset", -3, 3, 0.5, this.widePointOffset)}
          ${this._renderSlider("Tail Width (T12)", "tailWidth", 12.0, 17.0, 0.125, this.tailWidth)}
          ${this._renderSelect("Tail Type", "tailType",[{value: "squash", label: "Squash"}, {value: "pintail", label: "Pintail"}, {value: "round", label: "Rounded Pin"}, {value: "swallow", label: "Swallow"}], this.tailType)}
        `, true)}

        ${this._renderAccordion("Rocker & Foil", html`
          ${this._renderSlider("Nose Rocker", "noseRocker", 3.0, 7.0, 0.1, this.noseRocker)}
          ${this._renderSlider("Tail Rocker", "tailRocker", 1.0, 3.5, 0.1, this.tailRocker)}
          ${this._renderSlider("Deck Dome", "deckDome", 0.4, 0.9, 0.05, this.deckDome, "")}
        `, false)}

        ${this._renderAccordion("Bottom Contours", html`
          ${this._renderSelect("Rail Profile", "railProfile",[
            {value: "soft", label: "Soft & Forgiving"}, 
            {value: "boxy", label: "Boxy Performance"}, 
            {value: "variable_sharp_tail", label: "Slab-Hunter (Soft to Sharp)"}
          ], this.railProfile)}
          ${this._renderSelect("Bottom Contours", "bottomContour",[
            {value: "flat", label: "Flat"},
            {value: "single", label: "Single Concave"},
            {value: "single_to_double", label: "Single to Double"},
            {value: "vee_to_quad_channels", label: "Vee to Quad Channels"}
          ], this.bottomContour)}
        `, false)}
      </div>
    `;
  }
}
