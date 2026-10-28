import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['jspdf'],
    exclude: ['pdfjs-dist'],
  },
});