import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    setupFiles: ['./test/setup.e2e.ts'],
    // H38 · la BD de desarrollo está en Neon y cada caso tarda varios segundos:
    // el default de 5 s produce timeouts que parecen fallos de negocio.
    testTimeout: 30_000,
  },
});
