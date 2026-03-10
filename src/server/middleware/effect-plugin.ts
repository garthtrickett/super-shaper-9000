// FILE: src/server/middleware/effect-plugin.ts
import { Elysia } from "elysia";
import { Effect, Tracer, Context } from "effect";
import { serverRuntime } from "../../lib/server/server-runtime";

const getParentSpanContext = (
  headers: Headers,
): Tracer.ExternalSpan | undefined => {
  const traceParent = headers.get("traceparent");
  if (!traceParent) return undefined;

  const parts = traceParent.split("-");
  if (parts.length < 4) return undefined;

  // ✅ FIX: Explicitly cast parts to a tuple to avoid "unsafe array destructuring" error
  const [_version, traceId, spanId, flags] = parts as [string, string, string, string];

  if (!traceId || !spanId) return undefined;

  return {
    _tag: "ExternalSpan",
    traceId,
    spanId,
    sampled: flags === "01",
    context: Context.empty(),
  };
};

export const effectPlugin = (app: Elysia) => app.derive(
  { as: "global" },
  ({ request }) => {
    return {
      /**
       * Runs an Effect using the server's instrumented runtime.
       */
      runEffect: <A, E>(
        // Use 'any' to allow dependencies to be inferred from the runtime context if needed
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        effect: Effect.Effect<A, E, any>,
        options?: { name?: string; attributes?: Record<string, unknown> },
      ): Promise<A> => {
        const method = request.method;
        const url = new URL(request.url);
        const spanName = options?.name || `HTTP ${method} ${url.pathname}`;

        const parentContext = getParentSpanContext(request.headers);

        const instrumentedEffect = Effect.makeSpan(spanName, {
          kind: "server",
          attributes: {
            "http.method": method,
            "http.url": request.url,
            "http.path": url.pathname,
            ...options?.attributes,
          },
          parent: parentContext,
        }).pipe(
          Effect.flatMap((span) =>
            effect.pipe(
              Effect.annotateLogs("traceId", span.traceId),
              Effect.annotateLogs("spanId", span.spanId),
            ),
          ),
        );

        return serverRuntime.runPromise(
          // Cast to never dependencies because the runtime provides them
          instrumentedEffect as unknown as Effect.Effect<A, E, never>,
        );
      },
    };
  },
);
