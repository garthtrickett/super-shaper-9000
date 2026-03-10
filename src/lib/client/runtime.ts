import {
  Effect,
  Layer,
  Runtime,
  Scope,
  Cause
} from "effect";
import { clientLog } from "./clientLog";
import { LocationLive, LocationService } from "./LocationService";

export type FullClientContext = LocationService;

export const BaseClientLive = LocationLive;

const appScope = Effect.runSync(Scope.make());

export const AppRuntime = Effect.runSync(
  Scope.extend(Layer.toRuntime(BaseClientLive), appScope),
);

export const clientRuntime: Runtime.Runtime<FullClientContext> =
  AppRuntime as Runtime.Runtime<FullClientContext>;

const withGlobalErrorReporting = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  return effect.pipe(
    Effect.tapErrorCause((cause) => 
      Effect.sync(() => {
        if (!Cause.isInterruptedOnly(cause)) {
          const failure = Cause.squash(cause);
          console.error("[Runtime] Unhandled Effect Failure:", failure);
        }
      })
    )
  );
};

export const runClientPromise = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runPromise(clientRuntime)(withGlobalErrorReporting(effect));
};

export const runClientUnscoped = <A, E>(
  effect: Effect.Effect<A, E, FullClientContext>,
) => {
  return Runtime.runFork(clientRuntime)(withGlobalErrorReporting(effect));
};
