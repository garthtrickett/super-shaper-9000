// src/components/pages/board-builder-page.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Schema as S } from "effect";
import { WasmSamController } from "../../lib/client/wasm-sam-controller";
import { INITIAL_STATE, BoardModelSchema, type BoardModel, type BoardAction, type Point3D } from "./board-builder-page.logic";
import { runClientPromise } from "../../lib/client/runtime";
import { exportS3dx } from "../../lib/client/geometry/s3dx-exporter";
import { generateBoardCurves } from "../../lib/client/geometry/board-curves";
import { parseS3dx } from "../../lib/client/geometry/s3dx-importer";
import "../3d/board-viewport";
import "../ui/board-controls";
import "../ui/node-inspector";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
      private wasmCtrl = new WasmSamController(this);

  @state() private showExportModal = false;
  @state() private showImportModal = false;
  @state() private importError = "";
  @state() private importJson = "";

  protected override createRenderRoot() { return this; }

  private async _handleExportS3dx() {
    try {
            const state = this.wasmCtrl.model || INITIAL_STATE;
      const curves = await generateBoardCurves(state);
      const xml = await runClientPromise(exportS3dx(state, curves));
      const blob = new Blob([xml], { type: "application/xml" });
            const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SuperShaper_${state.length.toFixed(1)}.s3dx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export S3DX", e);
    }
  }

  private _handleS3dxUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importedData = await runClientPromise(parseS3dx(text));
      
            this.wasmCtrl.propose({
        type: "IMPORT_S3DX",
        ...importedData
      });

      this.showImportModal = false;
      this.importJson = "";
      this.importError = "";
    } catch (err) {
      console.error("Failed to parse .s3dx file", err);
      this.importError = err instanceof Error ? err.message : "Failed to parse .s3dx file";
    } finally {
      // Reset input so the same file can be selected again if needed
      input.value = "";
    }
  }

  private _handleImport() {
    try {
      const parsed = JSON.parse(this.importJson) as unknown;
      const decode = S.decodeUnknownEither(BoardModelSchema);
      const result = decode(parsed);
      
            if (result._tag === "Right") {
        this.wasmCtrl.propose({ type: "LOAD_DESIGN", state: result.right as BoardModel });
        this.showImportModal = false;
        this.importJson = "";
        this.importError = "";
      } else {
        this.importError = "Invalid design parameters provided. Please check the format.";
      }
    } catch {
      this.importError = "Invalid JSON format.";
    }
  }

    private _renderExportModal() {
    if (!this.showExportModal) return null;
    const state = this.wasmCtrl.model || INITIAL_STATE;
    const jsonStr = JSON.stringify(state, null, 2);
    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[500px] max-w-full flex flex-col">
          <h2 class="text-xl font-bold text-zinc-100 mb-4">Export Design</h2>
          <textarea readonly .value=${jsonStr} class="w-full h-64 bg-zinc-950 border border-zinc-800 text-zinc-300 p-3 rounded text-xs font-mono mb-4 focus:outline-none focus:border-blue-500 custom-scrollbar"></textarea>
          <div class="flex justify-end gap-3">
            <button @click=${() => this.showExportModal = false} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Close</button>
            <button @click=${() => { void navigator.clipboard.writeText(jsonStr); this.showExportModal = false; }} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Copy to Clipboard</button>
          </div>
        </div>
      </div>
    `;
  }

  private _handleKeyDown = (e: KeyboardEvent) => {
    // Do not hijack Undo/Redo if the user is typing inside an input field (e.g., Node Inspector)
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    if (cmdOrCtrl && !e.altKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
                if (e.shiftKey) {
          this.wasmCtrl.propose({ type: "REDO" });
        } else {
          this.wasmCtrl.propose({ type: "UNDO" });
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.wasmCtrl.propose({ type: "REDO" });
      }
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._handleKeyDown);
  }

  override disconnectedCallback() {
    window.removeEventListener("keydown", this._handleKeyDown);
    super.disconnectedCallback();
  }

  private _renderImportModal() {
    if (!this.showImportModal) return null;
    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[500px] max-w-full flex flex-col">
          <h2 class="text-xl font-bold text-zinc-100 mb-4">Import Design</h2>
          
          <div class="mb-6 p-4 bg-zinc-950 border border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center text-center">
            <svg class="w-8 h-8 text-emerald-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
            <p class="text-sm font-bold text-zinc-300 mb-1">Upload Shape3D (.s3dx) File</p>
            <p class="text-xs text-zinc-500 mb-3">Import your existing designs directly.</p>
            <label class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">
              <span>Select .s3dx File</span>
              <input type="file" accept=".s3dx" class="hidden" @change=${this._handleS3dxUpload} />
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
            <button @click=${() => { this.showImportModal = false; this.importError = ""; this.importJson = ""; }} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Cancel</button>
            <button @click=${() => this._handleImport()} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Apply Design</button>
          </div>
        </div>
      </div>
    `;
  }

    override render() {
    const state = this.wasmCtrl.model || INITIAL_STATE;
    const vertexCount = this.wasmCtrl.mesh?.vertexCount || 0;
    const triangleCount = this.wasmCtrl.mesh?.triangleCount || 0;

    return html`
      ${this._renderExportModal()}
      ${this._renderImportModal()}
      <div class="flex h-full w-full bg-zinc-950 text-zinc-50 relative">
        <!-- UI Controls Panel -->
        <board-controls
          class="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900 z-10 h-full shadow-2xl"
          .length=${state.length}
          .width=${state.width}
          .thickness=${state.thickness}
          .volume=${state.volume}
          .vertexCount=${vertexCount}
          .triangleCount=${triangleCount}
          .finSetup=${state.finSetup}
          .frontFinZ=${state.frontFinZ}
          .frontFinX=${state.frontFinX}
          .rearFinZ=${state.rearFinZ}
          .rearFinX=${state.rearFinX}
          .toeAngle=${state.toeAngle}
          .cantAngle=${state.cantAngle}
          .coreMaterial=${state.coreMaterial}
          .glassingSchedule=${state.glassingSchedule}
                              @number-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => {
            this.wasmCtrl.propose({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
          }}
          @string-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: string }>) => {
            this.wasmCtrl.propose({ type: "UPDATE_STRING", param: e.detail.param, value: e.detail.value });
          }}
          @boolean-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: boolean }>) => {
            this.wasmCtrl.propose({ type: "UPDATE_BOOLEAN", param: e.detail.param, value: e.detail.value });
          }}
          .showHeatmap=${state.showHeatmap ?? false}
          .showZebra=${state.showZebra ?? false}
          .showApexLine=${state.showApexLine ?? false}
          .showOutline=${state.showOutline ?? true}
          .showRockerTop=${state.showRockerTop ?? true}
          .showRockerBottom=${state.showRockerBottom ?? true}
          .showApexOutline=${state.showApexOutline ?? true}
          .showRailOutline=${state.showRailOutline ?? true}
          .showApexRocker=${state.showApexRocker ?? true}
                    .showCrossSections=${state.showCrossSections ?? true}
          .showCurvature=${state.showCurvature ?? false}
          @export-design=${() => this.showExportModal = true}
          @export-s3dx=${() => void this._handleExportS3dx()}
          @import-design=${() => this.showImportModal = true}
                    @scale-action=${(e: CustomEvent<{ type: 'SCALE_WIDTH' | 'SCALE_THICKNESS', factor: number }>) => this.wasmCtrl.propose({ type: e.detail.type, factor: e.detail.factor })}
        ></board-controls>

                <div class="absolute top-4 right-4 z-10 flex gap-2">
          <button 
            @click=${() => this.wasmCtrl.propose({ type: "UNDO" })}
            ?disabled=${!state.history || state.historyIndex === undefined || state.historyIndex <= 0}
            class="px-3 py-1.5 rounded text-xs font-bold transition-colors bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            title="Undo (Cmd/Ctrl + Z)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
          </button>
                    <button 
            @click=${() => this.wasmCtrl.propose({ type: "REDO" })}
            ?disabled=${!state.history || state.historyIndex === undefined || state.historyIndex >= (state.history?.length || 0) - 1}
            class="px-3 py-1.5 rounded text-xs font-bold transition-colors bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            title="Redo (Cmd/Ctrl + Shift + Z)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"></path></svg>
          </button>
        </div>

                <!-- Render the 3D scene taking up the full remaining area -->
                <board-viewport 
          class="flex-1 w-full h-full relative z-0 overflow-hidden"
          .boardState=${state}
          .meshData=${this.wasmCtrl.mesh}
          .curvatureCombs=${this.wasmCtrl.curvatureCombs}
                    @volume-calculated=${(e: CustomEvent<{ volume: number }>) => this.wasmCtrl.propose({ type: "UPDATE_VOLUME", volume: e.detail.volume })}
          @node-selected=${(e: CustomEvent<{ node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' } | null }>) => {
            this.wasmCtrl.propose({ type: "SELECT_NODE", node: e.detail.node });
          }}
          @gizmo-drag-ended=${() => this.wasmCtrl.propose({ type: "SAVE_HISTORY_SNAPSHOT" })}
          @gizmo-dragged=${(e: CustomEvent<{ userData: { type: 'anchor'|'tangent1'|'tangent2', curve: string, index: number }, position:[number, number, number] }>) => {
            this.wasmCtrl.propose({
              type: "UPDATE_NODE_POSITION",
              curve: e.detail.userData.curve,
              nodeType: e.detail.userData.type,
              index: e.detail.userData.index,
              position: e.detail.position
            });
          }}
        ></board-viewport>

        ${state.selectedNode ? html`
          <node-inspector
            class="absolute top-16 right-4 z-20 w-[340px]"
            .boardState=${state}
                        @update-node=${(e: CustomEvent<{ curve: string; index: number; anchor?: Point3D; tangent1?: Point3D; tangent2?: Point3D }>) => this.wasmCtrl.propose({ type: "UPDATE_NODE_EXACT", ...e.detail })}
          ></node-inspector>
        ` : ''}
      </div>
    `;
  }
}
