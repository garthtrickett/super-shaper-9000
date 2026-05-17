import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    plugins: [
    tailwindcss(),
    {
            name: 'fix-rayon-worker-import',
      enforce: 'pre',
      transform(code, id) {
        if (id.includes('workerHelpers.js')) {
          return {
            code: code.replace(/import\(['"]\.\.\/\.\.\/\.\.['"]\)/g, "import('../../../surfer_wasm.js')"),
            map: null
          };
        }
      }
    },
    {
      name: 'isolation-headers',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          next();
        });
      }
    }
  ],
  server: {
    host: "127.0.0.1",
    allowedHosts: true,
    port: 3000,
        strictPort: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin"
    },
    hmr: {
      host: "127.0.0.1",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:42069",
        changeOrigin: true,
      }
    },
  },
});
