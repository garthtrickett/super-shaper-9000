import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files:[
    'src/**/*.test.ts',
    '!src/server/**/*.test.ts'
  ],
  middleware: [
    async (context, next) => {
      context.set('Cross-Origin-Opener-Policy', 'same-origin');
      context.set('Cross-Origin-Embedder-Policy', 'require-corp');
      await next();
    }
  ],
    plugins:[
    {
      name: 'fix-rayon-worker-import',
      transform(context) {
        if (context.path && context.path.endsWith('workerHelpers.js')) {
          const body = typeof context.body === 'string' ? context.body : context.body.toString();
          return { body: body.replace(/import\(['"]\.\.\/\.\.\/\.\.['"]\)/g, "import('../../../surfer_wasm.js')"), type: 'js' };
        }
      }
    },
    {
      name: 'vite-wasm-url-mock',
      /** @param {{ path: string }} context */
      transform(context) {
        // Only mock explicit ?url imports (like Rhino) so our Rust WASM loads natively in tests
        if (context.path && context.path.includes('?url')) {
          return { body: 'export default "/mock-wasm-url.wasm";', type: 'js' };
        }
      }
    },
    esbuildPlugin({ 
      ts: true, 
      target: 'es2022',
      tsconfig: './tsconfig.json'
    })
  ],
  nodeResolve: {
    exportConditions: ['browser', 'development'],
  },
  browsers:[
    playwrightLauncher({ 
      product: 'chromium',
            launchOptions: {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--enable-features=SharedArrayBuffer']
      }
    }),
  ],
    testFramework: {
    config: {
      timeout: 15000,
    },
  },
};
