// src/lib/client/reactive-sam-controller.ts
import { Effect, Fiber, Queue, Stream } from "effect";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { runClientUnscoped } from "./runtime";
import type { FullClientContext } from "./runtime";
import { clientLog } from "./clientLog";

// A type for the pure update function
type Update<Model, Action> = (model: Model, action: Action) => Model;

// A type for the effectful action handler, now generic over the error type `E`
type HandleAction<Model, Action, E, R> = (
  action: Action,
  model: Model,
  propose: (action: Action) => void,
) => Effect.Effect<void, E, R>;

export class ReactiveSamController<
  T extends ReactiveControllerHost,
  Model,
  Action,
  E, // The new generic parameter for the Error type
  R extends FullClientContext = FullClientContext,
> implements ReactiveController
{
  private readonly _actionQueue = Effect.runSync(Queue.unbounded<Action>());
  private _mainFiber?: Fiber.RuntimeFiber<void, unknown>;

  // Public state that the component can read from
  public model: Model;

  constructor(
    private host: T,
    initialModel: Model,
    private update: Update<Model, Action>,
    private handleAction: HandleAction<Model, Action, E, R>,
  ) {
    this.model = initialModel;
    host.addController(this);
  }

  /** Proposes an action to the state machine. */
  propose = (action: Action): void => {
    runClientUnscoped(Queue.offer(this._actionQueue, action));
  };

  private readonly _run = Stream.fromQueue(this._actionQueue).pipe(
    Stream.runForEach((action) => {
      // Update the model synchronously
      this.model = this.update(this.model, action);
      this.host.requestUpdate(); // Request a re-render

      // Run the effectful part of the action.
      // The runtime that executes this (`runClientUnscoped`) will provide the dependencies.
      // We explicitly cast here to help TypeScript's inference.
      return this.handleAction(action, this.model, this.propose).pipe(
        Effect.catchAll((err) =>
          clientLog(
            "error",
            `[ReactiveSamController] Unhandled error for action "${
              (action as { type: string }).type
            }"`,
            err,
          ),
        ),
      );
    }),
  );

  hostConnected() {
    this._mainFiber = runClientUnscoped(this._run);
  }

  hostDisconnected() {
    if (this._mainFiber) {
      runClientUnscoped(Fiber.interrupt(this._mainFiber));
    }
  }
}
