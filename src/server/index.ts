// File: src/server/index.ts
// ===================================

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { computeBoardMesh } from "./services/rhino-compute";
import { path } from "path";

export const app = new Elysia()
  .use(cors())
  // Connects to Rhino.Compute to generate the 3D board mesh
  .post("/api/compute/board", async ({ body, set }) => {
      console.info("[Server] Received compute request:", body);
      try {
        const result = await computeBoardMesh(body);
        return { status: "success", data: result };
      } catch (err) {
        console.error("[Server] Compute Error:", err);
        set.status = 500;
        return { status: "error", message: "Compute failed" };
      }
  }, {
    body: t.Object({
      length: t.Number(),
      width: t.Number(),
      thickness: t.Number(),
      tailType: t.String()
    })
  })
  // Serve static assets from the Vite build directory
  .use(
    staticPlugin({
      assets: "dist",
      prefix: "/",
    }),
  )
  // SPA Fallback: Serve index.html for any route not caught by the above
  .get("*", ({ set }) => {
    const file = Bun.file("dist/index.html");
    if (file.size === 0) {
        set.status = 404;
        return "Build artifacts not found. Run 'bun run build' first.";
    }
    return file;
  });

const PORT = process.env.PORT || 42069;
app.listen(PORT);

console.info(`\n🏄‍♂️ Super Shaper API running in ${process.env.NODE_ENV || 'development'} mode`);
console.info(`🔗 URL: http://${app.server?.hostname}:${app.server?.port}\n`);

export type App = typeof app;
