// FILE: src/lib/client/LocationService.ts
import { Context, Effect, Layer, Stream, Chunk } from "effect";
import { clientLog } from "./clientLog";

export interface ILocationService {
  readonly pathname: Stream.Stream<string>;
  readonly navigate: (path: string) => Effect.Effect<void>;
}

export class LocationService extends Context.Tag("app/LocationService")<
  LocationService,
  ILocationService
>() {}

export const LocationLive: Layer.Layer<LocationService> = Layer.sync(
  LocationService,
  () => {
    const implementation: ILocationService = {
      pathname: Stream.async<string>((emit) => {
        const emitPath = () =>
          void emit(Effect.succeed(Chunk.of(window.location.pathname)));

        const locationChangedHandler = () => {
            clientLog(
              "debug",
              "Received custom 'location-changed' event.",
              undefined,
              "LocationService",
          );
          emitPath();
        };

        window.addEventListener("popstate", emitPath);
        window.addEventListener("location-changed", locationChangedHandler);
        emitPath(); // Emit the initial path

        return Effect.sync(() => {
          window.removeEventListener("popstate", emitPath);
          window.removeEventListener("location-changed", locationChangedHandler);
        });
      }).pipe(Stream.changes),

      navigate: (path: string) =>
        Effect.sync(() => {
          if (window.location.pathname === path) return;

          const doNavigation = () => {
            window.history.pushState({}, "", path);
            window.dispatchEvent(new CustomEvent("location-changed"));
          };
          
          // Use View Transitions API if available
          if (document.startViewTransition) {
            const transition = document.startViewTransition(doNavigation);
            
            // ✅ FIX: Catch ALL promises associated with the transition.
            // When a transition is skipped (collision), the browser rejects
            // 'ready', 'finished', AND 'updateCallbackDone'.
            // Missing any one of these causes SES/Lockdown to throw an Unhandled Rejection.
            transition.ready.catch(() => {});
            transition.finished.catch(() => {});
            transition.updateCallbackDone.catch(() => {});
          } else {
            doNavigation();
          }
        }),
    };
    return implementation;
  },
);
