// src/components/pages/board-builder-page.ts
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import { WasmSamController } from "../../lib/client/wasm-sam-controller";
import { KeyboardController } from "../../lib/client/keyboard-controller";
import type { WasmEngine } from "../../lib/client/wasm/surfer_wasm"; 
import { INITIAL_STATE, type BoardModel, type BoardAction, type ComponentType, type ComponentPayload } from "./board-builder-page.logic";
import "../3d/board-viewport";
import "../ui/board-controls";
import "../ui/node-inspector";
import "../ui/bottom-contour-editor";
import "../ui/foil-graph";
import "../ui/export-modal";
import "../ui/import-modal";
import "../ui/library-modal";
import { ComponentLibraryModal } from "../ui/component-library-modal";
import { saveBoardToLibrary } from "../../lib/client/library-store";
import { saveComponentToLibrary } from "../../lib/client/component-library-store";

@customElement("board-builder-page")
export class BoardBuilderPage extends LitElement {
  private wasmCtrl = new WasmSamController(this);
  private keyboardCtrl = new KeyboardController(this, {
    onUndo: () => this._proposeAction({ type: "UNDO" }),
    onRedo: () => this._proposeAction({ type: "REDO" }),
  });

        @state() private showExportModal = false;
  @state() private showImportModal = false;
  @state() private showLibraryModal = false;
  @state() private showComponentLibraryModal = false;
  @state() private _selectedNodeContinuity: "G0" | "G1" | "G2" = "G1";
  @state() private showContourEditor = false;
  @state() private contourZPosition = 20.0;
  @state() private contourSliceData?: Float32Array;
  @state() private isProcessing = false;
  @state() private isRendererReady = false;

