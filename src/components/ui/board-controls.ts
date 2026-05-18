import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from "lit/directives/live.js";

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
    @property({ type: Boolean }) showGizmos = true;
  @property({ type: Boolean }) showSolidMesh = true;
  @property({ type: Boolean }) showHeatmap = false;
    @property({ type: Boolean }) showZebra = false;
  @property({ type: Boolean }) showOutline = true;
  @property({ type: Boolean }) showRockerTop = true;
  @property({ type: Boolean }) showRockerBottom = true;
  @property({ type: Boolean }) showApexOutline = true;
  @property({ type: Boolean }) showRailOutline = true;
        @property({ type: Boolean }) showApexRocker = true;
        @property({ type: Boolean }) showDeckShoulder = true;
    @property({ type: Boolean }) showCrossSections = true;
    @property({ type: Number }) gizmoScaleTop = 1.0;
  @property({ type: Number }) gizmoScaleSide = 1.0;
  @property({ type: Number }) gizmoScaleProfile = 1.0;
    @property({ type: Number }) gizmoScalePerspective = 1.0;
  @property({ type: Boolean }) showMriView = false;
      @property({ type: Number }) mriSlicePosition = 50.0;
      @property({ type: Array }) outlineLayers: { name: string, active?: boolean }[] =[];
    @property({ type: Array }) bottomChannels: { name: string, isSymmetric?: boolean }[] =[];
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
        return html`
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

                        <!-- Diagnostic Toggles -->
                <div class="grid grid-cols-2 gap-2 mb-4">

          <label class="flex flex-col items-center justify-center p-2 bg-zinc-950 rounded-lg border border-zinc-800 cursor-pointer hover:border-zinc-700 transition shadow-inner text-center gap-2 ${this.showHeatmap ? 'ring-1 ring-orange-500/50' : ''}">
            <div class="flex items-center gap-1.5">
                            <svg class="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"></path></svg>
              <span class="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Foil Ratio</span>
            </div>
                        <input 
              type="checkbox" 
              .checked=${live(this.showHeatmap)} 
              @change=${(e: Event) => this._dispatchBoolean('showHeatmap', (e.target as HTMLInputElement).checked)} 
              class="w-3 h-3 accent-orange-500 rounded bg-zinc-900 border-zinc-700 cursor-pointer" 
            />
          </label>

          <label class="flex flex-col items-center justify-center p-2 bg-zinc-950 rounded-lg border border-zinc-800 cursor-pointer hover:border-zinc-700 transition shadow-inner text-center gap-2 ${this.showZebra ? 'ring-1 ring-white/50' : ''}">
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg>
              <span class="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">Zebra Flow</span>
            </div>
                        <input 
              type="checkbox" 
              .checked=${live(this.showZebra)} 
              @change=${(e: Event) => this._dispatchBoolean('showZebra', (e.target as HTMLInputElement).checked)} 
              class="w-3 h-3 accent-white rounded bg-zinc-900 border-zinc-700 cursor-pointer" 
            />
          </label>

          

          <label class="flex flex-col items-center justify-center p-2 bg-zinc-950 rounded-lg border border-zinc-800 cursor-pointer hover:border-zinc-700 transition shadow-inner text-center gap-2 ${this.showMriView ? 'ring-1 ring-cyan-400/50' : ''}">
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path></svg>
              <span class="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">MRI Slice</span>
            </div>
                        <input 
              type="checkbox" 
              .checked=${live(this.showMriView)} 
              @change=${(e: Event) => this._dispatchBoolean('showMriView', (e.target as HTMLInputElement).checked)} 
              class="w-3 h-3 accent-cyan-400 rounded bg-zinc-900 border-zinc-700 cursor-pointer" 
            />
          </label>
        </div>

        ${this.showMriView ? html`
          <div class="mb-4 bg-zinc-950 p-3 rounded border border-cyan-900/50 shadow-inner">
            ${this._renderSlider("Slice Position", "mriSlicePosition", 0, 100, 0.1, this.mriSlicePosition, "%")}
          </div>
        ` : ''}

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

                        ${this._renderAccordion("Control Point Sizes", html`
          ${this._renderSlider("Top View", "gizmoScaleTop", 0.1, 3.0, 0.1, this.gizmoScaleTop, "x")}
          ${this._renderSlider("Side View", "gizmoScaleSide", 0.1, 3.0, 0.1, this.gizmoScaleSide, "x")}
          ${this._renderSlider("Profile View", "gizmoScaleProfile", 0.1, 3.0, 0.1, this.gizmoScaleProfile, "x")}
          ${this._renderSlider("Perspective View", "gizmoScalePerspective", 0.1, 3.0, 0.1, this.gizmoScalePerspective, "x")}
        `, false)}

        ${this._renderAccordion("Visibility", html`
                    <label class="flex items-center justify-between mb-2 cursor-pointer hover:bg-zinc-800 p-1 rounded transition">
            <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Solid Mesh</span>
            <input type="checkbox" .checked=${live(this.showSolidMesh)} @change=${(e: Event) => this._dispatchBoolean('showSolidMesh', (e.target as HTMLInputElement).checked)} class="w-4 h-4 accent-blue-500 rounded bg-zinc-900 border-zinc-700" />
          </label>
          <label class="flex items-center justify-between mb-2 cursor-pointer hover:bg-zinc-800 p-1 rounded transition">
            <span class="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Control Points</span>
            <input type="checkbox" .checked=${live(this.showGizmos)} @change=${(e: Event) => this._dispatchBoolean('showGizmos', (e.target as HTMLInputElement).checked)} class="w-4 h-4 accent-blue-500 rounded bg-zinc-900 border-zinc-700" />
          </label>
                    <div class="h-px bg-zinc-800 my-2"></div>
                    ${[
            { label: "Outline", key: "showOutline" },
            { label: "Rocker Top", key: "showRockerTop" },
            { label: "Rocker Bottom", key: "showRockerBottom" },
            { label: "Apex Outline", key: "showApexOutline" },
            { label: "Rail Outline (Tuck)", key: "showRailOutline" },
                        { label: "Apex Rocker", key: "showApexRocker" },
            { label: "Deck Shoulder", key: "showDeckShoulder" },
            { label: "Cross Sections", key: "showCrossSections" }
          ].map(c => html`
                        <label class="flex items-center justify-between mb-1 cursor-pointer hover:bg-zinc-800 p-1 rounded transition">
              <span class="text-xs text-zinc-400">${c.label}</span>
              <input type="checkbox" .checked=${live(Boolean((this as unknown as Record<string, boolean>)[c.key]))} @change=${(e: Event) => this._dispatchBoolean(c.key, (e.target as HTMLInputElement).checked)} class="w-3.5 h-3.5 accent-blue-500 rounded bg-zinc-900 border-zinc-700" />
            </label>
          `)}
          <div class="h-px bg-zinc-800 my-3"></div>
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
  }
}
