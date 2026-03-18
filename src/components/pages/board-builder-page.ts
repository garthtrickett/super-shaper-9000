// src/components/pages/board-builder-page.ts
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Schema as S } from "effect";
import { ReactiveSamController } from "../../lib/client/reactive-sam-controller";
import { INITIAL_STATE, update, handleAction, BoardModelSchema, type BoardModel, type BoardAction, type Point3D } from "./board-builder-page.logic";
import { runClientPromise } from "../../lib/client/runtime";
import { exportS3dx } from "../../lib/client/geometry/s3dx-exporter";
import { generateBoardCurves } from "../../lib/client/geometry/board-curves";
import "../3d/board-viewport";
import "../ui/board-controls";
import "../ui/node-inspector";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
  private ctrl = new ReactiveSamController<this, BoardModel, BoardAction, never>(
    this,
    INITIAL_STATE,
    update,
    handleAction
  );

  @state() private showExportModal = false;
  @state() private showImportModal = false;
  @state() private importError = "";
  @state() private importJson = "";

  protected override createRenderRoot() { return this; }

  private async _handleExportS3dx() {
    try {
      const curves = await generateBoardCurves(this.ctrl.model);
      const xml = await runClientPromise(exportS3dx(this.ctrl.model, curves));
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SuperShaper_${this.ctrl.model.length.toFixed(1)}_${this.ctrl.model.tailType}.s3dx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export S3DX", e);
    }
  }

  private _handleImport() {
    try {
      const parsed = JSON.parse(this.importJson) as unknown;
      const decode = S.decodeUnknownEither(BoardModelSchema);
      const result = decode(parsed);
      
      if (result._tag === "Right") {
        this.ctrl.propose({ type: "LOAD_DESIGN", state: result.right as BoardModel });
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
    const jsonStr = JSON.stringify(this.ctrl.model, null, 2);
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
    // Only handle hotkeys if we are actively in manual sculpting mode
    if (this.ctrl.model.editMode !== "manual") return;

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
          this.ctrl.propose({ type: "REDO" });
        } else {
          this.ctrl.propose({ type: "UNDO" });
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.ctrl.propose({ type: "REDO" });
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
          <p class="text-xs text-zinc-400 mb-2">Paste your JSON design code below:</p>
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
    const state = this.ctrl.model;

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
          .noseWidth=${state.noseWidth}
          .tailWidth=${state.tailWidth}
          .noseShape=${state.noseShape}
          .tailType=${state.tailType}
          .swallowDepth=${state.swallowDepth}
          .noseTipWidth=${state.noseTipWidth}
          .noseTipCurveZ=${state.noseTipCurveZ}
          .tailBlockWidth=${state.tailBlockWidth}
          .widePointOffset=${state.widePointOffset}
          .noseRocker=${state.noseRocker}
          .tailRocker=${state.tailRocker}
          .noseThickness=${state.noseThickness}
          .tailThickness=${state.tailThickness}
          .rockerFlatSpotLength=${state.rockerFlatSpotLength}
          .deckDome=${state.deckDome}
          .apexRatio=${state.apexRatio}
          .railFullness=${state.railFullness}
          .hardEdgeLength=${state.hardEdgeLength}
          .veeDepth=${state.veeDepth}
          .concaveDepth=${state.concaveDepth}
          .channelDepth=${state.channelDepth}
          .channelLength=${state.channelLength}
          .bottomContour=${state.bottomContour}
          .finSetup=${state.finSetup}
          .frontFinZ=${state.frontFinZ}
          .frontFinX=${state.frontFinX}
          .rearFinZ=${state.rearFinZ}
          .rearFinX=${state.rearFinX}
          .toeAngle=${state.toeAngle}
          .cantAngle=${state.cantAngle}
          .coreMaterial=${state.coreMaterial}
          .glassingSchedule=${state.glassingSchedule}
          @number-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => this.ctrl.propose({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value })}
          @string-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: string }>) => this.ctrl.propose({ type: "UPDATE_STRING", param: e.detail.param, value: e.detail.value })}
          @boolean-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: boolean }>) => this.ctrl.propose({ type: "UPDATE_BOOLEAN", param: e.detail.param, value: e.detail.value })}
          .editMode=${state.editMode || "parametric"}
          .showGizmos=${state.showGizmos ?? true}
          .showHeatmap=${state.showHeatmap ?? false}
          .showZebra=${state.showZebra ?? false}
          @export-design=${() => this.showExportModal = true}
          @export-s3dx=${() => void this._handleExportS3dx()}
          @import-design=${() => this.showImportModal = true}
          @convert-to-manual=${() => this.ctrl.propose({ type: "CONVERT_TO_MANUAL" })}
          @revert-to-parametric=${() => this.ctrl.propose({ type: "SET_EDIT_MODE", mode: "parametric" })}
        ></board-controls>

        ${state.editMode === 'manual' ? html`
          <div class="absolute top-4 right-4 z-10 flex gap-2">
            <button 
              @click=${() => this.ctrl.propose({ type: "UNDO" })}
              ?disabled=${!state.manualHistory || state.historyIndex === undefined || state.historyIndex <= 0}
              class="px-3 py-1.5 rounded text-xs font-bold transition-colors bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
              title="Undo (Cmd/Ctrl + Z)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
            </button>
            <button 
              @click=${() => this.ctrl.propose({ type: "REDO" })}
              ?disabled=${!state.manualHistory || state.historyIndex === undefined || state.historyIndex >= state.manualHistory.length - 1}
              class="px-3 py-1.5 rounded text-xs font-bold transition-colors bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
              title="Redo (Cmd/Ctrl + Shift + Z)"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"></path></svg>
            </button>
          </div>
        ` : ''}

        <!-- Render the 3D scene taking up the full remaining area -->
        <board-viewport 
          class="flex-1 w-full h-full relative z-0"
          .boardState=${state}
          @volume-calculated=${(e: CustomEvent<{ volume: number }>) => this.ctrl.propose({ type: "UPDATE_VOLUME", volume: e.detail.volume })}
          @node-selected=${(e: CustomEvent<{ node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' } | null }>) => {
            this.ctrl.propose({ type: "SELECT_NODE", node: e.detail.node });
          }}
          @gizmo-drag-ended=${() => this.ctrl.propose({ type: "SAVE_HISTORY_SNAPSHOT" })}
          @gizmo-dragged=${(e: CustomEvent<{ userData: { type: 'anchor'|'tangent1'|'tangent2', curve: string, index: number }, position: [number, number, number] }>) => {
            this.ctrl.propose({
              type: "UPDATE_MANUAL_NODE_POSITION",
              curve: e.detail.userData.curve,
              nodeType: e.detail.userData.type,
              index: e.detail.userData.index,
              position: e.detail.position
            });
          }}
        ></board-viewport>

        ${state.editMode === 'manual' && state.selectedNode ? html`
          <node-inspector
            class="absolute top-16 right-4 z-20 w-[340px]"
            .boardState=${state}
            @update-node=${(e: CustomEvent<{ curve: string; index: number; anchor?: Point3D; tangent1?: Point3D; tangent2?: Point3D }>) => this.ctrl.propose({ type: "UPDATE_NODE_EXACT", ...e.detail })}
          ></node-inspector>
        ` : ''}
      </div>
    `;
  }
}
