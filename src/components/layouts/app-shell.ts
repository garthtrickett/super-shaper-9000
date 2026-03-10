import { render, html } from "lit-html";
import { Stream, Effect, Fiber } from "effect";
import { matchRoute } from "../../lib/client/router";
import { LocationService } from "../../lib/client/LocationService";
import "./AppLayout";
import { clientLog } from "../../lib/client/clientLog";
import { runClientPromise, runClientUnscoped } from "../../lib/client/runtime";

const processStateChange = (
  appRoot: HTMLElement,
  path: string
) =>
  Effect.gen(function* () {
    yield* clientLog("info", `[app-shell] Route changed to ${path}`);

    const route = yield* matchRoute(path);
    const { template: pageTemplate } = route.view(...route.params);

    yield* Effect.sync(() =>
      render(
        html`
          <app-layout
            .content=${pageTemplate}
          ></app-layout>
        `,
        appRoot,
      ),
    );
  });

export class AppShell extends HTMLElement {
  private mainFiber?: Fiber.RuntimeFiber<void, unknown>;

  protected createRenderRoot() {
    return this;
  }

  connectedCallback() {
    const mainAppStream = Stream.unwrap(Effect.gen(function* () {
        const location = yield* LocationService;
        return location.pathname;
    })).pipe(
      Stream.flatMap(
        (path) => Stream.fromEffect(processStateChange(this, path)),
        { switch: true },
      ),
    );
    
    this.mainFiber = runClientUnscoped(Stream.runDrain(mainAppStream));
  }

  disconnectedCallback() {
    if (this.mainFiber) {
      void runClientPromise(Fiber.interrupt(this.mainFiber));
    }
  }
}

customElements.define("app-shell", AppShell);
