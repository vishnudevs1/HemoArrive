import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // the PDF libraries are loaded on demand; pre-bundle them at startup so the dev server
  // never has to reload the page the first time someone downloads a PDF
  optimizeDeps: { include: ['jspdf', 'jspdf-autotable'] },
});
