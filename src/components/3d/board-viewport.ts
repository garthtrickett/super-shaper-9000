// File: src/components/3d/board-viewport.ts
import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type { BoardModel } from "../pages/board-builder-page.logic";
import type { WasmEngine } from "../../lib/client/wasm/surfer_wasm.js";

export type ViewportId = 'perspective' | 'top' | 'side' | 'profile';

export interface RustMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  colors: Float32Array;
  normals: Float32Array;
  volumeLiters: number;
  vertexCount: number;
  triangleCount: number;
}

@customElement("board-viewport"@customElement("board-viewport")
export class BoardViewport extends LitElement {
  @property({ type: Object }) boardState?: BoardModel;
  @property({ type: Object }) meshData?: RustMesh;
  @property({ type: Object }) curvatureCombs?: Float32Array;
  @property({ attribute: false }) mathEngine?: WasmEngine;
  @property({ type: String }) selectedNodeContinuity: "G0" | "G1" | "G2" = "G1";
  @property({ type: Boolean }) isProcessing = false;
  
  protected override createRenderRoot() { return this; }

  @query("#wgpu-canvas") private wgpuCanvas!: HTMLCanvasElement;
  
  @state() private maximizedView: ViewportId | null = null;
  @state() private isFlipped = false;
  @state() private isOrtho = false;
  @state() private activeProfileSlice = 0;

  private ro?: ResizeObserver;
  
  override firstUpdated() {
    const offscreen = this.wgpuCanvas.transferControlToOffscreen();
    this.dispatchEvent(new CustomEvent('init-renderer', {
        detail: { canvas: offscreen, width: this.wgpuCanvas.clientWidth, height: this.wgpuCanvas.clientHeight },
        bubbles: true,
        composed: true
    }));

    this.ro = new ResizeObserver(() => {
        this.dispatchEvent(new CustomEvent('resize-renderer', {
            detail: { width: this.wgpuCanvas.clientWidth, height: this.wgpuCanvas.clientHeight },
            bubbles: true,
            composed: true
        }));
    });
    this.ro.observe(this.wgpuCanvas);

    const forwardPointerEvent = (e: PointerEvent, type: string) => {
      this.dispatchEvent(new CustomEvent('viewport-pointer', {
        detail: { type, x: e.clientX, y: e.clientY },
        bubbles: true,
        composed: true
      }));
    };

    this.wgpuCanvas.addEventListener("pointerdown", (e) => forwardPointerEvent(e, "down"));
    this.wgpuCanvas.addEventListener("pointermove", (e) => forwardPointerEvent(e, "move"));
    this.wgpuCanvas.addEventListener("pointerup", (e) => forwardPointerEvent(e, "up"));
    this.wgpuCanvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('viewport-wheel', {
        detail: { dy: e.deltaY },
        bubbles: true,
        composed: true
      }));
    }, { passive: false });
  }

  override updated(changedProperties: PropertyValues) {
    const prevSlice = this.activeProfileSlice;
    if (this.boardState?.selectedNode?.curve.startsWith('crossSection_')) {
        const idx = parseInt(this.boardState.selectedNode.curve.split('_')[1] || "0", 10);
        if (!isNaN(idx)) {
            this.activeProfileSlice = idx;
        }
    }
    if (this.boardState?.crossSections && this.activeProfileSlice >= this.boardState.crossSections.length) {
        this.activeProfileSlice = Math.max(0, this.boardState.crossSections.length - 1);
    }
    if (prevSlice !== this.activeProfileSlice) {
        this.requestUpdate();
    }
  }

  override disconnectedCallback() {
    this.ro?.disconnect();
    super.disconnectedCallback();
  }

  public previewState(newState: BoardModel) {
  }

  private toggleMaximize(view: ViewportId | null) {
    this.maximizedView = view;
  }

  private toggleFlip = () => {
    this.isFlipped = !this.isFlipped;
  };

  private toggleOrtho = () => {
    this.isOrtho = !this.isOrtho;
  };

  override render() {
    const expandIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l-5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    const collapseIcon = html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7m-7 17v-6m0 0h6m-6 0l7 7M10 4v6m0 0H4m6 0L3 3"></path></svg>`;
    
    const renderProfileSliceSelector = () => {
      if (!this.boardState?.crossSections || this.boardState.crossSections.length === 0) return '';
      return html`
        <div class="absolute bottom-3 left-3 pointer-events-auto z-50">
          <select 
            class="bg-zinc-950/90 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border border-zinc-800 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            .value=${this.activeProfileSlice.toString()}
            @change=${(e: Event) => {
              this.activeProfileSlice = parseInt((e.target as HTMLSelectElement).value, 10);
            }}
          >
            ${this.boardState.crossSections.map((_, idx) => html`
              <option value=${idx} ?selected=${this.activeProfileSlice === idx}>Slice ${idx + 1}</option>
            `)}
          </select>
        </div>
      `;
    };

    const renderQuadrantOverlay = (id: ViewportId, label: string) => html`
      <div class="relative w-full h-full pointer-events-none">
        <button type="button" @click=${() => this.toggleMaximize(id)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Maximize ${label}">
          <span>${label}</span> ${expandIcon}
        </button>
        ${id === 'profile' ? renderProfileSliceSelector() : ''}
      </div>
    `;

    return html`
      <canvas id="wgpu-canvas" class="absolute inset-0 w-full h-full outline-none" style="z-index: 0;"></canvas>
      ${this.isProcessing ? html`
        <div class="absolute bottom-3 left-3 z-20 pointer-events-none flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 text-blue-400 border-blue-500/30 border text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors">
          <svg class="w-3.5 h-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Computing</span>
        </div>
      ` : ''}
      <div class="absolute bottom-3 right-3 z-20 pointer-events-auto flex gap-2">
        <button type="button" @click=${this.toggleOrtho} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isOrtho ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Toggle Orthographic">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
          <span>Ortho</span>
        </button>
        <button type="button" @click=${this.toggleFlip} class="flex items-center gap-2 px-2.5 py-1.5 ${this.isFlipped ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500' : 'bg-zinc-950/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border-zinc-800'} text-[10px] font-bold uppercase tracking-widest rounded shadow backdrop-blur-sm transition-colors border cursor-pointer" title="Flip Board">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          <span>Flip</span>
        </button>
      </div>
      <div class="absolute inset-0 pointer-events-none z-10">
        ${this.maximizedView === null ? html`
          <div class="w-full h-full grid grid-cols-2 grid-rows-2">
            <div class="border-r border-b border-zinc-800/80">${renderQuadrantOverlay('top', 'Top')}</div>
            <div class="border-b border-zinc-800/80">${renderQuadrantOverlay('perspective', 'Perspective')}</div>
            <div class="border-r border-zinc-800/80">${renderQuadrantOverlay('side', 'Side')}</div>
            <div>${renderQuadrantOverlay('profile', 'Profile')}</div>
          </div>
        ` : html`
          <div class="w-full h-full relative pointer-events-none">
            <button type="button" @click=${() => this.toggleMaximize(null)} class="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 bg-zinc-950/80 hover:bg-zinc-800 text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-widest rounded shadow backdrop-blur-sm pointer-events-auto transition-colors border border-zinc-800 cursor-pointer" title="Restore View">
              <span>${this.maximizedView}</span> ${collapseIcon}
            </button>
            ${this.maximizedView === 'profile' ? renderProfileSliceSelector() : ''}
          </div>
        `}
      </div>
    `;
  }
}
