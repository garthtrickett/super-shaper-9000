import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("app-layout")
export class AppLayout extends LitElement {
  @property({ attribute: false })
  content?: TemplateResult;

  protected override createRenderRoot() {
    return this; 
  }

  override render() {
    return html`
      <div class="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-50">
        <header
          class="z-10 flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-3 bg-zinc-900"
        >
          <div class="flex items-center gap-4">
            <div class="font-black text-xl tracking-tighter text-blue-500">
              SUPER SHAPER <span class="text-zinc-100">9000</span>
            </div>
          </div>
        </header>

        <div class="relative flex flex-1 min-h-0">
          <main class="flex-1 overflow-hidden relative">
            ${this.content}
          </main>
        </div>
      </div>
    `;
  }
}
