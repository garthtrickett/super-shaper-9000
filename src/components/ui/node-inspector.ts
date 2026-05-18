import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardModel, Point3D, BezierCurveData } from "../pages/board-builder-page.logic";

@customElement("node-inspector")
export class NodeInspector extends LitElement {
  @property({ type: Object }) boardState!: BoardModel;
  @state() private continuityLevel: "G0" | "G1" | "G2" = "G1";

  protected override createRenderRoot() { 
    return this; 
  }

  // Maps the 3D point to a 2D plane (U, V) based on the curve type for angle calculation
  private _getUV(curve: string, pt: Point3D): { u: number, v: number } {
    if (curve === 'outline' || curve === 'deckShoulder') return { u: pt[2], v: pt[0] }; // Z (Length) and X (Width)
    if (curve.startsWith('rocker')) return { u: pt[2], v: pt[1] }; // Z (Length) and Y (Height)
    return { u: pt[0], v: pt[1] }; // Cross Section: X (Width) and Y (Height)
  }

  private _setUV(curve: string, anchor: Point3D, u: number, v: number): Point3D {
    if (curve === 'outline' || curve === 'deckShoulder') return [v, anchor[1], u];
    if (curve.startsWith('rocker')) return [anchor[0], v, u];
    return [u, v, anchor[2]];
  }

  private _getPolar(curve: string, pt: Point3D, anchor: Point3D) {
    const p = this._getUV(curve, pt);
    const a = this._getUV(curve, anchor);
    const du = p.u - a.u;
    const dv = p.v - a.v;
    const len = Math.hypot(du, dv);
    let ang = Math.atan2(dv, du) * (180 / Math.PI);
    if (ang < 0) ang += 360;
    return { len, ang };
  }

  private _getPt(curve: string, len: number, ang: number, anchor: Point3D): Point3D {
    const rad = ang * Math.PI / 180;
    const a = this._getUV(curve, anchor);
    const u = a.u + len * Math.cos(rad);
    const v = a.v + len * Math.sin(rad);
    return this._setUV(curve, anchor, u, v);
  }

  private _getTargetCurve(): BezierCurveData | undefined {
    const sel = this.boardState?.selectedNode;
    if (!sel) return undefined;
    if (sel.curve === "outline") return this.boardState.outline;
    if (sel.curve === "rockerTop") return this.boardState.rockerTop;
    if (sel.curve === "rockerBottom") return this.boardState.rockerBottom;
    if (sel.curve === "apexOutline") return this.boardState.apexOutline;
    if (sel.curve === "railOutline") return this.boardState.railOutline;
    if (sel.curve === "apexRocker") return this.boardState.apexRocker;
    if (sel.curve === "deckShoulder") return this.boardState.deckShoulder;
    if (sel.curve.startsWith("crossSection_")) {
      const idx = parseInt(sel.curve.split("_")[1]!, 10);
      return this.boardState.crossSections?.[idx];
    }
    if (sel.curve.startsWith("outlineLayer_")) {
      const parts = sel.curve.split("_");
      const idx = parseInt(parts[1]!, 10);
      const layer = this.boardState.outlineLayers?.[idx];
      if (layer) {
        return parts[2] === "ext" ? layer.otlExt : layer.otlInt;
      }
    }
    if (sel.curve.startsWith("channel_")) {
      const parts = sel.curve.split("_");
      const idx = parseInt(parts[1]!, 10);
      const channel = this.boardState.bottomChannels?.[idx];
      if (channel) {
        if (parts[3] === "outline") return parts[2] === "left" ? channel.leftOutline : channel.rightOutline;
        if (parts[3] === "depth") return parts[2] === "left" ? channel.leftDepth : channel.rightDepth;
      }
    }
    return undefined;
  }

    private _dragWeightValue?: number;
  private _isDraggingWeight = false;
    private _lastDispatchedWeight?: number;

