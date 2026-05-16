import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface KeyboardControllerOptions {
  onUndo: () => void;
  onRedo: () => void;
}

export class KeyboardController implements ReactiveController {
  private _onUndo: () => void;
  private _onRedo: () => void;

  constructor(
    private host: ReactiveControllerHost,
    options: KeyboardControllerOptions,
  ) {
    this._onUndo = options.onUndo;
    this._onRedo = options.onRedo;
    this.host.addController(this);
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
          this._onRedo();
        } else {
          this._onUndo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this._onRedo();
      }
    }
  };

  hostConnected() {
    window.addEventListener("keydown", this._handleKeyDown);
  }

  hostDisconnected() {
    window.removeEventListener("keydown", this._handleKeyDown);
  }
}
