import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend runs on :4000. CORS is enabled there, so the browser can call it
// directly from the Vite dev server on :5173.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
});
