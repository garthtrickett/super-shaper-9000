import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Schema as S } from "effect";
import { BoardModelSchema, type BoardModel } from "../pages/board-builder-page.logic";

@customElement("import-modal")
export class ImportModal extends LitElement {
  @state() private importJson = "";
  @state() private importError = "";

  protected override createRenderRoot() {
    return this; // Use Light DOM to ensure Tailwind classes work
  }

  private _handleClose() {
    this.importJson = "";
    this.importError = "";
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private _handleFileUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      
      if (file.name.toLowerCase().endsWith('.brd')) {
        this.dispatchEvent(new CustomEvent("import-brd", {
          detail: { bytes: Array.from(new Uint8Array(buffer)) },
          bubbles: true,
          composed: true
        }));
      } else {
        // S3DX files are often ISO-8859-1 encoded.
        // Read as ArrayBuffer and decode explicitly to prevent replacement characters ().
        const decoder = new TextDecoder('iso-8859-1');
        const text = decoder.decode(buffer);
        
        this.dispatchEvent(new CustomEvent("import-s3dx", {
          detail: { xml: text },
          bubbles: true,
          composed: true
        }));
      }
      this._handleClose();
    } catch (err) {
      console.error("Failed to read file", err);
      this.importError = err instanceof Error ? err.message : "Failed to read file";
    } finally {
      // Reset input so the same file can be selected again if needed
      input.value = "";
    }
  };

  private _handleImport() {
    try {
      const parsed = JSON.parse(this.importJson) as unknown;
      const decode = S.decodeUnknownEither(BoardModelSchema);
      const result = decode(parsed);
      
      if (result._tag === "Right") {
        this.dispatchEvent(new CustomEvent("import-json", {
          detail: { state: result.right as BoardModel },
          bubbles: true,
          composed: true
        }));
        this._handleClose();
      } else {
        this.importError = "Invalid design parameters provided. Please check the format.";
      }
    } catch {
      this.importError = "Invalid JSON format.";
    }
  }

  override render() {
    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[500px] max-w-full flex flex-col">
          <h2 class="text-xl font-bold text-zinc-100 mb-4">Import Design</h2>
          
          <div class="mb-6 p-4 bg-zinc-950 border border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center text-center">
            <svg class="w-8 h-8 text-emerald-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            <p class="text-sm font-bold text-zinc-300 mb-1">Upload Shape3D (.s3dx) or BoardCAD (.brd)</p>
            <p class="text-xs text-zinc-500 mb-3">Import your existing designs directly.</p>
            <label class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">
              <span>Select File</span>
              <input type="file" accept=".s3dx,.brd" class="hidden" @change=${this._handleFileUpload} />
            </label>
          </div>

          <div class="flex items-center gap-4 mb-6">
            <div class="flex-1 h-px bg-zinc-800"></div>
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-widest">OR PASTE JSON</span>
            <div class="flex-1 h-px bg-zinc-800"></div>
          </div>

          <p class="text-xs text-zinc-400 mb-2">Paste your Super Shaper JSON code below:</p>
          <textarea 
            @input=${(e: Event) => { this.importJson = (e.target as HTMLTextAreaElement).value; this.importError = ""; }}
            .value=${this.importJson}
            placeholder='{ "length": 70, ... }'
            class="w-full h-64 bg-zinc-950 border border-zinc-800 text-zinc-300 p-3 rounded text-xs font-mono mb-2 focus:outline-none focus:border-blue-500 custom-scrollbar"></textarea>
          ${this.importError ? html`<div class="text-red-400 text-xs mb-4">${this.importError}</div>` : html`<div class="mb-4"></div>`}
          <div class="flex justify-end gap-3">
            <button type="button" @click=${this._handleClose} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Cancel</button>
            <button type="button" @click=${() => this._handleImport()} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Apply Design</button>
          </div>
        </div>
      </div>
    `;
  }
}
