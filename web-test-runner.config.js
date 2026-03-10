import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  files:['src/**/*.test.ts'],
  plugins:[esbuildPlugin({ ts: true, target: 'es2022' })],
  nodeResolve: {
    exportConditions: ['browser', 'development'],
  },
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
  ],
  testFramework: {
    config: {
      timeout: 2000,
    },
  },
};
