import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true, // reachable from other devices on your Wi-Fi
    port: 5173,
  },
});
