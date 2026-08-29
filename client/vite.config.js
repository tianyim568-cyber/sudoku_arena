import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // Windows + jsdom: running test files in parallel was timing out on this
    // machine. Run them one after another instead. Slower, but stable.
    // (Vitest 4 removed `poolOptions.forks.singleFork`; this is the successor.)
    fileParallelism: false,
    // Windows + jsdom is slow to bootstrap; give each test 15s before timing
    // out. Default 5s was too tight on this machine.
    testTimeout: 15000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      // ws:true forwards the WebSocket upgrade to Socket.IO (dev only; prod uses nginx).
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
        // Suppress ECONNABORTED/ECONNRESET noise from the proxy when the
        // browser closes a tab or the socket reconnects. The real error is
        // harmless — the client reconnects on its own.
        configure: (proxy) => {
          proxy.on('error', (err) => {
            if (['ECONNABORTED', 'ECONNRESET', 'EPIPE'].includes(err.code)) return;
            console.error('[ws proxy]', err.message);
          });
        },
      }
    }
  }
})
