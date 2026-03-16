import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files:[
    'src/**/*.test.ts',
    '!src/server/**/*.test.ts'
  ],
  plugins:[
    {
      name: 'vite-wasm-url-mock',
      /** @param {{ path: string }} context */
      transform(context) {
        if (context.path && context.path.endsWith('.wasm')) {
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
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      }
    }),
  ],
  testFramework: {
    config: {
      timeout: 2000,
    },
  },
};
