import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { computeBoardMesh } from "./services/rhino-compute";

export const app = new Elysia()
  .use(cors())
  // Connects to Rhino.Compute to generate the 3D board mesh
  .post("/api/compute/board", async ({ body, set }) => {
      console.info("[Server] Received compute request:", body);
      try {
        const result = await computeBoardMesh(body);
        return { status: "success", data: result };
      } catch  {
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
  .use(
    staticPlugin({
      assets: "./dist/assets",
      prefix: "/assets",
    }),
  )
  .get("*", () => Bun.file("./dist/index.html"));

app.listen(42069);
console.info(`\n🏄‍♂️ Super Shaper API running at http://${app.server?.hostname}:${app.server?.port}\n`);

export type App = typeof app;
