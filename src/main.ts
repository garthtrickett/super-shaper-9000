import "./styles/index.css";
import "./components/layouts/app-shell.ts";
import { clientLog } from "./lib/client/clientLog";
import { runClientUnscoped } from "./lib/client/runtime";

window.addEventListener("error", (event) => {
  const err = event.error as unknown;
  const stackTrace = err instanceof Error ? err.stack : undefined;
  runClientUnscoped(
    clientLog("error", "[Browser Crash] Unhandled Exception", {
      message: event.message,
      stack: stackTrace || "No stack trace available"
    })
  );
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason as unknown;
  runClientUnscoped(
    clientLog("error", "[Browser Crash] Unhandled Promise Rejection", {
        message: reason instanceof Error ? reason.message : String(reason)
    })
  );
});

runClientUnscoped(clientLog("info", "Super Shaper 9000 Initialized"));
