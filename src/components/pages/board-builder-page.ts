// src/components/pages/board-builder-page.ts
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Schema as S } from "effect";
import { WasmSamController } from "../../lib/client/wasm-sam-controller";
import initWasm, { WasmEngine } from "../../lib/client/wasm/surfer_wasm"; 
import { INITIAL_STATE, BoardModelSchema, type BoardModel, type BoardAction } from "./board-builder-page.logic";
import "../3d/board-viewport";
import "../ui/board-controls";
import "../ui/node-inspector";
import "../ui/bottom-contour-editor";
import "../ui/foil-graph";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
        private wasmCtrl = new WasmSamController(this);

  @state() private mathEngine?: WasmEngine;

        

  @state() private showExportModal = false;
  @state() private showImportModal = false;
    @state() private importError = "";
  @state() private importJson = "";
    @state() private _selectedNodeContinuity: "G0" | "G1" | "G2" = "G1";
      @state() private showContourEditor = false;
    @state() private contourZPosition = 20.0;
  @state() private contourSliceData?: Float32Array;
  @state() private isProcessing = false;

  private _proposeAction(action: BoardAction) {
    this.isProcessing = true;
    this.wasmCtrl.propose(action);
  }

        private requestSliceProfile() {
    if (!this.showContourEditor) return;
    this.isProcessing = true;
    const ctrl = this.wasmCtrl as unknown as { worker?: Worker; currentSequence?: number };
    const worker = ctrl.worker;
    if (worker) {
      worker.postMessage({ type: "GET_SLICE_PROFILE", z: this.contourZPosition, id: "contour-editor", seq: ctrl.currentSequence });
    }
  }

        private _handleWorkerMessage = (e: MessageEvent) => {
    const data = e.data as { type: string, id?: string, profile?: Float32Array, seq?: number };
    if (data.type === "SLICE_PROFILE_RESULT" && data.id === "contour-editor") {
      this.contourSliceData = data.profile;
      this.isProcessing = false;
    }
        if (data.type === "STATE_UPDATED" || data.type === "EXPORT_OBJ_RESULT" || data.type === "EXPORT_S3DX_RESULT" || data.type === "ERROR") {
      const ctrl = this.wasmCtrl as unknown as { currentSequence?: number };
      if (data.seq === undefined || data.seq === ctrl.currentSequence) {
        this.isProcessing = false;
      }
    }
  };

  protected override createRenderRoot() { return this; }

                private async _handleExportObj() {
      try {
        this.isProcessing = true;
        const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
        if (!worker) { this.isProcessing = false; return; }
        
        const objText = await new Promise<string>((resolve) => {
          const id = Math.random().toString();
          const handler = (e: MessageEvent) => {
            const data = e.data as { type: string; id?: string; obj?: string };
            if (data.type === "EXPORT_OBJ_RESULT" && data.id === id) {
              worker.removeEventListener("message", handler);
              resolve(data.obj!);
            }
          };
          worker.addEventListener("message", handler);
          worker.postMessage({ type: "EXPORT_OBJ", id });
        });

        this.isProcessing = false;
        const state = this.wasmCtrl.model;
        const length = state ? state.length.toFixed(1) : "Unknown";
        const blob = new Blob([objText], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `SuperShaper_${length}.obj`;
        a.click();
        URL.revokeObjectURL(url);
            } catch (e) {
        console.error("Failed to export OBJ", e);
        this.isProcessing = false;
      }
    }

        private async _handleExportS3dx() {
    try {
      this.isProcessing = true;
      const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
      if (!worker) { this.isProcessing = false; return; }
      
      const xml = await new Promise<string>((resolve) => {
        const id = Math.random().toString();
                const handler = (e: MessageEvent) => {
          const data = e.data as { type: string; id?: string; xml?: string };
          if (data.type === "EXPORT_S3DX_RESULT" && data.id === id) {
            worker.removeEventListener("message", handler);
            resolve(data.xml!);
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({ type: "EXPORT_S3DX", id });
      });

      this.isProcessing = false;
      const state = this.wasmCtrl.model;
      const length = state ? state.length.toFixed(1) : "Unknown";
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SuperShaper_${length}.s3dx`;
      a.click();
      URL.revokeObjectURL(url);
        } catch (e) {
      console.error("Failed to export S3DX", e);
      this.isProcessing = false;
    }
  }

            private _handleFileUpload = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      
            if (file.name.toLowerCase().endsWith('.brd')) {
        this._proposeAction({
          type: "IMPORT_BRD",
          bytes: Array.from(new Uint8Array(buffer))
        });
      } else {
        // S3DX files are often ISO-8859-1 encoded.
        // Read as ArrayBuffer and decode explicitly to prevent replacement characters ().
        const decoder = new TextDecoder('iso-8859-1');
        const text = decoder.decode(buffer);
        
        this._proposeAction({
          type: "IMPORT_S3DX",
          xml: text
        });
      }

      this.showImportModal = false;
      this.importJson = "";
      this.importError = "";
    } catch (err) {
      this.isProcessing = false;
      console.error("Failed to read file", err);
      this.importError = err instanceof Error ? err.message : "Failed to read file";
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
        this._proposeAction({ type: "LOAD_DESIGN", state: result.right as BoardModel });
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
            <button type="button" @click=${() => this.showExportModal = false} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Close</button>
            <button type="button" @click=${() => { void navigator.clipboard.writeText(jsonStr); this.showExportModal = false; }} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Copy to Clipboard</button>
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
          this._proposeAction({ type: "REDO" });
        } else {
          this._proposeAction({ type: "UNDO" });
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this._proposeAction({ type: "REDO" });
      }
    }
  };

          override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("keydown", this._handleKeyDown);

    void initWasm().then(() => {
      this.mathEngine = new WasmEngine();
      this.requestUpdate();
    });

        setTimeout(() => {
      const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
      if (worker) {
        worker.addEventListener("message", this._handleWorkerMessage);
      }
    }, 100);
  }

    override disconnectedCallback() {
    window.removeEventListener("keydown", this._handleKeyDown);
    const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
    if (worker) {
      worker.removeEventListener("message", this._handleWorkerMessage);
    }
    super.disconnectedCallback();
  }

      private _lastSyncedModel?: BoardModel;

  protected override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);
    // Sync the main-thread mathEngine with the controller's model before every render.
    const modelToSync = this.wasmCtrl.model || INITIAL_STATE;
    if (this.mathEngine && modelToSync !== this._lastSyncedModel) {
        try {
            this._lastSyncedModel = modelToSync;
            const cleanState = JSON.parse(JSON.stringify(modelToSync)) as BoardModel;
            this.mathEngine.propose({ type: "LOAD_DESIGN", state: cleanState });
        } catch (err) {
            console.error("Failed to sync main thread mathEngine:", err);
        }
    }
  }

    private _handleGizmoDrag = (e: CustomEvent<{ userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number] }>) => {
    const { userData, position } = e.detail;
    
    // Dispatch the primary node position update
    this._proposeAction({
      type: "UPDATE_NODE_POSITION",
      curve: userData.curve,
      nodeType: userData.type,
      index: userData.index,
      position: position
    });

    // If a continuity lock is active for the selected node, dispatch a follow-up action to the solver
    if (this._selectedNodeContinuity !== 'G0' && (userData.type === 'tangent1' || userData.type === 'tangent2')) {
      this._proposeAction({
        type: 'APPLY_CONTINUITY',
        curve: userData.curve,
        index: userData.index,
        level: this._selectedNodeContinuity,
        master: userData.type
      });
    }
  }

  private _renderImportModal() {
    if (!this.showImportModal) return null;
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
            <button type="button" @click=${() => { this.showImportModal = false; this.importError = ""; this.importJson = ""; }} class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer">Cancel</button>
            <button type="button" @click=${() => this._handleImport()} class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-bold text-white rounded transition-colors cursor-pointer">Apply Design</button>
          </div>
        </div>
      </div>
    `;
  }

                override render() {
    const state = this.wasmCtrl.model || INITIAL_STATE;
    const mesh = (this.wasmCtrl as unknown as { mesh?: import("../3d/board-viewport").RustMesh }).mesh;
    const curvatureCombs = (this.wasmCtrl as unknown as { curvatureCombs?: Float32Array }).curvatureCombs;
    const foilData = (this.wasmCtrl as unknown as { foilData?: Float32Array }).foilData;

    return html`
            ${this._renderExportModal()}
      ${this._renderImportModal()}
      ${this.showContourEditor ? html`
                <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div class="w-[800px] max-w-full h-[600px] flex flex-col">
            <bottom-contour-editor
              class="flex-1 w-full h-full block"
              .boardState=${state}
              .sliceData=${this.contourSliceData}
              .zPosition=${this.contourZPosition}
              @z-changed=${(e: CustomEvent<number>) => {
                this.contourZPosition = e.detail;
                this.requestSliceProfile();
              }}
              @close-editor=${() => { this.showContourEditor = false; }}
                                                        @update-node-position=${(e: CustomEvent<{ curve: string, index: number, nodeType: "anchor" | "tangent1" | "tangent2", position: [number, number, number] }>) => {
                this._proposeAction({
                  type: "UPDATE_NODE_POSITION",
                  curve: e.detail.curve,
                  index: e.detail.index,
                  nodeType: e.detail.nodeType,
                  position: e.detail.position
                });
              }}
            ></bottom-contour-editor>
          </div>
        </div>
      ` : ''}
      <div class="flex h-full w-full bg-zinc-950 text-zinc-50 relative">
        <!-- UI Controls Panel -->
                <board-controls
          class="w-80 shrink-0 border-r border-zinc-800 bg-zinc-900 z-10 h-full shadow-2xl"
          .isProcessing=${this.isProcessing}
                    .length=${state.length}
          .width=${state.width}
                    .thickness=${state.thickness}
          .meshData=${mesh}
          .tailType=${state.tailType ?? 'squash'}
          .swallowDepth=${state.swallowDepth ?? 4.0}
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
            this._proposeAction({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
          }}
          @string-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: string }>) => {
            this._proposeAction({ type: "UPDATE_STRING", param: e.detail.param, value: e.detail.value });
          }}
                    @boolean-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: boolean }>) => {
            this._proposeAction({ type: "UPDATE_BOOLEAN", param: e.detail.param, value: e.detail.value });
          }}
          .showSolidMesh=${state.showSolidMesh ?? true}
          .showHeatmap=${state.showHeatmap ?? false}
          .showZebra=${state.showZebra ?? false}
          .showApexLine=${state.showApexLine ?? false}
          .showOutline=${state.showOutline ?? true}
          .showRockerTop=${state.showRockerTop ?? true}
          .showRockerBottom=${state.showRockerBottom ?? true}
          .showApexOutline=${state.showApexOutline ?? true}
          .showRailOutline=${state.showRailOutline ?? true}
                    .showApexRocker=${state.showApexRocker ?? true}
          .showDeckShoulder=${state.showDeckShoulder ?? true}
                              .showCrossSections=${state.showCrossSections ?? true}
                    .showCurvature=${state.showCurvature ?? false}
          .showMriView=${state.showMriView ?? false}
                    .mriSlicePosition=${state.mriSlicePosition ?? 50.0}
                    .outlineLayers=${state.outlineLayers ||[]}
                    .bottomChannels=${state.bottomChannels ||[]}
          .foilData=${foilData}
          @export-design=${() => this.showExportModal = true}
                    @export-s3dx=${() => void this._handleExportS3dx()}
          @export-obj=${() => void this._handleExportObj()}
          @import-design=${() => this.showImportModal = true}
                                        @scale-action=${(e: CustomEvent<{ type: 'SCALE_WIDTH' | 'SCALE_THICKNESS', factor: number }>) => this._proposeAction({ type: e.detail.type, factor: e.detail.factor })}
                                        @add-outline-layer=${() => this._proposeAction({ type: 'ADD_OUTLINE_LAYER' })}
          @remove-outline-layer=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'REMOVE_OUTLINE_LAYER', index: e.detail.index })}
          @toggle-outline-layer=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'TOGGLE_OUTLINE_LAYER', index: e.detail.index })}
                    @add-bottom-channel=${() => this._proposeAction({ type: 'ADD_BOTTOM_CHANNEL' })}
          @remove-bottom-channel=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'REMOVE_BOTTOM_CHANNEL', index: e.detail.index })}
          @toggle-channel-symmetry=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'TOGGLE_CHANNEL_SYMMETRY', index: e.detail.index })}
          @open-contour-editor=${() => { this.showContourEditor = true; this.requestSliceProfile(); }}
        ></board-controls>

                                                                <div class="absolute top-4 right-4 z-10 flex gap-2">
          <button type="button"
            @click=${() => this._proposeAction({ type: "UNDO" })}
            ?disabled=${!state.history || state.historyIndex === undefined || state.historyIndex <= 0}
            class="px-3 py-1.5 rounded text-xs font-bold transition-colors bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
            title="Undo (Cmd/Ctrl + Z)"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
          </button>
                    <button type="button"
            @click=${() => this._proposeAction({ type: "REDO" })}
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
          .meshData=${mesh}
          .curvatureCombs=${curvatureCombs}
                              .mathEngine=${this.mathEngine}
          .selectedNodeContinuity=${this._selectedNodeContinuity}
                            @node-selected=${(e: CustomEvent<{ node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' } | null }>) => {
                        this._proposeAction({ type: "SELECT_NODE", node: e.detail.node });
            // Reset continuity to a safe default when a new node is selected
            this._selectedNodeContinuity = 'G1';
          }}
          @insert-node=${(e: CustomEvent<{curve: string, t: number}>) => this._proposeAction({ type: "INSERT_NODE", curve: e.detail.curve, t: e.detail.t })}
          @gizmo-drag-ended=${() => this._proposeAction({ type: "SAVE_HISTORY_SNAPSHOT" })}
                    @gizmo-dragged=${this._handleGizmoDrag}
        ></board-viewport>

        ${state.selectedNode ? html`
                      <node-inspector
            class="absolute top-16 right-4 z-20 w-[340px]"
            .boardState=${state}
                                                                                                                                                @update-node=${(e: CustomEvent<{ curve: string, index: number, anchor?: [number, number, number], tangent1?:[number, number, number], tangent2?: [number, number, number], weight?: number }>) => this._proposeAction({ type: "UPDATE_NODE_EXACT", ...e.detail })}
                        @apply-continuity=${(e: CustomEvent<{ curve: string, index: number, level: "G0" | "G1" | "G2", master?: string }>) => this._proposeAction({ type: "APPLY_CONTINUITY", ...e.detail })}
            @continuity-changed=${(e: CustomEvent<{ level: 'G0' | 'G1' | 'G2' }>) => this._selectedNodeContinuity = e.detail.level}
            @remove-node=${(e: CustomEvent<{ curve: string, index: number }>) => this._proposeAction({ type: "REMOVE_NODE", ...e.detail })}
          ></node-inspector>
        ` : ''}
      </div>
    `;
  }
}
