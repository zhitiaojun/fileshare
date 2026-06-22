import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/setup': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
      '/robots.txt': 'http://localhost:8787',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
});