  private _dispatchWeight(val: number) {
    if (this._lastDispatchedWeight === val) return;
    this._lastDispatchedWeight = val;
    
    const sel = this.boardState.selectedNode!;
    this.dispatchEvent(new CustomEvent('update-node', {
      detail: { curve: sel.curve, index: sel.index, weight: val },
      bubbles: true, composed: true
    }));
  }

  private _dispatchPreviewWeight(val: number) {
    const sel = this.boardState.selectedNode!;
    this.dispatchEvent(new CustomEvent('preview-node', {
      detail: { curve: sel.curve, index: sel.index, weight: val },
      bubbles: true, composed: true
    }));
  }

    private _handleWeightChange(val: number) {
    this._dragWeightValue = val;
    this.requestUpdate();
    // Do not dispatch preview weight to avoid heavy processing during drag
  }

    private _handleAnchorChange(axis: 0|1|2, val: number) {
    const sel = this.boardState.selectedNode!;
    const curveData = this._getTargetCurve()!;
    const oldA = curveData.controlPoints[sel.index]!;
    const oldT1 = curveData.tangents1?.[sel.index] ?? [...oldA];
    const oldT2 = curveData.tangents2?.[sel.index] ?? [...oldA];

    const newA: Point3D = [...oldA];
    newA[axis] = val;

    // Shift handles synchronously to preserve their exact length and angle
    const dx = newA[0] - oldA[0];
    const dy = newA[1] - oldA[1];
    const dz = newA[2] - oldA[2];
    const newT1: Point3D = [oldT1[0] + dx, oldT1[1] + dy, oldT1[2] + dz];
    const newT2: Point3D = [oldT2[0] + dx, oldT2[1] + dy, oldT2[2] + dz];

    this.dispatchEvent(new CustomEvent('update-node', {
      detail: { curve: sel.curve, index: sel.index, anchor: newA, tangent1: newT1, tangent2: newT2 },
      bubbles: true, composed: true
    }));
  }

    private _handleTangentChange(isT1: boolean, prop: 'len' | 'ang', val: number) {
    const sel = this.boardState.selectedNode!;
    const curveData = this._getTargetCurve()!;
    const anc = curveData.controlPoints[sel.index]!;

    const t1Raw = curveData.tangents1?.[sel.index] ?? [...anc];
    const t2Raw = curveData.tangents2?.[sel.index] ?? [...anc];

    const t1Polar = this._getPolar(sel.curve, t1Raw, anc);
    const t2Polar = this._getPolar(sel.curve, t2Raw, anc);

    if (isT1) {
      t1Polar[prop] = val;
    } else {
      t2Polar[prop] = val;
    }

    const newT1 = this._getPt(sel.curve, t1Polar.len, t1Polar.ang, anc);
    const newT2 = this._getPt(sel.curve, t2Polar.len, t2Polar.ang, anc);

    // Dispatch the direct update first
    this.dispatchEvent(new CustomEvent('update-node', {
      detail: { curve: sel.curve, index: sel.index, tangent1: newT1, tangent2: newT2 },
      bubbles: true, composed: true
    }));

    // If continuity is active, dispatch a follow-up action for the solver
    if (this.continuityLevel !== 'G0') {
      const master = isT1 ? 'tangent1' : 'tangent2';
      this.dispatchEvent(new CustomEvent('apply-continuity', {
        detail: {
          curve: sel.curve,
          index: sel.index,
          level: this.continuityLevel,
          master,
        },
        bubbles: true, composed: true
      }));
    }
  }

    private _handleDeleteNode() {
    const sel = this.boardState.selectedNode!;
    this.dispatchEvent(new CustomEvent('remove-node', {
      detail: { curve: sel.curve, index: sel.index },
      bubbles: true, composed: true
    }));
  }

  private _handleContinuityChange(level: 'G0' | 'G1' | 'G2') {
    const sel = this.boardState.selectedNode!;
    if (!sel) return;

    const curveData = this._getTargetCurve();
    if (!curveData) return;

    // Continuity logic is not applicable for the first/last nodes of a curve
    if (sel.index === 0 || sel.index === curveData.controlPoints.length - 1) return;

    this.continuityLevel = level;
    this.dispatchEvent(new CustomEvent('continuity-changed', {
      detail: { level },
      bubbles: true, composed: true
    }));

    // Immediately apply the new constraint
    if (level !== 'G0') {
      this.dispatchEvent(new CustomEvent('apply-continuity', {
        detail: { curve: sel.curve, index: sel.index, level, master: 'tangent1' },
        bubbles: true, composed: true
      }));
    }
  }

