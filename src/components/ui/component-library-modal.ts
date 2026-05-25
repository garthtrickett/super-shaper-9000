import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getComponentIndex, deleteComponentFromLibrary, loadComponentFromLibrary } from '../../lib/client/component-library-store';
import type { ComponentEntry, ComponentType } from '../pages/board-builder-page.logic';
import { clientLog } from '../../lib/client/clientLog';
import { runClientUnscoped } from '../../lib/client/runtime';

@customElement('component-library-modal')
export class ComponentLibraryModal extends LitElement {
  @state() private activeTab: ComponentType = 'outline';
  @state() private components: ComponentEntry[] = [];

  protected override createRenderRoot() {
    return this; // Light DOM for Tailwind
  }

  override connectedCallback() {
    super.connectedCallback();
    this._refreshIndex();
  }

  private _refreshIndex() {
    runClientUnscoped(clientLog('info', '[ComponentLibraryModal] Refreshing component index'));
    this.components = getComponentIndex();
  }

  private _handleClose = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  };

  private _handleLoad(entry: ComponentEntry) {
    runClientUnscoped(clientLog('info', `[ComponentLibraryModal] Loading component: ${entry.name} (${entry.id})`));
    const payload = loadComponentFromLibrary(entry.id);
    if (payload) {
      this.dispatchEvent(new CustomEvent('import-component', {
        detail: { type: entry.type, payload },
        bubbles: true,
        composed: true
      }));
      this._handleClose();
    } else {
      alert('Failed to load this component. It may be corrupted.');
    }
  }

  private _handleDelete(entry: ComponentEntry) {
    if (confirm(`Are you sure you want to permanently delete "${entry.name}" from your library?`)) {
      runClientUnscoped(clientLog('info', `[ComponentLibraryModal] Deleting component: ${entry.name} (${entry.id})`));
      deleteComponentFromLibrary(entry.id);
      this._refreshIndex();
    }
  }

  private _formatDate(dateString: string): string {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  }

  override render() {
    const filtered = this.components.filter(c => c.type === this.activeTab);

    return html`
      <div class='fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4'>
        <div class='bg-zinc-900 border border-zinc-800 p-6 rounded-lg shadow-2xl w-[600px] max-w-full flex flex-col max-h-[90vh] overflow-hidden'>
          <div class='flex justify-between items-center mb-4 pb-2 border-b border-zinc-800'>
            <h2 class='text-xl font-bold text-zinc-100 flex items-center gap-2'>
              <svg class='w-5 h-5 text-blue-500' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012 2v2M7 7h10'></path>
              </svg>
              Component Library (Mix & Match)
            </h2>
            <button type='button' @click=${this._handleClose} class='text-zinc-500 hover:text-white transition-colors cursor-pointer'>
              <svg class='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M6 18L18 6M6 6l12 12'></path></svg>
            </button>
          </div>

          <!-- Tab Navigation -->
          <div class='flex border-b border-zinc-800 mb-4 gap-1 overflow-x-auto custom-scrollbar'>
            ${([
              { id: 'outline', label: 'Outlines' },
              { id: 'rocker', label: 'Rockers' },
              { id: 'slices', label: 'Slices' },
              { id: 'channels', label: 'Channels' },
              { id: 'fins', label: 'Fins' }
            ] as { id: ComponentType, label: string }[]).map(tab => html`
              <button
                type='button'
                @click=${() => this.activeTab = tab.id}
                class='px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap
                  ${this.activeTab === tab.id 
                    ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                    : 'border-transparent text-zinc-400 hover:text-zinc-200'}'
              >
                ${tab.label}
              </button>
            `)}
          </div>

          <!-- Component List -->
          <div class='flex-1 overflow-y-auto custom-scrollbar pr-1 mb-4 space-y-2'>
            ${filtered.length === 0 ? html`
              <div class='flex flex-col items-center justify-center py-12 text-center'>
                <svg class='w-12 h-12 text-zinc-600 mb-3' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2m16 0h-2m-2 0H8m-2 0H4'></path>
                </svg>
                <p class='text-sm font-bold text-zinc-400 uppercase tracking-widest'>No saved ${this.activeTab}s</p>
                <p class='text-xs text-zinc-600 mt-1 max-w-xs'>Save your design sub-arrays from the accordions to build up your reusable library.</p>
              </div>
            ` : filtered.map(entry => html`
              <div class='flex items-center justify-between p-3 bg-zinc-950/40 hover:bg-zinc-800/30 border border-zinc-800/50 rounded-lg transition-all'>
                <div class='flex flex-col min-w-0 pr-4'>
                  <span class='text-sm font-bold text-zinc-200 truncate'>${entry.name}</span>
                  <span class='text-[10px] font-mono text-zinc-500 mt-0.5'>Saved: ${this._formatDate(entry.updatedAt)}</span>
                </div>
                <div class='flex items-center gap-2 shrink-0'>
                  <button type='button' @click=${() => this._handleLoad(entry)} class='px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white rounded transition-colors cursor-pointer'>
                    Load
                  </button>
                  <button type='button' @click=${() => this._handleDelete(entry)} class='px-3 py-1.5 bg-zinc-800 hover:bg-red-950/40 hover:text-red-400 border border-zinc-700/50 hover:border-red-900/50 text-xs font-bold text-zinc-400 rounded transition-all cursor-pointer'>
                    Delete
                  </button>
                </div>
              </div>
            `)}
          </div>

          <div class='flex justify-end pt-2 border-t border-zinc-800'>
            <button type='button' @click=${this._handleClose} class='px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold text-zinc-300 rounded transition-colors cursor-pointer'>Close</button>
          </div>
        </div>
      </div>
    `;
  }
}