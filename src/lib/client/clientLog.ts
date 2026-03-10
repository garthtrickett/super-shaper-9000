// FILE: src/lib/client/clientLog.ts
import { Effect } from "effect";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * clientLog utilizes Effect's native structured logging.
 * This keeps all observability tracking (Fibers, Spans, Timestamps) 
 * local to the browser console for excellent debugging without network overhead.
 */
export const clientLog = (
  level: LogLevel,
  ...args: unknown[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Extract the primary message
    const message = typeof args[0] === "string" ? args[0] : "UI Event";
    
    // Group remaining arguments as metadata payload
    const data = args.length > 1 ? args.slice(1) : (typeof args[0] !== "string" ? args[0] : undefined);

    // Select the correct Effect logger based on severity
    const logEffect = (() => {
      switch (level) {
        case "error": return Effect.logError(message);
        case "warn": return Effect.logWarning(message);
        case "debug": return Effect.logDebug(message);
        case "info":
        default: return Effect.logInfo(message);
      }
    })();

    // If we have extra data, annotate the log so Effect formats it cleanly
    if (data !== undefined && data !== null) {
      yield* logEffect.pipe(Effect.annotateLogs("payload", data));
    } else {
      yield* logEffect;
    }
  });
