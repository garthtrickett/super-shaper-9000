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
  @property({ type: Number }) swallowDepth = 4.5;
  @property({ type: Number }) squashCornerRadius = 0.75;
  @property({ type: String }) noseShape = "clipped";
  @property({ type: Number }) widePointOffset = 2.0;
  @property({ type: Number }) noseRocker = 5.2;
  @property({ type: Number }) tailRocker = 1.6;
  @property({ type: Number }) noseThickness = 1.45;
  @property({ type: Number }) tailThickness = 1.35;
  @property({ type: Number }) rockerFlatSpotLength = 20.0;
  @property({ type: Number }) deckDome = 0.65;
  @property({ type: Number }) apexRatio = 0.35;
  @property({ type: Number }) railFullness = 0.65;
  @property({ type: Number }) hardEdgeLength = 18.0;
  @property({ type: Number }) veeDepth = 0.15;
  @property({ type: Number }) concaveDepth = 0.25;
  @property({ type: Number }) channelDepth = 0.1875;
  @property({ type: Number }) channelLength = 18.0;
  @property({ type: String }) bottomContour = "vee_to_quad_channels";
  @property({ type: String }) finSetup = "quad";
  @property({ type: Number }) frontFinZ = 11.0;
  @property({ type: Number }) frontFinX = 1.25;
  @property({ type: Number }) rearFinZ = 5.5;
  @property({ type: Number }) rearFinX = 1.75;
  @property({ type: Number }) toeAngle = 3.0;
  @property({ type: Number }) cantAngle = 6.0;
  @property({ type: String }) coreMaterial = "pu";
  @property({ type: String }) glassingSchedule = "heavy";

  // Physics Engine: Calculate weight based on volume, core density, and glassing weight
  get estimatedWeight() {
    const baseFoam = this.coreMaterial === 'eps' ? 1.5 : 2.5; // lbs per cubic ft
    const cubicFt = this.volume / 28.3168;
    const foamWeight = cubicFt * baseFoam;
    const glassWeight = this.glassingSchedule === 'heavy' ? 3.5 : this.glassingSchedule === 'standard' ? 2.5 : 1.8;
    const stringerWeight = 0.5;
    return (foamWeight + glassWeight + stringerWeight) * 0.453592; // Convert lbs to kg
  }

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
    let displayValue = `${value.toFixed(2)}${unit}`;
    
    // Surfboards conventionally display length in feet and inches (e.g., 5'10")
    if (key === "length") {
      const feet = Math.floor(value / 12);
      const inches = value % 12;
      const inchStr = inches % 1 === 0 ? inches.toString() : inches.toFixed(1);
      displayValue = `${feet}'${inchStr}"`;
    }

    return html`
      <div class="mb-4">
        <div class="flex justify-between items-center mb-1">
          <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">${label}</label>
          <span class="text-xs font-mono bg-zinc-800 text-blue-400 px-1.5 py-0.5 rounded">${displayValue}</span>
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

  // Real-time declarative SVG cross-section generator
  private _renderSliceSVG(label: string, w: number, t: number, apex: number, isHard: boolean) {
    const scale = 3.5;
    const cx = 50;
    const cy = 25;
    const topY = t / 2;
    const botY = -t / 2;
    const apexY = botY + (t * apex);
    
    let d = "";
    for (let i = 0; i <= 40; i++) {
        const angle = (i / 40) * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const px = Math.pow(Math.abs(cosA), this.railFullness) * (w / 2) * Math.sign(cosA);
        
        let py = 0;
        if (sinA >= 0) {
            py = apexY + Math.pow(Math.abs(sinA), this.deckDome) * (topY - apexY);
        } else {
            py = apexY - Math.pow(Math.abs(sinA), isHard ? 0.05 : 0.5) * (apexY - botY);
        }
        
        const sx = cx + px * scale;
        const sy = cy - py * scale;
        if (i === 0) d += `M ${sx} ${sy} `;
        else d += `L ${sx} ${sy} `;
    }
    d += "Z";

    // Apex reference line
    const apexLineY = cy - apexY * scale;

    return html`
      <div class="flex flex-col items-center">
        <span class="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">${label}</span>
        <svg viewBox="0 0 100 50" class="w-full h-12 overflow-visible">
          <path d="${d}" class="stroke-blue-500 fill-blue-500/10" stroke-width="1" stroke-linejoin="round" />
          <line x1="0" y1="${apexLineY}" x2="100" y2="${apexLineY}" stroke="#52525b" stroke-width="0.5" stroke-dasharray="2 2" />
        </svg>
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
        <!-- Import / Export Actions -->
        <div class="flex gap-2 mb-4">
          <button @click=${() => this.dispatchEvent(new CustomEvent('export-design', { bubbles: true, composed: true }))} class="flex-1 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300 py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Export</button>
          <button @click=${() => this.dispatchEvent(new CustomEvent('import-design', { bubbles: true, composed: true }))} class="flex-1 bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white py-2 rounded transition-colors uppercase tracking-wider cursor-pointer">Import</button>
        </div>

        <!-- Top HUD Panel (Volume & Weight) -->
        <div class="bg-zinc-950 p-4 rounded-lg border border-zinc-800 mb-6 flex items-center justify-around shadow-inner">
          <div class="flex flex-col items-center">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Est. Volume</span>
            <div class="text-2xl font-black text-blue-500 tracking-tighter">
              ${this.volume.toFixed(1)}<span class="text-sm text-zinc-400 ml-1">L</span>
            </div>
          </div>
          <div class="w-px h-8 bg-zinc-800"></div>
          <div class="flex flex-col items-center">
            <span class="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold mb-1">Est. Weight</span>
            <div class="text-2xl font-black text-emerald-500 tracking-tighter">
              ${this.estimatedWeight.toFixed(1)}<span class="text-sm text-zinc-400 ml-1">kg</span>
            </div>
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
          
          ${this.tailType === 'swallow' ? html`
            <div class="h-px bg-zinc-800 my-4"></div>
            ${this._renderSlider("Swallow Depth", "swallowDepth", 2.0, 8.0, 0.25, this.swallowDepth)}
          ` : ''}
          
          ${this.tailType === 'squash' ? html`
            <div class="h-px bg-zinc-800 my-4"></div>
            ${this._renderSlider("Squash Corner Radius", "squashCornerRadius", 0.1, 2.5, 0.1, this.squashCornerRadius)}
          ` : ''}
        `, true)}

        ${this._renderAccordion("Rocker & Foil", html`
          ${this._renderSlider("Nose Rocker", "noseRocker", 3.0, 7.0, 0.1, this.noseRocker)}
          ${this._renderSlider("Tail Rocker", "tailRocker", 1.0, 3.5, 0.1, this.tailRocker)}
          ${this._renderSlider("Flat Spot Length", "rockerFlatSpotLength", 0, 36.0, 1.0, this.rockerFlatSpotLength)}
          <div class="h-px bg-zinc-800 my-4"></div>
          ${this._renderSlider("Nose Thickness (N12)", "noseThickness", 0.75, 2.5, 0.0625, this.noseThickness)}
          ${this._renderSlider("Tail Thickness (T12)", "tailThickness", 0.75, 2.5, 0.0625, this.tailThickness)}
          ${this._renderSlider("Deck Dome", "deckDome", 0.4, 0.9, 0.05, this.deckDome, "")}
        `, false)}

        ${this._renderAccordion("Rails & Cross-Sections", html`
          <div class="grid grid-cols-3 gap-2 mb-6 bg-zinc-950 p-2 rounded-lg border border-zinc-800">
            ${this._renderSliceSVG("N12", this.noseWidth, this.noseThickness, this.apexRatio, false)}
            ${this._renderSliceSVG("Center", this.width, this.thickness, this.apexRatio, false)}
            ${this._renderSliceSVG("T12", this.tailWidth, this.tailThickness, 0.05, this.hardEdgeLength >= 12)}
          </div>
          ${this._renderSlider("Rail Apex Height", "apexRatio", 0.2, 0.6, 0.02, this.apexRatio, "%")}
          ${this._renderSlider("Rail Fullness (Pinch)", "railFullness", 0.5, 0.9, 0.05, this.railFullness, "")}
          ${this._renderSlider("Hard Edge Starts At", "hardEdgeLength", 0, 36.0, 1.0, this.hardEdgeLength)}
        `, true)}

        ${this._renderAccordion("Bottom Contours", html`
          ${this._renderSelect("Contour Flow", "bottomContour",[
            {value: "flat", label: "Flat"},
            {value: "single", label: "Single Concave"},
            {value: "single_to_double", label: "Single to Double"},
            {value: "vee_to_quad_channels", label: "Vee -> Quad-Inside-Single"}
          ], this.bottomContour)}
          <div class="h-px bg-zinc-800 my-4"></div>
          ${this._renderSlider("Entry Vee Depth", "veeDepth", 0, 0.5, 0.0625, this.veeDepth)}
          ${this._renderSlider("Single Concave Depth", "concaveDepth", 0, 0.5, 0.0625, this.concaveDepth)}
          ${this._renderSlider("Channel Depth", "channelDepth", 0, 0.5, 0.0625, this.channelDepth)}
          ${this._renderSlider("Channel Length (from tail)", "channelLength", 0, 36.0, 1.0, this.channelLength)}
        `, false)}

        ${this._renderAccordion("Fins & Placement", html`
          ${this._renderSelect("Setup", "finSetup",[
            {value: "quad", label: "Quad (4 Fins)"},
            {value: "thruster", label: "Thruster (3 Fins)"},
            {value: "twin", label: "Twin (2 Fins)"}
          ], this.finSetup)}
          <div class="h-px bg-zinc-800 my-4"></div>
          ${this._renderSlider("Front Fin from Tail", "frontFinZ", 8.0, 16.0, 0.25, this.frontFinZ)}
          ${this._renderSlider("Front Fin off Rail", "frontFinX", 0.75, 2.0, 0.125, this.frontFinX)}
          ${this.finSetup === 'quad' || this.finSetup === 'thruster' ? html`
            <div class="h-px bg-zinc-800 my-4"></div>
            ${this._renderSlider("Rear Fin from Tail", "rearFinZ", 2.0, 8.0, 0.25, this.rearFinZ)}
            ${this.finSetup === 'quad' ? this._renderSlider("Rear Fin off Rail", "rearFinX", 0.75, 2.5, 0.125, this.rearFinX) : ''}
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
