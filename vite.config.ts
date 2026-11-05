import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const sanctumRoot = path.resolve(uiRoot, '../Marginalia.UI.Sanctum');
const sanctumEntry = path.join(sanctumRoot, 'src/index.ts');
const sanctumStub = path.resolve(uiRoot, 'src/sanctum/stub.ts');

function isSanctumFlagOn(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const sanctumEnabled = isSanctumFlagOn(process.env.VITE_SANCTUM) || isSanctumFlagOn(env.VITE_SANCTUM);
  const sanctumExists = fs.existsSync(sanctumEntry);

  if (sanctumEnabled && !sanctumExists) {
    throw new Error(
      'VITE_SANCTUM=1 but Marginalia.UI.Sanctum was not found next to Marginalia.UI (expected ../Marginalia.UI.Sanctum/src/index.ts).'
    );
  }

  const tunnelHost = (env.VITE_EXTERNAL_DEV_HOST || '').trim().toLowerCase();
  const useTunnel = tunnelHost.length > 0;
  const tunnelOrigin = useTunnel ? `https://${tunnelHost}` : undefined;

  return {
    plugins: [react(), svgr()],
    define: {
      __SANCTUM__: JSON.stringify(sanctumEnabled && sanctumExists),
    },
    resolve: {
      alias: {
        '@marginalia/sanctum': sanctumEnabled && sanctumExists ? sanctumEntry : sanctumStub,
        '@marginalia/host': path.resolve(uiRoot, 'src'),
        react: path.resolve(uiRoot, 'node_modules/react'),
        'react-dom': path.resolve(uiRoot, 'node_modules/react-dom'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: true,
      port: 3000,
      strictPort: true,
      open: true,
      fs: {
        allow: [uiRoot, ...(sanctumEnabled && sanctumExists ? [sanctumRoot] : [])],
      },
      allowedHosts: useTunnel ? ['localhost', tunnelHost] : true,
      ...(useTunnel
        ? {
          origin: tunnelOrigin,
          hmr: {
            protocol: 'wss',
            host: tunnelHost,
            clientPort: 443,
          },
        }
        : {}),
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
