import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'dist-electron/**',
        'release/**',
        'build/**',
        'mocks/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData/**',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      electron: path.resolve(__dirname, './mocks/electron.ts'),
    },
  },
});
