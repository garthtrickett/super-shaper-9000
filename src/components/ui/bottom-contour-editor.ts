import { LitElement, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardModel } from "../pages/board-builder-page.logic";

@customElement("bottom-contour-editor")
export class BottomContourEditor extends LitElement {
  @property({ type: Object }) boardState!: BoardModel;
    @property({ type: Object }) sliceData?: Float32Array;
  @property({ type: Number }) zPosition = 20.0;

  @state() private activeDrag: { curve: string; index: number; origZ: number; pointerId: number } | null = null;

  protected override createRenderRoot() { return this; }

  private _getContourPath() {
    if (!this.sliceData || this.sliceData.length === 0) return "";
    const numPts = this.sliceData[0];
    if (!numPts || numPts === 0) return "";
    
    let d = "";
    for (let i = 0; i < numPts; i++) {
      const x = this.sliceData[1 + i * 2];
      const y = this.sliceData[2 + i * 2];
      d += i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `;
    }
    return d;
  }

  private _handlePointerDown(e: PointerEvent, curve: string, index: number, origZ: number) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    target.setPointerCapture(e.pointerId);
    this.activeDrag = { curve, index, origZ, pointerId: e.pointerId };
  }

  private _handlePointerMove(e: PointerEvent) {
    if (!this.activeDrag || this.activeDrag.pointerId !== e.pointerId) return;
    
    const svgEl = this.querySelector('svg') as SVGSVGElement;
    const gEl = this.querySelector('#transform-group') as SVGGElement;
    
    if (!svgEl || !gEl) return;

    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    
    const ctm = gEl.getScreenCTM();
    if (!ctm) return;
    
    const gP = pt.matrixTransform(ctm.inverse());

    this.dispatchEvent(new CustomEvent('update-node-position', {
      detail: {
        curve: this.activeDrag.curve,
        index: this.activeDrag.index,
        nodeType: 'anchor',
        position:[gP.x, gP.y, this.activeDrag.origZ]
      },
      bubbles: true,
      composed: true
    }));
  }

  private _handlePointerUp(e: PointerEvent) {
    if (this.activeDrag && this.activeDrag.pointerId === e.pointerId) {
      const target = e.target as Element;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      this.activeDrag = null;
    }
  }

      private _renderNodes() {
    if (!this.boardState?.bottomChannels) return null;
    const nodes: any[] =[];
    
    this.boardState.bottomChannels.forEach((channel, idx) => {
      const drawSide = (curveData: any, curveName: string, isDepth: boolean) => {
        if (!curveData || !curveData.controlPoints) return;
                                        curveData.controlPoints.forEach((cp: any, i: number) => {
          // Support both array [x,y,z] (Rust fix) and object {x,y,z} formats for robustness
          const z = Array.isArray(cp) ? cp[2] : cp.z;
          const x = Array.isArray(cp) ? cp[0] : cp.x;
          const y = Array.isArray(cp) ? cp[1] : cp.y;
          
          const zDist = Math.abs(z - this.zPosition);
          if (zDist < 15.0) {
            const isDragging = this.activeDrag?.curve === curveName && this.activeDrag?.index === i;
            const isDragging = this.activeDrag?.curve === curveName && this.activeDrag?.index === i;
                        nodes.push(svg`
              <circle
                cx=${x} cy=${y} r=${isDragging ? 0.4 : 0.25}
                fill=${isDepth ? "#f59e0b" : "#3b82f6"}
                stroke="white" stroke-width="0.05"
                class="cursor-pointer hover:opacity-80 transition-all drop-shadow-md"
                @pointerdown=${(e: PointerEvent) => this._handlePointerDown(e, curveName, i, cp[2])}
              />
                            ${isDepth ? svg`<line x1=${x} y1=${y} x2=${x} y2="0" stroke="#f59e0b" stroke-width="0.02" opacity="0.3" stroke-dasharray="0.1 0.1"/>` : ''}
            `);
          }
        });
      };

      drawSide(channel.leftOutline, `channel_${idx}_left_outline`, false);
      drawSide(channel.rightOutline, `channel_${idx}_right_outline`, false);
      drawSide(channel.leftDepth, `channel_${idx}_left_depth`, true);
      drawSide(channel.rightDepth, `channel_${idx}_right_depth`, true);
    });
    return nodes;
  }

  override render() {
    return html`
      <div class="flex flex-col h-full w-full bg-zinc-900 rounded-lg border border-zinc-800 shadow-2xl overflow-hidden pointer-events-auto">
        <div class="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
          <h3 class="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
            Bottom Contour Editor
          </h3>
          <div class="flex items-center gap-3">
            <span class="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-1 rounded">Z: ${this.zPosition.toFixed(1)}"</span>
            <button @click=${() => this.dispatchEvent(new CustomEvent('close-editor', { bubbles: true, composed: true }))} class="text-zinc-500 hover:text-white transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        
                <div class="p-4 border-b border-zinc-800 bg-zinc-950/50">
          <input 
            type="range" min=${-(this.boardState?.length || 100) / 2} max=${(this.boardState?.length || 100) / 2} step="0.5"
            .value=${this.zPosition.toString()}
            @input=${(e: Event) => this.dispatchEvent(new CustomEvent('z-changed', { detail: parseFloat((e.target as HTMLInputElement).value), bubbles: true, composed: true }))}
            class="w-full accent-emerald-500 cursor-pointer"
          />
        </div>

        <div class="flex-1 relative min-h-[400px] bg-zinc-950">
          <svg 
            viewBox="-12 -4 24 8" 
            class="absolute inset-0 w-full h-full touch-none"
            preserveAspectRatio="xMidYMid meet"
            @pointermove=${this._handlePointerMove}
            @pointerup=${this._handlePointerUp}
            @pointercancel=${this._handlePointerUp}
            @pointerleave=${this._handlePointerUp}
          >
            <g stroke="#3f3f46" stroke-width="0.02" opacity="0.5">
              <line x1="-12" y1="0" x2="12" y2="0" />
              <line x1="-10" y1="-4" x2="-10" y2="4" stroke-dasharray="0.2 0.2"/>
              <line x1="-5" y1="-4" x2="-5" y2="4" stroke-dasharray="0.2 0.2"/>
              <line x1="0" y1="-4" x2="0" y2="4" stroke-width="0.05" stroke="#52525b" />
              <line x1="5" y1="-4" x2="5" y2="4" stroke-dasharray="0.2 0.2"/>
              <line x1="10" y1="-4" x2="10" y2="4" stroke-dasharray="0.2 0.2"/>
            </g>

            <g id="transform-group" transform="scale(1, -1)">
              <!-- Interpolated Bottom Contour Mesh Slice -->
              <path 
                d=${this._getContourPath()} 
                stroke="#10b981" fill="none" stroke-width="0.08" 
                stroke-linejoin="round" stroke-linecap="round"
              />
              <!-- Control Points -->
              ${this._renderNodes()}
            </g>
          </svg>
          
          <!-- Legend overlay -->
          <div class="absolute bottom-4 left-4 flex gap-4 pointer-events-none">
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-3 rounded-full bg-blue-500 border border-white"></div>
              <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Outline X</span>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="w-3 h-3 rounded-full bg-amber-500 border border-white"></div>
              <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Depth Y</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
