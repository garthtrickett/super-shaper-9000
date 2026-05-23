import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Schema as S } from "effect";
import { BoardModelSchema, type BoardModel } from "../pages/board-builder-page.logic";
import { clientLog } from "../../lib/client/clientLog";
import { runClientUnscoped } from "../../lib/client/runtime";

// Asset URL imports via Vite
import fishS3dx from "../../assets/fixtures/s3dx/FISH.s3dx?url";
import tomoLikeS3dx from "../../assets/fixtures/s3dx/TomoLike.s3dx?url";
import roundedPinS3dx from "../../assets/fixtures/s3dx/rounded-pin-6-1.s3dx?url";
import dumpsterDiverS3dx from "../../assets/fixtures/s3dx/CI-Dumpster-Diver.s3dx?url";
import wildcatS3dx from "../../assets/fixtures/s3dx/wildcat-fixed-winged-pin.s3dx?url";
import gh60S3dx from "../../assets/fixtures/s3dx/gh-60-winged-swallow.s3dx?url";
import midBevelS3dx from "../../assets/fixtures/s3dx/Mid Bevel.s3dx?url";
import singleChannelsS3dx from "../../assets/fixtures/s3dx/Single Channels.s3dx?url";

import miniSimmonsBrd from "../../assets/fixtures/brd/5'4-Mini-Simmons.brd?url";
import bumpSquashBrd from "../../assets/fixtures/brd/6'4-Bump-Squash-Full-Nose.brd?url";
import eggBrd from "../../assets/fixtures/brd/7'0-Egg.brd?url";

@customElement("import-modal")
export class ImportModal extends LitElement {
  @state() private importJson = "";
  @state() private importError = "";
  @state() private s3dxFolderOpen = true;
  @state() private brdFolderOpen = true;
  @state() private isFetchingStock = false;

  protected override createRenderRoot() {
    return this; // Use Light DOM to ensure Tailwind classes work
  }

  private _handleClose = () => {
    this.importJson = "";
    this.importError = "";
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  };

