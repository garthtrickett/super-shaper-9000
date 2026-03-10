// FILE: src/lib/client/sam-controller.ts

import type { ReactiveController, ReactiveControllerHost } from "lit";

// A type for the pure update function
type Update<Model, Action> = (model: Model, action: Action) => Model;

/**
 * A simple synchronous state container for Lit components following the SAM pattern.
 * This controller's responsibility is to hold state, apply pure state updates,
 * and request a re-render from the host component. All asynchronous orchestration
 * is handled by the component itself.
 */
export class SamController<T extends ReactiveControllerHost, Model, Action>
  implements ReactiveController
{
  // Public state that the component can read from
  public model: Model;

  constructor(
    private host: T,
    initialModel: Model,
    private update: Update<Model, Action>,
  ) {
    this.model = initialModel;
    host.addController(this);
  }

  /** Proposes a synchronous state update and requests a re-render. */
  propose = (action: Action): void => {
    this.model = this.update(this.model, action);
    this.host.requestUpdate();
  };

  // Lifecycle hooks are managed by the host component.
  hostConnected() {}
  hostDisconnected() {}
}
