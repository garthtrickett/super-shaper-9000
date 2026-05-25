import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";

import type { StringerConfig, DecalConfig } from "../pages/board-builder-page.logic";

@customElement("board-controls")
export class BoardControls extends LitElement {
  @property({ type: Number }) length = 70;
  @property({ type: Number }) width = 18.75;
        @property({ type: Number }) thickness = 2.5;
  @property({ type: Object }) meshData?: { volumeLiters: number; vertexCount: number; triangleCount: number };
  @property({ type: String }) tailType = "squash";
  @property({ type: Number }) swallowDepth = 4.0;
  @property({ type: String }) finSetup = "quad";
  @property({ type: Number }) frontFinZ = 11.0;
  @property({ type: Number }) frontFinX = 1.25;
  @property({ type: Number }) rearFinZ = 5.5;
  @property({ type: Number }) rearFinX = 1.75;
  @property({ type: Number }) toeAngle = 3.0;
  @property({ type: Number }) cantAngle = 6.0;
  @property({ type: String }) coreMaterial = "pu";
            @property({ type: String }) glassingSchedule = "heavy";
          @property({ type: Array }) outlineLayers: { name: string, active?: boolean }[] =[];
        @property({ type: Array }) bottomChannels: { name: string, isSymmetric?: boolean }[] =[];
      @property({ type: Array }) stringers: StringerConfig[] = [];
      @property({ type: Array }) decals: DecalConfig[] = [];
      @property({ type: Object }) foilData?: Float32Array;

    // Physics Engine: Calculate weight based on volume, core density, and glassing weight
  get estimatedWeight() {
    const baseFoam = this.coreMaterial === 'eps' ? 1.5 : 2.5; // lbs per cubic ft
    const volume = this.meshData?.volumeLiters ?? 0.0;
    const cubicFt = volume / 28.3168;
    const foamWeight = cubicFt * baseFoam;
    const glassWeight = this.glassingSchedule === 'heavy' ? 3.5 : this.glassingSchedule === 'standard' ? 2.5 : 1.8;
    const stringerWeight = 0.5;
    return (foamWeight + glassWeight + stringerWeight) * 0.453592; // Convert lbs to kg
  }

  protected override createRenderRoot() { 
    return this; // Light DOM for Tailwind 
  }

    private _dragValues: Record<string, number> = {};
  private _activeDragKeys = new Set<string>();
    private _lastDispatched: Record<string, number> = {};

    private _dispatchNumber(param: string, value: number) {
    if (this._lastDispatched[param] === value) return;
    this._lastDispatched[param] = value;
    
    if (param.startsWith("stringer_")) {
      const parts = param.split("_");
      const index = parseInt(parts[1]!, 10);
      const field = parts[2]!;
      const s = this.stringers[index];
      if (s) {
        const width = field === "width" ? value : s.width;
        const shift = field === "shift" ? value : s.shift;
        const tilt = field === "tilt" ? value : s.tilt;
        this.dispatchEvent(new CustomEvent("update-stringer", {
          detail: { index, width, shift, tilt },
          bubbles: true, composed: true
        }));
      }
      return;
    }

    if (param.startsWith("decal_")) {
      const parts = param.split("_");
      const index = parseInt(parts[1]!, 10);
      const field = parts[2]!;
      const d = this.decals[index];
      if (d) {
        const centreX = field === "centreX" ? value : d.centreX;
        const centreY = field === "centreY" ? value : d.centreY;
        const length = field === "length" ? value : d.length;
        const width = field === "width" ? value : d.width;
        this.dispatchEvent(new CustomEvent("update-decal", {
          detail: { index, centreX, centreY, length, width, deck: d.deck },
          bubbles: true, composed: true
        }));
      }
      return;
    }

    this.dispatchEvent(new CustomEvent("number-changed", {
      detail: { param, value },
      bubbles: true,
      composed: true
    }));
  }

