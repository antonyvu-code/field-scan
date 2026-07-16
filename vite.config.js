import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { port: 5624 },
  preview: { port: 5624 },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        case: resolve(__dirname, 'case-study.html'),
      },
    },
  },
});
