import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";

export const app = new Elysia()
  .use(cors())
  // Placeholder route for Rhino.Compute interaction
  .post("/api/compute/board", ({ body }) => {
      console.log("[Server] Received compute request:", body);
      return { status: "success", mesh: "MOCK_MESH_DATA_SOON" };
  })
  .use(
    staticPlugin({
      assets: "./dist/assets",
      prefix: "/assets",
    }),
  )
  .get("*", () => Bun.file("./dist/index.html"));

app.listen(42069);
console.log(`\n🏄‍♂️ Super Shaper API running at http://${app.server?.hostname}:${app.server?.port}\n`);

export type App = typeof app;