  private _dispatchPreviewNumber(param: string, value: number) {
    this.dispatchEvent(new CustomEvent("preview-number", { 
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

  private _dispatchBoolean(param: string, value: boolean) {
    this.dispatchEvent(new CustomEvent("boolean-changed", { 
      detail: { param, value },
      bubbles: true,
      composed: true
    }));
  }

    private _renderSlider(label: string, key: string, min: number, max: number, step: number, value: number, unit = "\"", disabled = false) {
    if (!this._activeDragKeys.has(key) && this._dragValues[key] === value) {
      delete this._dragValues[key];
    }

    const activeValue = this._dragValues[key] !== undefined ? this._dragValues[key] : value;
    
    let displayValue = `${activeValue.toFixed(2)}${unit}`;
    
    // Surfboards conventionally display length in feet and inches (e.g., 5'10")
    if (key === "length") {
      const feet = Math.floor(activeValue / 12);
      const inches = activeValue % 12;
      const inchStr = inches % 1 === 0 ? inches.toString() : inches.toFixed(1);
      displayValue = `${feet}'${inchStr}"`;
    }

    return html`
      <div class="mb-4">
        <div class="flex justify-between items-center mb-1">
          <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">${label}</label>
                                        <input 
            type="text"
            .value=${live(displayValue)}
            ?disabled=${disabled}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const valStr = input.value.trim();
              let parsedVal = NaN;
              
              if (key === "length" && valStr.includes("'")) {
                const parts = valStr.split("'");
                const feet = parseFloat(parts[0] || "0") || 0;
                const inches = parseFloat(parts[1]?.replace('"', '') || "0");
                parsedVal = feet * 12 + inches;
              } else {
                parsedVal = parseFloat(valStr.replace(/[^\d.-]/g, ''));
              }

              if (!isNaN(parsedVal)) {
                const clamped = Math.max(min, Math.min(max, parsedVal));
                this._dispatchNumber(key, clamped);
              } else {
                input.value = displayValue;
              }
            }}
            @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
            class="text-xs font-mono bg-zinc-800 text-blue-400 px-1.5 py-0.5 rounded w-20 text-right outline-none focus:ring-1 focus:ring-blue-500 border border-transparent transition-all"
          />
        </div>
                <input 
          type="range" 
          min="${min}" max="${max}" step="${step}" 
          .value=${live(String(activeValue))}
          ?disabled=${disabled}
          @pointerdown=${() => this._activeDragKeys.add(key)}
          @pointerup=${() => {
            this._activeDragKeys.delete(key);
            const finalVal = this._dragValues[key];
            if (finalVal !== undefined) this._dispatchNumber(key, finalVal);
          }}
                    @pointercancel=${() => {
            this._activeDragKeys.delete(key);
            const finalVal = this._dragValues[key];
            if (finalVal !== undefined) this._dispatchNumber(key, finalVal);
          }}
                              @input=${(e: Event) => {
            const val = parseFloat((e.target as HTMLInputElement).value);
            this._dragValues[key] = val;
            this.requestUpdate();
            if (key === "mriSlicePosition") {
              this._dispatchPreviewNumber(key, val);
            }
          }}
          class="w-full accent-blue-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
        />
      </div>
    `;
  }

  private _renderSelect(label: string, key: string, options: {value: string, label: string}[], value: string, disabled = false) {
    return html`
        <div class="mb-4">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">${label}</label>
          <div class="relative">
                        <select 
              class="text-sm w-full appearance-none bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              .value=${live(value)}
              ?disabled=${disabled}
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
    console.info("[BoardControls] Entering render...");
    const res = html`
      <div class="p-6 flex flex-col h-full bg-zinc-900 overflow-y-auto custom-scrollbar relative">
        <!-- Import / Export Actions -->
        <div class="mb-2">
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('new-design', { bubbles: true, composed: true }))} class="w-full bg-red-900/40 hover:bg-red-800/60 text-[10px] font-bold text-red-200 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer border border-red-900/50">Start New Design</button>
        </div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('import-design', { bubbles: true, composed: true }))} class="bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Import Design</button>
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('export-design', { bubbles: true, composed: true }))} class="bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Export JSON</button>
        </div>
                        <div class="mb-2">
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('export-obj', { bubbles: true, composed: true }))} class="w-full bg-purple-600 hover:bg-purple-500 text-[10px] font-bold text-white py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Export OBJ (3D Mesh)</button>
        </div>
                <div class="grid grid-cols-2 gap-2 mb-5 mt-2">
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('export-s3dx', { bubbles: true, composed: true }))} class="w-full bg-emerald-600 hover:bg-emerald-500 text-[10px] font-bold text-white py-2 rounded transition-colors uppercase tracking-wider cursor-pointer flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-900/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Export .s3dx
          </button>
          <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('export-brd', { bubbles: true, composed: true }))} class="w-full bg-cyan-600 hover:bg-cyan-500 text-[10px] font-bold text-white py-2 rounded transition-colors uppercase tracking-wider cursor-pointer flex flex-col items-center justify-center gap-1 shadow-lg shadow-cyan-900/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Export .brd
          </button>
        </div>

                                        <!-- Foil Graph -->
        <div class="mb-6">
          <label class="flex justify-between items-center text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">
            <span>Foil Distribution</span>
          </label>
          <foil-graph .data=${this.foilData}></foil-graph>
        </div>

        <!-- Top HUD Panel -->
                <div class="bg-zinc-950 p-4 rounded-lg border border-zinc-800 mb-6 grid grid-cols-2 gap-y-4 gap-x-2 shadow-inner">
          <!-- Volume -->
          <div class="flex flex-col items-center">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Est. Volume</span>
            <div class="text-2xl font-black text-blue-500 tracking-tighter">
              ${(this.meshData?.volumeLiters ?? 0).toFixed(1)}<span class="text-sm text-zinc-400 ml-1">L</span>
            </div>
          </div>
          <!-- Weight -->
          <div class="flex flex-col items-center">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Est. Weight</span>
            <div class="text-2xl font-black text-emerald-500 tracking-tighter">
              ${this.estimatedWeight.toFixed(1)}<span class="text-sm text-zinc-400 ml-1">kg</span>
            </div>
          </div>
          <!-- Vertices -->
          <div class="flex flex-col items-center pt-2 border-t border-zinc-800">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Vertices</span>
            <div class="text-xl font-black text-zinc-400 tracking-tighter">
              ${((this.meshData?.vertexCount ?? 0) / 1000).toFixed(1)}<span class="text-xs text-zinc-500 ml-1">k</span>
            </div>
          </div>
          <!-- Triangles -->
          <div class="flex flex-col items-center pt-2 border-t border-zinc-800">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Triangles</span>
            <div class="text-xl font-black text-zinc-400 tracking-tighter">
              ${((this.meshData?.triangleCount ?? 0) / 1000).toFixed(1)}<span class="text-xs text-zinc-500 ml-1">k</span>
            </div>
          </div>
        </div>

                                                                                                                                ${this._renderAccordion("Structure & Layers", html`
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Outline Layers</label>
                            <button type="button"
                @click=${() => this.dispatchEvent(new CustomEvent('add-outline-layer', { bubbles: true, composed: true }))} 
                class="px-2 py-0.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                title="Add Wing/Flyer"
              >ADD</button>
            </div>
                        ${(this.outlineLayers ||[]).length === 0 
              ? html`<p class="text-xs text-zinc-500 text-center py-2">No wings defined.</p>`
              : (this.outlineLayers ||[]).map((layer, index) => html`
              <div class="flex items-center justify-between mb-1 bg-zinc-800/50 p-1.5 rounded">
                <span class="text-xs text-zinc-400">${layer.name}</span>
                <div class="flex items-center gap-1">
                  <button 
                    @click=${() => this.dispatchEvent(new CustomEvent('toggle-outline-layer', { detail: { index }, bubbles: true, composed: true }))}
                    class="w-5 h-5 flex items-center justify-center text-[10px] ${layer.active !== false ? 'bg-blue-600/50 hover:bg-blue-600' : 'bg-zinc-600/50 hover:bg-zinc-600'} text-white font-bold rounded transition-colors"
                    title="Toggle Layer Active"
                  >A</button>
                                  <button type="button"
                  @click=${() => this.dispatchEvent(new CustomEvent('remove-outline-layer', { detail: { index }, bubbles: true, composed: true }))}
                  class="w-5 h-5 flex items-center justify-center text-[10px] bg-red-600/50 hover:bg-red-600 text-white font-bold rounded-full transition-colors"
                  title="Remove Layer ${index + 1}"
                >&times;</button>
                </div>
              </div>
            `)}
          </div>
          <div class="h-px bg-zinc-800 my-3"></div>
          <div>
                        <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Bottom Channels</label>
              <div class="flex items-center gap-2">
                ${(this.bottomChannels ||[]).length > 0 ? html`
                                <button type="button"
                  @click=${() => this.dispatchEvent(new CustomEvent('open-contour-editor', { bubbles: true, composed: true }))} 
                  class="px-2 py-0.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors"
                  title="Open 2D Contour Editor"
                >EDIT 2D</button>
                ` : ''}
                <button type="button"
                  @click=${() => this.dispatchEvent(new CustomEvent('add-bottom-channel', { bubbles: true, composed: true }))} 
                  class="px-2 py-0.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                  title="Add Bottom Channel"
                >ADD</button>
              </div>
            </div>
            ${(this.bottomChannels ||[]).length === 0 
              ? html`<p class="text-xs text-zinc-500 text-center py-2">No channels defined.</p>`
              : (this.bottomChannels ||[]).map((channel, index) => html`
              <div class="flex items-center justify-between mb-1 bg-zinc-800/50 p-1.5 rounded">
                <span class="text-xs text-zinc-400">${channel.name}</span>
                <div class="flex items-center gap-1">
                                    <button type="button"
                    @click=${() => this.dispatchEvent(new CustomEvent('toggle-channel-symmetry', { detail: { index }, bubbles: true, composed: true }))}
                    class="w-5 h-5 flex items-center justify-center text-[10px] ${channel.isSymmetric ? 'bg-blue-600/50 hover:bg-blue-600' : 'bg-zinc-600/50 hover:bg-zinc-600'} text-white font-bold rounded transition-colors"
                    title="Toggle Symmetry"
                  >S</button>
                  <button type="button"
                    @click=${() => this.dispatchEvent(new CustomEvent('remove-bottom-channel', { detail: { index }, bubbles: true, composed: true }))}
                    class="w-5 h-5 flex items-center justify-center text-[10px] bg-red-600/50 hover:bg-red-600 text-white font-bold rounded-full transition-colors"
                    title="Remove Channel ${index + 1}"
                  >&times;</button>
                </div>
              </div>
            `)}
          </div>
        `, true)}

        ${this._renderAccordion("Global Transforms", html`
          ${this._renderSlider("Length", "length", 48, 120, 0.5, this.length)}
          ${this._renderSlider("Width", "width", 16, 24, 0.125, this.width)}
          ${this._renderSlider("Thickness", "thickness", 1.5, 4, 0.0625, this.thickness)}
          <div class="h-px bg-zinc-800 my-4"></div>
          <p class="text-xs text-zinc-500 mb-2 text-center">Relative Scaling</p>
          <div class="flex flex-col gap-2">
                        <div class="flex gap-2">
              <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('scale-action', { detail: { type: 'SCALE_WIDTH', factor: 1.05 }, bubbles: true, composed: true }))} class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Width +5%</button>
              <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('scale-action', { detail: { type: 'SCALE_WIDTH', factor: 0.95 }, bubbles: true, composed: true }))} class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Width -5%</button>
            </div>
            <div class="flex gap-2">
              <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('scale-action', { detail: { type: 'SCALE_THICKNESS', factor: 1.05 }, bubbles: true, composed: true }))} class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Thick +5%</button>
              <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('scale-action', { detail: { type: 'SCALE_THICKNESS', factor: 0.95 }, bubbles: true, composed: true }))} class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Thick -5%</button>
            </div>
          </div>
        `, true)}

                            ${this._renderAccordion("Tail Shape", html`
              ${this._renderSelect("Tail Type", "tailType",[
                {value: "squash", label: "Squash / Square"},
                {value: "pin", label: "Pin / Round"},
                {value: "swallow", label: "Swallow / Fish"}
              ], this.tailType)}
              ${this.tailType === 'swallow' ? this._renderSlider("Notch Depth", "swallowDepth", 1.0, 10.0, 0.25, this.swallowDepth) : ''}
            `, true)}

            ${this._renderAccordion('Aesthetics & Decals', html`
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Stringers</label>
                  <button type="button"
                    @click=${() => this.dispatchEvent(new CustomEvent('add-stringer', { bubbles: true, composed: true }))}
                    class="px-2 py-0.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                    title="Add Stringer"
                  >ADD</button>
                </div>
                ${(this.stringers || []).length === 0
                  ? html`<p class="text-xs text-zinc-500 text-center py-2">No custom stringers defined.</p>`
                  : this.stringers.map((s, index) => html`
                  <div class="bg-zinc-800/40 p-2 rounded mb-2 border border-zinc-800/80">
                    <div class="flex items-center justify-between mb-2 pb-1 border-b border-zinc-800/50">
                      <span class="text-xs text-zinc-300 font-bold">${s.name}</span>
                      <button type="button"
                        @click=${() => this.dispatchEvent(new CustomEvent('remove-stringer', { detail: { index }, bubbles: true, composed: true }))}
                        class="w-5 h-5 flex items-center justify-center text-[10px] bg-red-600/50 hover:bg-red-600 text-white font-bold rounded-full transition-colors"
                        title="Remove Stringer ${index + 1}"
                      >&times;</button>
                    </div>
                    ${this._renderSlider('Width', 'stringer_' + index + '_width', 0.05, 1.0, 0.05, s.width, '"', false)}
                    ${this._renderSlider('Offset Shift', 'stringer_' + index + '_shift', -10.0, 10.0, 0.25, s.shift, '"', false)}
                  </div>
                `)}
              </div>
              <div class="h-px bg-zinc-800 my-4"></div>
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Decals & Logos</label>
                  <button type="button"
                    @click=${() => this.dispatchEvent(new CustomEvent('add-decal', { bubbles: true, composed: true }))}
                    class="px-2 py-0.5 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                    title="Add Decal"
                  >ADD</button>
                </div>
                ${(this.decals || []).length === 0
                  ? html`<p class="text-xs text-zinc-500 text-center py-2">No decals defined.</p>`
                  : this.decals.map((d, index) => html`
                  <div class="bg-zinc-800/40 p-2 rounded mb-2 border border-zinc-800/80">
                    <div class="flex items-center justify-between mb-2 pb-1 border-b border-zinc-800/50">
                      <span class="text-xs text-zinc-300 font-bold">${d.name}</span>
                      <button type="button"
                        @click=${() => this.dispatchEvent(new CustomEvent('remove-decal', { detail: { index }, bubbles: true, composed: true }))}
                        class="w-5 h-5 flex items-center justify-center text-[10px] bg-red-600/50 hover:bg-red-600 text-white font-bold rounded-full transition-colors"
                        title="Remove Decal ${index + 1}"
                      >&times;</button>
                    </div>
                    ${this._renderSlider('Length', 'decal_' + index + '_length', 1.0, 20.0, 0.5, d.length, '"', false)}
                    ${this._renderSlider('Width', 'decal_' + index + '_width', 1.0, 20.0, 0.5, d.width, '"', false)}
                    ${this._renderSlider('Z Position (L)', 'decal_' + index + '_centreX', -50.0, 50.0, 0.5, d.centreX, '"', false)}
                    ${this._renderSlider('X Position (W)', 'decal_' + index + '_centreY', -10.0, 10.0, 0.25, d.centreY, '"', false)}
                    
                    <div class="flex items-center justify-between mt-2 pt-1 border-t border-zinc-800/50">
                      <span class="text-[10px] uppercase font-bold text-zinc-500">Placement Target</span>
                      <button type="button"
                        @click=${() => {
                          this.dispatchEvent(new CustomEvent('update-decal', {
                            detail: { index, centreX: d.centreX, centreY: d.centreY, length: d.length, width: d.width, deck: !d.deck },
                            bubbles: true, composed: true
                          }));
                        }}
                        class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded transition-colors
                          ${d.deck ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}"
                      >
                        ${d.deck ? 'Deck (Top)' : 'Bottom'}
                      </button>
                    </div>
                  </div>
                `)}
              </div>
            `, false)}

        ${this._renderAccordion("Fins & Placement", html`
          <div class="mb-4">
            <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">Setup</label>
            <select class="text-sm w-full appearance-none bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer" .value=${this.finSetup} @change=${(e: Event) => this._dispatchString('finSetup', (e.target as HTMLSelectElement).value)}>
              <option value="quad" ?selected=${this.finSetup === 'quad'}>Quad (4 Fins)</option>
              <option value="thruster" ?selected=${this.finSetup === 'thruster'}>Thruster (3 Fins)</option>
              <option value="twin" ?selected=${this.finSetup === 'twin'}>Twin (2 Fins)</option>
            </select>
          </div>
          <div class="h-px bg-zinc-800 my-4"></div>
          ${this._renderSlider("Front Fin from Tail", "frontFinZ", 8.0, 16.0, 0.25, this.frontFinZ)}
          ${this._renderSlider("Front Fin off Rail", "frontFinX", 0.75, 2.0, 0.125, this.frontFinX)}
          
          ${this.finSetup === 'quad' || this.finSetup === 'thruster' ? html`
            <div class="h-px bg-zinc-800 my-4"></div>
            ${this._renderSlider("Rear Fin from Tail", "rearFinZ", 2.0, 8.0, 0.25, this.rearFinZ)}
            ${this.finSetup === 'quad' ? html`
              ${this._renderSlider("Rear Fin off Rail", "rearFinX", 0.75, 2.5, 0.125, this.rearFinX)}
            ` : ''}
          ` : ''}
          
          <div class="h-px bg-zinc-800 my-4"></div>
          ${this._renderSlider("Toe-In Angle", "toeAngle", 0, 8.0, 0.5, this.toeAngle, "°")}
          ${this._renderSlider("Cant Angle", "cantAngle", 0, 10.0, 1.0, this.cantAngle, "°")}
        `, false)}

        ${this._renderAccordion("Construction & Glassing", html`
          ${this._renderSelect("Core Material", "coreMaterial",[
            {value: "pu", label: "Polyurethane (PU) - Heavier/Damp"},
            {value: "eps", label: "EPS Epoxy - Lighter/Buoyant"}
          ], this.coreMaterial)}
          ${this._renderSelect("Glass Schedule", "glassingSchedule",[
            {value: "heavy", label: "Heavy (6oz+4oz Deck / 6oz Bottom)"},
            {value: "standard", label: "Standard (4oz+4oz Deck / 4oz Bottom)"},
            {value: "light", label: "Light Pro (4oz Deck / 4oz Bottom)"}
          ], this.glassingSchedule)}
                `, false)}
      </div>
    `;
    console.info("[BoardControls] Exiting render.");
    return res;
  }
}
