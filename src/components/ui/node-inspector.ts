import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { BoardModel, Point3D, BezierCurveData } from "../pages/board-builder-page.logic";

@customElement("node-inspector")
export class NodeInspector extends LitElement {
  @property({ type: Object }) boardState!: BoardModel;
  @state() private c1Locked = true;

  protected override createRenderRoot() { 
    return this; 
  }

  // Maps the 3D point to a 2D plane (U, V) based on the curve type for angle calculation
  private _getUV(curve: string, pt: Point3D): { u: number, v: number } {
    if (curve === 'outline') return { u: pt[2], v: pt[0] }; // Z (Length) and X (Width)
    if (curve.startsWith('rocker')) return { u: pt[2], v: pt[1] }; // Z (Length) and Y (Height)
    return { u: pt[0], v: pt[1] }; // Cross Section: X (Width) and Y (Height)
  }

  private _setUV(curve: string, anchor: Point3D, u: number, v: number): Point3D {
    if (curve === 'outline') return [v, anchor[1], u];
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
    if (sel.curve.startsWith("crossSection_")) {
      const idx = parseInt(sel.curve.split("_")[1]!, 10);
      return this.boardState.crossSections?.[idx];
    }
    return undefined;
  }

  private _handleAnchorChange(axis: 0|1|2, val: number) {
    const sel = this.boardState.selectedNode!;
    const curveData = this._getTargetCurve()!;
    const oldA = curveData.controlPoints[sel.index]!;
    const oldT1 = curveData.tangents1[sel.index]!;
    const oldT2 = curveData.tangents2[sel.index]!;

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
    
    const t1Polar = this._getPolar(sel.curve, curveData.tangents1[sel.index]!, anc);
    const t2Polar = this._getPolar(sel.curve, curveData.tangents2[sel.index]!, anc);

    if (isT1) t1Polar[prop] = val;
    else t2Polar[prop] = val;

    // Enforce C1 Continuity Lock if active
    if (this.c1Locked && prop === 'ang') {
      if (isT1) t2Polar.ang = (t1Polar.ang + 180) % 360;
      else t1Polar.ang = (t2Polar.ang + 180) % 360;
    }

    const newT1 = this._getPt(sel.curve, t1Polar.len, t1Polar.ang, anc);
    const newT2 = this._getPt(sel.curve, t2Polar.len, t2Polar.ang, anc);

    this.dispatchEvent(new CustomEvent('update-node', {
      detail: { curve: sel.curve, index: sel.index, tangent1: newT1, tangent2: newT2 },
      bubbles: true, composed: true
    }));
  }

  override render() {
    const sel = this.boardState?.selectedNode;
    const curveData = this._getTargetCurve();
    if (!sel || !curveData) return html``;

    const anc = curveData.controlPoints[sel.index]!;
    const t1 = curveData.tangents1[sel.index]!;
    const t2 = curveData.tangents2[sel.index]!;

    const t1Polar = this._getPolar(sel.curve, t1, anc);
    const t2Polar = this._getPolar(sel.curve, t2, anc);

    const isOutline = sel.curve === 'outline';
    const isRocker = sel.curve.startsWith('rocker');
    const isSlice = sel.curve.startsWith('crossSection');

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
            ${sel.curve.replace('crossSection_', 'Slice ')}
          </h3>
          <span class="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded text-[10px] font-bold">
            Node ${sel.index}
          </span>
        </div>

        <div class="mb-4">
          <h4 class="text-xs font-bold text-blue-400 mb-2 uppercase tracking-widest">Anchor Position</h4>
          ${renderInput('X (W)', anc[0], isRocker, (v) => this._handleAnchorChange(0, v))}
          ${renderInput('Y (H)', anc[1], isOutline, (v) => this._handleAnchorChange(1, v))}
          ${renderInput('Z (L)', anc[2], isSlice, (v) => this._handleAnchorChange(2, v))}
        </div>

        <div class="mb-4">
          <div class="flex justify-between items-center mb-2">
            <h4 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">Tangents (Handles)</h4>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input 
                type="checkbox" 
                .checked=${this.c1Locked}
                @change=${(e: Event) => { this.c1Locked = (e.target as HTMLInputElement).checked; }}
                class="accent-blue-500 rounded bg-zinc-950 border-zinc-700 w-3 h-3"
              />
              <span class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">C1 Lock</span>
            </label>
          </div>
          
          <div class="grid grid-cols-2 gap-4">
            <div class="bg-zinc-950/50 p-2 rounded border border-zinc-800">
              <span class="block text-[10px] text-zinc-500 mb-2 uppercase font-bold tracking-widest">Incoming (T1)</span>
              ${renderInput('Angle', t1Polar.ang, false, (v) => this._handleTangentChange(true, 'ang', v))}
              ${renderInput('Length', t1Polar.len, false, (v) => this._handleTangentChange(true, 'len', v))}
            </div>
            <div class="bg-zinc-950/50 p-2 rounded border border-zinc-800">
              <span class="block text-[10px] text-zinc-500 mb-2 uppercase font-bold tracking-widest">Outgoing (T2)</span>
              ${renderInput('Angle', t2Polar.ang, false, (v) => this._handleTangentChange(false, 'ang', v))}
              ${renderInput('Length', t2Polar.len, false, (v) => this._handleTangentChange(false, 'len', v))}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
