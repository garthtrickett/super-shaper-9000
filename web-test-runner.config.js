import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files:['src/**/*.test.ts'],
  plugins:[esbuildPlugin({ ts: true, target: 'es2022' })],
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
