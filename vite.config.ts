import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tunnelHost = (env.VITE_EXTERNAL_DEV_HOST || 'marginaliabible.com').trim().toLowerCase();
  const tunnelOrigin = `https://${tunnelHost}`;

  return {
    plugins: [react(), svgr()],
    server: {
      host: true,
      port: 3000,
      strictPort: true,
      open: true,
      allowedHosts: ['localhost', tunnelHost],
      origin: tunnelOrigin,
      hmr: {
        protocol: 'wss',
        host: tunnelHost,
        clientPort: 443
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rolldownOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('pdfjs-dist')) {
              return 'vendor-pdf';
            }

            if (id.includes('react-select') || id.includes('@emotion')) {
              return 'vendor-select';
            }

            if (id.includes('minisearch') || id.includes('stemmer')) {
              return 'vendor-search';
            }

            if (id.includes('react') || id.includes('@reduxjs') || id.includes('redux')) {
              return 'vendor-react';
            }

            return 'vendor';
          }
        }
      }
    },
    publicDir: 'public'
  };
});