  override render() {
    const sel = this.boardState?.selectedNode;
    const curveData = this._getTargetCurve();
    if (!sel || !curveData) return html``;

        const anc = curveData.controlPoints?.[sel.index];
    if (!anc) return html``;

    const t1 = curveData.tangents1?.[sel.index] ?? [...anc];
    const t2 = curveData.tangents2?.[sel.index] ?? [...anc];

    const t1Polar = this._getPolar(sel.curve, t1, anc);
    const t2Polar = this._getPolar(sel.curve, t2, anc);

    const isOutline = sel.curve === 'outline' || sel.curve === 'deckShoulder';
    const isRocker = sel.curve.startsWith('rocker') || sel.curve === 'apexRocker';
    const isSlice = sel.curve.startsWith('crossSection');
    const isEndNode = sel.index === 0 || sel.index === curveData.controlPoints.length - 1;

    // User-friendly naming map
    const friendlyNames: Record<string, string> = {
      outline: "Main Outline",
      rockerTop: "Rocker (Top)",
      rockerBottom: "Rocker (Bottom)",
      apexOutline: "Rail Apex (Plan)",
      railOutline: "Rail Tuck (Plan)",
      apexRocker: "Rail Apex (Profile)",
      deckShoulder: "Deck Shoulder"
    };

    let title = friendlyNames[sel.curve] || sel.curve;
    if (sel.curve.startsWith('crossSection_')) {
      title = `Slice ${sel.curve.split('_')[1]}`;
    } else if (sel.curve.startsWith('outlineLayer_')) {
      const parts = sel.curve.split('_');
      title = `Layer ${parts[1]} (${parts[2]!.toUpperCase()})`;
    } else if (sel.curve.startsWith('channel_')) {
      const parts = sel.curve.split('_');
      title = `Channel ${parts[1]} (${parts[2]!.toUpperCase()} ${parts[3]!.toUpperCase()})`;
    }

    const renderInput = (label: string, value: number, disabled: boolean, onChange: (v: number) => void) => html`
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-zinc-400 w-16">${label}</span>
        <input 
          type="number" step="0.01"
          .value=${value.toFixed(2)}
          ?disabled=${disabled}
          @change=${(e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value))}
          class="bg-zinc-950 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-700 w-24 focus:outline-none focus:border-blue-500 disabled:opacity-30 disabled:cursor-not-allowed"
        />
      </div>
    `;

    return html`
      <div class="bg-zinc-900 border border-zinc-700 shadow-2xl rounded-lg p-4 font-mono">
                <div class="flex justify-between items-center mb-4 pb-2 border-b border-zinc-800">
          <h3 class="text-sm font-bold text-zinc-100 uppercase tracking-widest">
            ${title}
          </h3>
          <div class="flex items-center gap-2">
            ${!isEndNode ? html`
              <button type="button" @click=${() => this._handleDeleteNode()} class="text-red-500 hover:text-red-400 hover:bg-red-500/10 p-1 rounded transition-colors cursor-pointer" title="Delete Node">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            ` : ''}
            <span class="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-[10px] font-bold">
              Node ${sel.index}
            </span>
          </div>
        </div>

        <div class="mb-4">
          <h4 class="text-xs font-bold text-blue-400 mb-2 uppercase tracking-widest">Anchor Position</h4>
          ${renderInput('X (W)', anc[0], isRocker, (v) => this._handleAnchorChange(0, v))}
          ${renderInput('Y (H)', anc[1], isOutline, (v) => this._handleAnchorChange(1, v))}
          ${renderInput('Z (L)', anc[2], isSlice, (v) => this._handleAnchorChange(2, v))}
        </div>

                ${(() => {
          const propWeight = curveData.weights?.[sel.index] ?? 1.0;
          if (!this._isDraggingWeight && this._dragWeightValue === propWeight) {
            this._dragWeightValue = undefined;
          }
          const activeWeight = this._dragWeightValue !== undefined ? this._dragWeightValue : propWeight;

          return html`
          <div class="mb-4 bg-zinc-950/50 p-2 rounded border border-zinc-800">
            <div class="flex justify-between items-center mb-2">
              <h4 class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Node Tension (Weight)</h4>
              <span class="text-[10px] font-mono bg-zinc-900 text-emerald-400 px-1.5 py-0.5 rounded border border-zinc-700 shadow-inner">
                ${activeWeight.toFixed(2)}x
              </span>
            </div>
            <div class="flex items-center gap-2">
              <input 
                type="range" min="0.1" max="10.0" step="0.1"
                .value=${activeWeight.toString()}
                @pointerdown=${() => this._isDraggingWeight = true}
                @pointerup=${() => {
                  this._isDraggingWeight = false;
                  if (this._dragWeightValue !== undefined) this._dispatchWeight(this._dragWeightValue);
                }}
                                @pointercancel=${() => {
                  this._isDraggingWeight = false;
                  if (this._dragWeightValue !== undefined) this._dispatchWeight(this._dragWeightValue);
                }}
                @input=${(e: Event) => this._handleWeightChange(parseFloat((e.target as HTMLInputElement).value))}
                class="w-full accent-emerald-500 cursor-pointer"
              />
              <button type="button"
                @click=${() => {
                  this._dragWeightValue = 1.0;
                  this._isDraggingWeight = false;
                  this._dispatchWeight(1.0);
                }}
                class="text-[10px] font-bold tracking-wider uppercase bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white px-2 py-1 rounded transition-colors"
                title="Reset to Standard Bezier (1.0)"
              >
                RST
              </button>
            </div>
          </div>
          `;
        })()}

        ${isEndNode ? '' : html`
        <div class="mb-4">
          <div class="flex justify-between items-center mb-2">
            <h4 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Joint Continuity</h4>
          </div>
                    <div class="flex w-full bg-zinc-950 border border-zinc-800 rounded-md p-1 space-x-1">
            ${['G0', 'G1', 'G2'].map(level => html`
              <button type="button"
                @click=${() => this._handleContinuityChange(level as 'G0' | 'G1' | 'G2')}
                class="flex-1 text-center text-[10px] font-bold uppercase tracking-wider rounded py-1 transition-colors 
                  ${this.continuityLevel === level 
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:bg-zinc-800'}"
              >
                ${{ G0: 'Free', G1: 'Smooth', G2: 'Fair' }[level]}
              </button>
            `)}
          </div>
        </div>`}

                <div class="mb-4">
          <h4 class="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Tangents (Handles)</h4>
          
          <div class="grid grid-cols-2 gap-4">
            ${sel.index !== 0 ? html`
            <div class="bg-zinc-950/50 p-2 rounded border border-zinc-800">
              <span class="block text-[10px] text-zinc-500 mb-2 uppercase font-bold tracking-widest">Incoming (T1)</span>
              ${renderInput('Angle', t1Polar.ang, false, (v) => this._handleTangentChange(true, 'ang', v))}
              ${renderInput('Length', t1Polar.len, false, (v) => this._handleTangentChange(true, 'len', v))}
            </div>
            ` : html`<div></div>`}
            
            ${sel.index !== curveData.controlPoints.length - 1 ? html`
            <div class="bg-zinc-950/50 p-2 rounded border border-zinc-800">
              <span class="block text-[10px] text-zinc-500 mb-2 uppercase font-bold tracking-widest">Outgoing (T2)</span>
              ${renderInput('Angle', t2Polar.ang, false, (v) => this._handleTangentChange(false, 'ang', v))}
              ${renderInput('Length', t2Polar.len, false, (v) => this._handleTangentChange(false, 'len', v))}
            </div>
            ` : html`<div></div>`}
          </div>
        </div>
      </div>
    `;
  }
}
