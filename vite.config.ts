import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const tunnelHost = (env.VITE_EXTERNAL_DEV_HOST || 'gitbible.grinn.net').trim().toLowerCase();
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
      sourcemap: true
    },
    publicDir: 'public'
  };
});
