import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 3000,
    proxy: {
      '/store': {
        target: process.env.VITE_MEDUSA_BACKEND_URL || 'http://localhost:9000',
        changeOrigin: true,
      },
    },
  },
});
