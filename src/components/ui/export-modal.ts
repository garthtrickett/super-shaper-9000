import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("export-modal")
export class ExportModal extends LitElement {
  @property({ type: String }) jsonString = "";

  protected override createRenderRoot() {
    return this; // Use Light DOM to ensure Tailwind classes work
  }

  private _handleClose() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private _handleCopy() {
    void navigator.clipboard.writeText(this.jsonString);
    this._handleClose();
  }

  override render() {
    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[500px] max-w-full flex flex-col">
          <h2 class="text-xl font-bold text-zinc-100 mb-4">Export Design</h2>
          <textarea readonly .value=${this.jsonString} class="w-full h-64 bg-zinc-950 border border-zinc-800 text-zinc-300 p-3 rounded text-xs font-mono mb-4 focus:outline-none focus:border-blue-500 custom-scrollbar"></textarea>
          <div class="flex justify-end gap-3">
            <button type="button" @click=${this._handleClose} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Close</button>
            <button type="button" @click=${this._handleCopy} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Copy to Clipboard</button>
          </div>
        </div>
      </div>
    `;
  }
}