  private _handleLoadStock = async (name: string, url: string, type: "s3dx" | "brd") => {
    runClientUnscoped(clientLog("info", `[ImportModal] Fetching stock board: ${name} from ${url}`));
    this.isFetchingStock = true;
    this.importError = "";
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch stock board: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      if (type === "brd") {
        this.dispatchEvent(new CustomEvent("import-brd", {
          detail: { bytes: Array.from(new Uint8Array(buffer)) },
          bubbles: true,
          composed: true
        }));
        runClientUnscoped(clientLog("info", `[ImportModal] Successfully loaded stock BRD: ${name}`));
      } else {
        const decoder = new TextDecoder("iso-8859-1");
        const text = decoder.decode(buffer);
        this.dispatchEvent(new CustomEvent("import-s3dx", {
          detail: { xml: text },
          bubbles: true,
          composed: true
        }));
        runClientUnscoped(clientLog("info", `[ImportModal] Successfully loaded stock S3DX: ${name}`));
      }
      this._handleClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred";
      runClientUnscoped(clientLog("error", `[ImportModal] Failed to load stock board ${name}: ${msg}`));
      this.importError = `Failed to load stock design: ${msg}`;
    } finally {
      this.isFetchingStock = false;
    }
  };

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
        <div class="bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[650px] max-w-full flex flex-col max-h-[95vh] overflow-y-auto custom-scrollbar">
          <h2 class="text-xl font-bold text-zinc-100 mb-4">Import Design</h2>
          
          <!-- Stock Boards Catalog -->
          <div class="mb-6">
            <h3 class="text-sm font-bold text-zinc-300 mb-2 uppercase tracking-wider flex items-center gap-2">
              <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
              Stock Boards Catalog
            </h3>
            
            <div class="space-y-3 max-h-60 overflow-y-auto custom-scrollbar pr-1">
              <!-- S3DX Designs Folder -->
              <div class="border border-zinc-800 rounded bg-zinc-950/30 overflow-hidden">
                <button type="button" id="s3dx-folder-btn" @click=${() => this.s3dxFolderOpen = !this.s3dxFolderOpen} class="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/30 text-xs font-bold text-zinc-300 uppercase tracking-wider select-none hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50 cursor-pointer">
                  <span class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                    Shape3D Designs (.s3dx)
                  </span>
                  <svg class="w-4 h-4 text-zinc-500 transition-transform ${this.s3dxFolderOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>
                
                ${this.s3dxFolderOpen ? html`
                  <div class="p-2 space-y-1 divide-y divide-zinc-800/30">
                    ${[
                      { name: "Fish (Classic Outline)", url: fishS3dx, desc: "Classic retro fish outline with swallow tail" },
                      { name: "Tomo-Like (Modern Planing)", url: tomoLikeS3dx, desc: "Parallel rail, stubby nose high performance design" },
                      { name: "Rounded Pin 6'1\"", url: roundedPinS3dx, desc: "Sleek step-up rounded pin model" },
                      { name: "CI Dumpster Diver", url: dumpsterDiverS3dx, desc: "Short, wide, high performance groveler" },
                                            { name: "Wildcat (Winged Pin)", url: wildcatS3dx, desc: "Modern channel bottom winged pintail hybrid" },
                      { name: "GH-60 (Winged Swallow)", url: gh60S3dx, desc: "Classic performance hybrid winged swallow tail" },
                      { name: "Mid Bevel", url: midBevelS3dx, desc: "Performance midlength with chined/beveled rail panels" },
                      { name: "Single Channels", url: singleChannelsS3dx, desc: "Classic channel bottom design with customized tail exits" }
                    ].map(board => html`
                      <div class="flex items-center justify-between p-2 hover:bg-zinc-800/20 transition-all rounded">
                        <div class="flex flex-col">
                          <span class="text-xs font-semibold text-zinc-200">${board.name}</span>
                          <span class="text-[10px] text-zinc-500 font-sans">${board.desc}</span>
                        </div>
                        <button type="button" ?disabled=${this.isFetchingStock} @click=${() => this._handleLoadStock(board.name, board.url, "s3dx")} class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[10px] font-bold text-white rounded transition-colors cursor-pointer whitespace-nowrap">
                          Load Design
                        </button>
                      </div>
                    `)}
                  </div>
                ` : ""}
              </div>

              <!-- BRD Designs Folder -->
              <div class="border border-zinc-800 rounded bg-zinc-950/30 overflow-hidden">
                <button type="button" id="brd-folder-btn" @click=${() => this.brdFolderOpen = !this.brdFolderOpen} class="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/30 text-xs font-bold text-zinc-300 uppercase tracking-wider select-none hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/50 cursor-pointer">
                  <span class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                    BoardCAD Designs (.brd)
                  </span>
                  <svg class="w-4 h-4 text-zinc-500 transition-transform ${this.brdFolderOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>
                
                ${this.brdFolderOpen ? html`
                  <div class="p-2 space-y-1 divide-y divide-zinc-800/30">
                    ${[
                      { name: "5'4\" Mini Simmons", url: miniSimmonsBrd, desc: "Ultra-wide, super fast planning hull" },
                      { name: "6'4\" Bump Squash (Full Nose)", url: bumpSquashBrd, desc: "Aggressive shortboard with forward volume" },
                      { name: "7'0\" Egg", url: eggBrd, desc: "Classic midlength egg for smooth, flowing lines" }
                    ].map(board => html`
                      <div class="flex items-center justify-between p-2 hover:bg-zinc-800/20 transition-all rounded">
                        <div class="flex flex-col">
                          <span class="text-xs font-semibold text-zinc-200">${board.name}</span>
                          <span class="text-[10px] text-zinc-500 font-sans">${board.desc}</span>
                        </div>
                        <button type="button" ?disabled=${this.isFetchingStock} @click=${() => this._handleLoadStock(board.name, board.url, "brd")} class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[10px] font-bold text-white rounded transition-colors cursor-pointer whitespace-nowrap">
                          Load Design
                        </button>
                      </div>
                    `)}
                  </div>
                ` : ""}
              </div>
            </div>
          </div>
          
          <div class="flex items-center gap-4 mb-6">
            <div class="flex-1 h-px bg-zinc-800"></div>
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-widest">OR LOAD LOCAL FILE</span>
            <div class="flex-1 h-px bg-zinc-800"></div>
          </div>

          <div class="mb-6 p-4 bg-zinc-950 border border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center text-center bg-zinc-950/20">
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
            class="w-full h-32 bg-zinc-950 border border-zinc-800 text-zinc-300 p-3 rounded text-xs font-mono mb-2 focus:outline-none focus:border-blue-500 custom-scrollbar"></textarea>
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
