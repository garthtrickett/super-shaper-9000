import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("foil-graph")
export class FoilGraph extends LitElement {
  @property({ type: Object }) data?: Float32Array;

  protected override createRenderRoot() { return this; }

  override render() {
    if (!this.data || this.data.length === 0) {
      return html`<div class="h-16 bg-zinc-950 rounded-lg border border-zinc-800 flex items-center justify-center text-xs text-zinc-500">No foil data</div>`;
    }

    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxT = 0;
    const pts = [];

    for (let i = 0; i < this.data.length; i += 3) {
      const z = this.data[i];
      const ct = this.data[i+1];
      const rt = this.data[i+2];
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
      maxT = Math.max(maxT, ct, rt);
      pts.push({ z, ct, rt });
    }

    // Normalize to 100x40 SVG viewBox
    const mapX = (z: number) => ((z - minZ) / (maxZ - minZ || 1)) * 100;
    const mapY = (t: number) => 40 - (t / (maxT || 1)) * 35; // Leave 5 units of padding on top

    const ctPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.z).toFixed(2)} ${mapY(p.ct).toFixed(2)}`).join(" ");
    const rtPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${mapX(p.z).toFixed(2)} ${mapY(p.rt).toFixed(2)}`).join(" ");

    // Fill for the center thickness area
    const fillPath = `${ctPath} L 100 40 L 0 40 Z`;

    return html`
      <div class="w-full bg-zinc-950 rounded-lg border border-zinc-800 p-2 shadow-inner relative overflow-hidden group">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="w-full h-16 block">
          <path d="${fillPath}" fill="#3b82f6" fill-opacity="0.1" />
          <path d="${ctPath}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-linejoin="round" />
          <path d="${rtPath}" fill="none" stroke="#10b981" stroke-width="1.5" stroke-dasharray="2 2" stroke-linejoin="round" />
        </svg>
        <div class="absolute top-1 left-2 flex gap-3 text-[8px] font-bold uppercase tracking-widest pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity">
          <div class="flex items-center gap-1"><span class="w-2 h-0.5 bg-blue-500 rounded"></span> Center</div>
          <div class="flex items-center gap-1"><span class="w-2 h-0.5 bg-emerald-500 rounded border border-dashed border-emerald-500"></span> Rail</div>
        </div>
      </div>
    `;
  }
}
