import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';

const uiRoot = path.dirname(fileURLToPath(import.meta.url));
const sanctumRoot = path.resolve(uiRoot, '../Marginalia.UI.Sanctum');
const helpRoot = path.resolve(uiRoot, '../Marginalia.Help');
const sanctumEntry = path.join(sanctumRoot, 'src/index.ts');
const sanctumStub = path.resolve(uiRoot, 'src/sanctum/stub.ts');

function isSanctumFlagOn(value: string | undefined): boolean {
  return ['1', 'true', 'yes'].includes(String(value || '').trim().toLowerCase());
}

const HELP_CONTENT_HOT_EVENT = 'marginalia-help:update';

function isPathInsideHelpRoot(file: string): boolean {
  // Windows drive-letter casing differs between Node resolve and chokidar events.
  const root = path.resolve(helpRoot).toLowerCase();
  const candidate = path.resolve(file).toLowerCase();
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isIgnoredHelpWatchPath(file: string): boolean {
  const relative = path.relative(helpRoot, file).replace(/\\/g, '/').toLowerCase();
  return relative === '.git' || relative.startsWith('.git/');
}

/** Dev-only: serve sibling Marginalia.Help at /help-content/ and notify the client on changes. */
function helpContentDevServerPlugin(): Plugin {
  const prefix = '/help-content/';

  return {
    name: 'marginalia-help-content-dev',
    configureServer(server) {
      if (!fs.existsSync(helpRoot)) {
        return;
      }

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const notifyHelpClients = (file?: string) => {
        if (file && (!isPathInsideHelpRoot(file) || isIgnoredHelpWatchPath(file))) {
          return;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          const relative = file ? path.relative(helpRoot, file) : '';
          console.log(`[help-content] changed${relative ? `: ${relative}` : ''} — notifying clients`);
          server.ws.send({
            type: 'custom',
            event: HELP_CONTENT_HOT_EVENT,
            data: { file: file ?? null },
          });
        }, 50);
      };

      // Vite's watcher often misses files outside the project root on Windows.
      // Node's recursive fs.watch is reliable here for the sibling Help repo.
      try {
        const watcher = fs.watch(helpRoot, { recursive: true }, (_eventType, filename) => {
          if (!filename) {
            return;
          }
          const absolute = path.join(helpRoot, filename);
          if (isIgnoredHelpWatchPath(absolute)) {
            return;
          }
          notifyHelpClients(absolute);
        });
        watcher.on('error', (error) => {
          console.warn('[help-content] watch error', error);
        });
      } catch (error) {
        console.warn('[help-content] recursive watch unavailable; falling back to Vite watcher', error);
        server.watcher.add([
          path.join(helpRoot, '**/*.md'),
          path.join(helpRoot, '**/*.json'),
        ]);
        server.watcher.on('change', notifyHelpClients);
        server.watcher.on('add', notifyHelpClients);
        server.watcher.on('unlink', notifyHelpClients);
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(prefix)) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(url.slice(prefix.length));
        const absolutePath = path.resolve(helpRoot, relativePath);
        if (!isPathInsideHelpRoot(absolutePath) || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const ext = path.extname(absolutePath).toLowerCase();
        const type = ext === '.json'
          ? 'application/json; charset=utf-8'
          : ext === '.md'
            ? 'text/markdown; charset=utf-8'
            : 'text/plain; charset=utf-8';
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-store');
        fs.createReadStream(absolutePath).pipe(res);
      });
    },
  };
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
    plugins: [react(), svgr(), helpContentDevServerPlugin()],
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
        allow: [
          uiRoot,
          helpRoot,
          ...(sanctumEnabled && sanctumExists ? [sanctumRoot] : []),
        ],
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
