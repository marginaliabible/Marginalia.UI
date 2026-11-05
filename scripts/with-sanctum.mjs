import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VITE_SANCTUM = '1';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/with-sanctum.mjs <command> [...args]');
  process.exit(1);
}

const [command, ...commandArgs] = args;
const child = spawn('npm', ['run', command, '--', ...commandArgs], {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