    private _workerBusyWithDrag = false;
  private _pendingDragDetail: { userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number], quad: string } | null = null;

  private _isGeometryAltering(action: BoardAction): boolean {
    if (action.type === "SELECT_NODE" || action.type === "SAVE_HISTORY_SNAPSHOT" || action.type === "UPDATE_BOOLEAN") {
      return false;
    }
    if (action.type === "UPDATE_NUMBER" && action.param === "mriSlicePosition") {
      return false;
    }
    return true;
  }

    private _proposeAction(action: BoardAction) {
    if (this._isGeometryAltering(action)) {
      this.isProcessing = true;
    }
    this.wasmCtrl.propose(action);
  }

  private _handleSaveComponent(type: import("./board-builder-page.logic").ComponentType) {
    const state = this.wasmCtrl.model;
    if (!state) {
      alert("No active board state to save component from!");
      return;
    }

    const name = prompt(`Enter a name for your saved ${type} component:`);
    if (!name || !name.trim()) return;

        let payload: ComponentPayload | undefined;
    if (type === "outline") {
      payload = {
        outline: state.outline,
        outlineLayers: state.outlineLayers
      };
    } else if (type === "rocker") {
      payload = {
        rockerTop: state.rockerTop,
        rockerBottom: state.rockerBottom,
        apexRocker: state.apexRocker
      };
    } else if (type === "slices") {
      payload = {
        crossSections: state.crossSections
      };
    } else if (type === "channels") {
      payload = {
        bottomChannels: state.bottomChannels || []
      };
    } else if (type === "fins") {
      payload = {
        finSetup: state.finSetup,
        frontFinZ: state.frontFinZ,
        frontFinX: state.frontFinX,
        rearFinZ: state.rearFinZ,
        rearFinX: state.rearFinX,
        toeAngle: state.toeAngle,
        cantAngle: state.cantAngle
      };
    }

    if (payload) {
      try {
        saveComponentToLibrary(name.trim(), type, payload);
        alert(`"${name}" successfully saved to your component library!`);
      } catch (err) {
        console.error("Failed to save component to library:", err);
        alert("Failed to save component to library.");
      }
    }
  }

    private _handleOpenComponentLibrary(type: import("./board-builder-page.logic").ComponentType) {
    this.showComponentLibraryModal = true;
    setTimeout(() => {
      const modal = this.shadowRoot?.querySelector("component-library-modal");
      if (modal && modal instanceof ComponentLibraryModal) {
        modal.activeTab = type;
      }
    }, 0);
  }

    private _previewAction(action: BoardAction) {
    const mathEngine = this.wasmCtrl.mathEngine;
    if (!mathEngine) return;
    try {
      type MathEngineExt = WasmEngine & { propose_state_only(action: unknown): void };
      let state: BoardModel;
      if ((mathEngine as unknown as MathEngineExt).propose_state_only) {
          (mathEngine as unknown as MathEngineExt).propose_state_only(action);
          state = mathEngine.get_state() as unknown as BoardModel;
      } else {
          const result = mathEngine.propose(action) as unknown as { state: BoardModel };
          state = result.state;
      }
      
      const viewport = this.shadowRoot?.querySelector('board-viewport') as unknown as { boardState: BoardModel };
      if (viewport && state) {
        viewport.boardState = state;
      }

      // For fast pure-uniform updates, we can send to worker directly so the 3D view updates instantly
      if (action.type === "UPDATE_NUMBER" && action.param === "mriSlicePosition") {
          const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
          if (worker) {
              worker.postMessage({ type: "PROPOSE", action, seq: this.wasmCtrl.currentSequence });
          }
      }
    } catch (err) {
      console.error("[BoardBuilder] Preview failed:", err);
    }
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
    if (data.type === "RENDERER_READY") {
        console.info("[BoardBuilder] WGPU Renderer Ready");
        this.isRendererReady = true;
        this.dispatchEvent(new CustomEvent("wgpu-ready", { bubbles: true, composed: true }));
    }
    if (data.type === "GIZMO_DRAG_COMPLETE") {
      this._workerBusyWithDrag = false;
      if (this._pendingDragDetail) {
        const detail = this._pendingDragDetail;
        this._pendingDragDetail = null;
        this._sendGizmoDragToWorker(detail);
      }
    }
    if (data.type === "SLICE_PROFILE_RESULT" && data.id === "contour-editor") {
      this.contourSliceData = data.profile;
      this.isProcessing = false;
    }
    if (data.type === "STATE_UPDATED" || data.type === "EXPORT_OBJ_RESULT" || data.type === "EXPORT_S3DX_RESULT" || data.type === "EXPORT_BRD_RESULT" || data.type === "ERROR") {
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

  private async _handleExportBrd() {
    try {
      this.isProcessing = true;
      const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
      if (!worker) { this.isProcessing = false; return; }
      
      const brdBytes = await new Promise<Uint8Array>((resolve) => {
        const id = Math.random().toString();
        const handler = (e: MessageEvent) => {
          const data = e.data as { type: string; id?: string; brdBytes?: Uint8Array };
          if (data.type === "EXPORT_BRD_RESULT" && data.id === id) {
            worker.removeEventListener("message", handler);
            resolve(data.brdBytes!);
          }
        };
        worker.addEventListener("message", handler);
        worker.postMessage({ type: "EXPORT_BRD", id });
      });

      this.isProcessing = false;
      const state = this.wasmCtrl.model;
      const length = state ? state.length.toFixed(1) : "Unknown";
      const blob = new Blob([brdBytes as unknown as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SuperShaper_${length}.brd`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to export BRD", e);
      this.isProcessing = false;
    }
  }

    private _handleNewDesign() {
    if (confirm("Are you sure you want to start a new design? All unsaved progress will be lost.")) {
      localStorage.removeItem("super_shaper_saved_board");
      this._proposeAction({ type: "LOAD_DESIGN", state: INITIAL_STATE });
    }
  }

    private _handleSaveToLibrary = () => {
    const name = prompt('Enter a name for your saved design:');
    if (name && name.trim()) {
      const state = this.wasmCtrl.model;
      if (state) {
        try {
          saveBoardToLibrary(name.trim(), state);
          alert('"' + name + '" successfully saved to your library!');
        } catch (err) {
          console.error('Failed to save board to library:', err);
          alert('Failed to save board to library.');
        }
      } else {
        alert('No active design to save!');
      }
    }
  }

    override connectedCallback() {
    super.connectedCallback();

    setTimeout(() => {
      const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
      if (worker) {
        worker.addEventListener("message", this._handleWorkerMessage);
      }
    }, 100);
  }

  override disconnectedCallback() {
    const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
    if (worker) {
      worker.removeEventListener("message", this._handleWorkerMessage);
    }
    super.disconnectedCallback();
  }

    private _hasLoadedSavedState = false;
  private _autoSaveTimeout?: number;

    protected override willUpdate(changedProperties: PropertyValues) {
    super.willUpdate(changedProperties);
    
    // const modelToSync = this.wasmCtrl.model || INITIAL_STATE;

    if (!this._hasLoadedSavedState && this.wasmCtrl.model) {
      this._hasLoadedSavedState = true;
      try {
        const saved = localStorage.getItem("super_shaper_saved_board");
        if (saved) { 
          const parsed = JSON.parse(saved) as Partial<BoardModel>;
          if (parsed && parsed.length !== undefined && parsed.outline) {
            setTimeout(() => {
              this._proposeAction({ type: "LOAD_DESIGN", state: parsed as BoardModel });
            }, 0);
          }
        }
      } catch (err) {
        console.error("Failed to load saved board state:", err);
      }
    }

    if (this._hasLoadedSavedState && this.wasmCtrl.model) {
      clearTimeout(this._autoSaveTimeout);
      this._autoSaveTimeout = window.setTimeout(() => {
        localStorage.setItem("super_shaper_saved_board", JSON.stringify(this.wasmCtrl.model));
      }, 1000);
    }
  }

    private _sendGizmoDragToWorker(detail: { userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number], quad: string }) { 
    this._workerBusyWithDrag = true;
    const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker; 
    if (worker) {
      worker.postMessage({
        type: "DRAG_GIZMO",
        curve: detail.userData.curve,
        index: detail.userData.index,
        nodeType: detail.userData.type,
        x: detail.position[0],
        y: detail.position[1],
        z: detail.position[2],
        continuity: this._selectedNodeContinuity,
        quad: detail.quad
      });
    }
  }

        private _handleGizmoDrag = (e: CustomEvent<{ userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number], quad: string }>) => {
    const { userData, position } = e.detail;
    
    // Sync main thread mathEngine immediately for lightning fast local evaluation (e.g. snapping)
    type MathEngineExt = WasmEngine & { propose_state_only(action: unknown): void };
    const mathEngine = this.wasmCtrl.mathEngine;
    if (mathEngine && (mathEngine as unknown as MathEngineExt).propose_state_only) {
        (mathEngine as unknown as MathEngineExt).propose_state_only({
            type: "UPDATE_NODE_POSITION",
            curve: userData.curve,
            nodeType: userData.type,
            index: userData.index,
            position: position
        });
        if (this._selectedNodeContinuity !== 'G0' && (userData.type === 'tangent1' || userData.type === 'tangent2')) {
            (mathEngine as unknown as MathEngineExt).propose_state_only({
                type: 'APPLY_CONTINUITY',
                curve: userData.curve,
                index: userData.index,
                level: this._selectedNodeContinuity,
                master: userData.type
            });
        }
    }

    // Throttle worker calls to prevent message queue buildup and lag on large mouse movements
    if (!this._workerBusyWithDrag) {
        this._sendGizmoDragToWorker(e.detail);
    } else {
        this._pendingDragDetail = e.detail; // Override with the freshest mouse position
    }
  }

    override render() {
    const state = this.wasmCtrl.model || INITIAL_STATE;
    const mesh = (this.wasmCtrl as unknown as { mesh?: import("../3d/board-viewport").RustMesh }).mesh;
    const foilData = (this.wasmCtrl as unknown as { foilData?: Float32Array }).foilData;

        const res = html`
      ${this.showExportModal ? html`
        <export-modal 
          .jsonString=${JSON.stringify(state, null, 2)} 
          @close=${() => this.showExportModal = false}>
        </export-modal>
      ` : ''}
      ${this.showImportModal ? html`
        <import-modal
          @close=${() => this.showImportModal = false}
          @import-json=${(e: CustomEvent<{state: BoardModel}>) => this._proposeAction({ type: "LOAD_DESIGN", state: e.detail.state })}
          @import-s3dx=${(e: CustomEvent<{xml: string}>) => this._proposeAction({ type: "IMPORT_S3DX", xml: e.detail.xml })}
          @import-brd=${(e: CustomEvent<{bytes: number[]}>) => this._proposeAction({ type: "IMPORT_BRD", bytes: e.detail.bytes })}
        ></import-modal>
      ` : ''}
            ${this.showLibraryModal ? html`
        <library-modal
          @close=${() => this.showLibraryModal = false}
          @import-json=${(e: CustomEvent<{state: BoardModel}>) => this._proposeAction({ type: "LOAD_DESIGN", state: e.detail.state })}
        ></library-modal>
      ` : ''}
            ${this.showComponentLibraryModal ? html`
        <component-library-modal
          @close=${() => this.showComponentLibraryModal = false}
          @import-component=${(e: CustomEvent<{ type: ComponentType, payload: ComponentPayload }>) => this._proposeAction({ type: "APPLY_COMPONENT", componentType: e.detail.type, payload: e.detail.payload })}
        ></component-library-modal>
      ` : ''}
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
        <div class="w-80 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900 z-10 h-full shadow-2xl">
          ${state.selectedNode ? html`
            <node-inspector
              class="block shrink-0 w-full z-20 shadow-md"
              .boardState=${state}
              @preview-node=${(e: CustomEvent<{ curve: string, index: number, weight?: number }>) => this._previewAction({ type: "UPDATE_NODE_EXACT", ...e.detail })}
              @update-node=${(e: CustomEvent<{ curve: string, index: number, anchor?: [number, number, number], tangent1?:[number, number, number], tangent2?: [number, number, number], weight?: number }>) => this._proposeAction({ type: "UPDATE_NODE_EXACT", ...e.detail })}
              @apply-continuity=${(e: CustomEvent<{ curve: string, index: number, level: "G0" | "G1" | "G2", master?: string }>) => this._proposeAction({ type: "APPLY_CONTINUITY", ...e.detail })}
              @continuity-changed=${(e: CustomEvent<{ level: 'G0' | 'G1' | 'G2' }>) => this._selectedNodeContinuity = e.detail.level}
              @remove-node=${(e: CustomEvent<{ curve: string, index: number }>) => this._proposeAction({ type: "REMOVE_NODE", ...e.detail })}
              @close-inspector=${() => this._proposeAction({ type: "SELECT_NODE", node: null })}
            ></node-inspector>
          ` : ''}
          <board-controls
            class="flex-1 min-h-0 w-full flex flex-col"
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
            @preview-number=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => {
              this._previewAction({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
            }}
            @number-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => {
              this._proposeAction({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
            }}
            @string-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: string }>) => {
              this._proposeAction({ type: "UPDATE_STRING", param: e.detail.param, value: e.detail.value });
            }}
                          .outlineLayers=${state.outlineLayers ||[]}
              .bottomChannels=${state.bottomChannels ||[]}
              .stringers=${state.stringers ||[]}
              .decals=${state.decals ||[]}
              .foilData=${foilData}
              @add-stringer=${() => this._proposeAction({ type: "ADD_STRINGER" })}
              @update-stringer=${(e: CustomEvent<{ index: number, width: number, shift: number, tilt: number }>) => this._proposeAction({ type: "UPDATE_STRINGER", ...e.detail })}
              @remove-stringer=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: "REMOVE_STRINGER", index: e.detail.index })}
              @add-decal=${() => this._proposeAction({ type: "ADD_DECAL" })}
              @update-decal=${(e: CustomEvent<{ index: number, centreX: number, centreY: number, length: number, width: number, deck: boolean }>) => this._proposeAction({ type: "UPDATE_DECAL", ...e.detail })}
              @remove-decal=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: "REMOVE_DECAL", index: e.detail.index })}
              @export-design=${() => this.showExportModal = true}
            @export-s3dx=${() => void this._handleExportS3dx()}
            @export-brd=${() => void this._handleExportBrd()}
            @export-obj=${() => void this._handleExportObj()}
                        @import-design=${() => this.showImportModal = true}
            @save-to-library=${this._handleSaveToLibrary}
            @open-library=${() => this.showLibraryModal = true}
            @new-design=${() => this._handleNewDesign()}
                        @scale-action=${(e: CustomEvent<{ type: 'SCALE_WIDTH' | 'SCALE_THICKNESS', factor: number }>) => this._proposeAction({ type: e.detail.type, factor: e.detail.factor })}
            @add-outline-layer=${() => this._proposeAction({ type: 'ADD_OUTLINE_LAYER' })}
            @remove-outline-layer=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'REMOVE_OUTLINE_LAYER', index: e.detail.index })}
            @toggle-outline-layer=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'TOGGLE_OUTLINE_LAYER', index: e.detail.index })}
            @add-bottom-channel=${() => this._proposeAction({ type: 'ADD_BOTTOM_CHANNEL' })}
            @remove-bottom-channel=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'REMOVE_BOTTOM_CHANNEL', index: e.detail.index })}
            @toggle-channel-symmetry=${(e: CustomEvent<{ index: number }>) => this._proposeAction({ type: 'TOGGLE_CHANNEL_SYMMETRY', index: e.detail.index })}
            @open-contour-editor=${() => { this.showContourEditor = true; this.requestSliceProfile(); }}
                        @save-component=${(e: CustomEvent<{ type: ComponentType }>) => this._handleSaveComponent(e.detail.type)}
            @open-component-library=${(e: CustomEvent<{ type: ComponentType }>) => this._handleOpenComponentLibrary(e.detail.type)}
          ></board-controls>
        </div>

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

        <board-viewport 
          class="flex-1 w-full h-full relative z-0 overflow-hidden"
          .boardState=${state}
          .meshData=${mesh}
                    .mathEngine=${this.wasmCtrl.mathEngine}
          .selectedNodeContinuity=${this._selectedNodeContinuity}
          .isProcessing=${this.isProcessing}
          .isRendererReady=${this.isRendererReady}
          @init-renderer=${(e: CustomEvent<{canvas: OffscreenCanvas, width: number, height: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "INIT_RENDERER", canvas: e.detail.canvas, width: e.detail.width, height: e.detail.height }, [e.detail.canvas]);
              }
          }}
          @resize-renderer=${(e: CustomEvent<{width: number, height: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "RESIZE_RENDERER", width: e.detail.width, height: e.detail.height });
              }
          }}
          @viewport-pointer=${(e: CustomEvent<{type: string, x: number, y: number, quad: string}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "POINTER_EVENT", eventType: e.detail.type, x: e.detail.x, y: e.detail.y, quad: e.detail.quad });
              }
                            if (this.wasmCtrl.mathEngine) {
                  this.wasmCtrl.mathEngine.handle_pointer(e.detail.type, e.detail.x, e.detail.y, e.detail.quad);
              }
          }}
          @viewport-wheel=${(e: CustomEvent<{dy: number, quad: string}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "WHEEL_EVENT", dy: e.detail.dy, quad: e.detail.quad });
              }
                            if (this.wasmCtrl.mathEngine) {
                  this.wasmCtrl.mathEngine.handle_wheel(e.detail.dy, e.detail.quad);
              }
          }}
          @set-view-mode=${(e: CustomEvent<{mode: string}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_VIEW_MODE", mode: e.detail.mode });
              }
                            if (this.wasmCtrl.mathEngine) {
                  this.wasmCtrl.mathEngine.set_view_mode(e.detail.mode);
              }
          }}
          @set-ortho=${(e: CustomEvent<{isOrtho: boolean}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_ORTHO", isOrtho: e.detail.isOrtho });
              }
                            if (this.wasmCtrl.mathEngine) {
                  this.wasmCtrl.mathEngine.set_ortho(e.detail.isOrtho);
              }
          }}
          @boolean-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: boolean }>) => {
            this._proposeAction({ type: "UPDATE_BOOLEAN", param: e.detail.param, value: e.detail.value });
          }}
          @preview-number=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => {
            this._previewAction({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
          }}
          @number-changed=${(e: CustomEvent<{ param: keyof BoardModel; value: number }>) => {
            this._proposeAction({ type: "UPDATE_NUMBER", param: e.detail.param, value: e.detail.value });
          }}
          @set-gizmo-scale=${(e: CustomEvent<{quad: string, scale: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_GIZMO_SCALE", quad: e.detail.quad, scale: e.detail.scale });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { set_gizmo_scale(quad: string, scale: number): void };
                  (this.wasmCtrl.mathEngine as unknown as EngineExt).set_gizmo_scale(e.detail.quad, e.detail.scale);
              }
          }}
          @set-show-tangents=${(e: CustomEvent<{quad: string, show: boolean}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_SHOW_TANGENTS", quad: e.detail.quad, show: e.detail.show });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { set_show_tangents(quad: string, show: boolean): void };
                  (this.wasmCtrl.mathEngine as unknown as EngineExt).set_show_tangents(e.detail.quad, e.detail.show); 
              }
          }}
          @set-masks=${(e: CustomEvent<{quad: string, lineMask: number, gizmoMask: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_MASKS", quad: e.detail.quad, lineMask: e.detail.lineMask, gizmoMask: e.detail.gizmoMask });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { set_masks(quad: string, lineMask: number, gizmoMask: number): void };
                  (this.wasmCtrl.mathEngine as unknown as EngineExt).set_masks(e.detail.quad, e.detail.lineMask, e.detail.gizmoMask);
              }
          }}
          @set-show-solid-mesh=${(e: CustomEvent<{show: boolean}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_SHOW_SOLID_MESH", show: e.detail.show });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { set_show_solid_mesh(show: boolean): void };
                  (this.wasmCtrl.mathEngine as unknown as EngineExt).set_show_solid_mesh(e.detail.show);
              }
          }}
          @set-active-profile-slice=${(e: CustomEvent<{slice: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_ACTIVE_PROFILE_SLICE", slice: e.detail.slice });
              }
                            if (this.wasmCtrl.mathEngine) {
                  this.wasmCtrl.mathEngine.set_active_profile_slice(e.detail.slice);
              }
          }}
          @set-hover-z=${(e: CustomEvent<{z?: number}>) => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "SET_HOVER_Z", z: e.detail.z });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { set_hover_z(z?: number): void };
                  (this.wasmCtrl.mathEngine as unknown as EngineExt).set_hover_z(e.detail.z);
              }
          }}
          @flip-camera=${() => {
              const worker = (this.wasmCtrl as unknown as { worker?: Worker }).worker;
              if (worker) {
                  worker.postMessage({ type: "FLIP_CAMERA" });
              }
                            if (this.wasmCtrl.mathEngine) {
                  type EngineExt = WasmEngine & { flip_camera(): void };
                  if ((this.wasmCtrl.mathEngine as unknown as EngineExt).flip_camera) {
                      (this.wasmCtrl.mathEngine as unknown as EngineExt).flip_camera();
                  }
              }
          }}
          @node-selected=${(e: CustomEvent<{ node: { curve: string, index: number, type: 'anchor'|'tangent1'|'tangent2' } | null }>) => {
            this._proposeAction({ type: "SELECT_NODE", node: e.detail.node });
            this._selectedNodeContinuity = 'G1';
          }}
          @insert-node=${(e: CustomEvent<{curve: string, t: number}>) => this._proposeAction({ type: "INSERT_NODE", curve: e.detail.curve, t: e.detail.t })}
          @add-cross-section=${(e: CustomEvent<{z: number}>) => this._proposeAction({ type: "ADD_CROSS_SECTION", z: e.detail.z })}
          @gizmo-drag-ended=${(e: CustomEvent<{ userData: { type: 'anchor' | 'tangent1' | 'tangent2', curve: string, index: number }, position: [number, number, number] | null }>) => {
              this._pendingDragDetail = null; // Clear pending throttled frames so it doesn't fire after the final PROPOSE action
              if (e.detail.position) {
                  this._proposeAction({
                      type: "UPDATE_NODE_POSITION",
                      curve: e.detail.userData.curve,
                      nodeType: e.detail.userData.type,
                      index: e.detail.userData.index,
                      position: e.detail.position
                  });
                  if (this._selectedNodeContinuity !== 'G0' && (e.detail.userData.type === 'tangent1' || e.detail.userData.type === 'tangent2')) {
                      this._proposeAction({
                          type: 'APPLY_CONTINUITY',
                          curve: e.detail.userData.curve,
                          index: e.detail.userData.index,
                          level: this._selectedNodeContinuity,
                          master: e.detail.userData.type
                      });
                  }
              }
              this._proposeAction({ type: "SAVE_HISTORY_SNAPSHOT" });
          }}
          @gizmo-dragged=${this._handleGizmoDrag}
        >        </board-viewport>
      </div>
    `;
    return res;
  }
}
