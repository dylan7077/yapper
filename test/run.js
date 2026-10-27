// Runs every test file in this folder, each in its own process.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const file of readdirSync(dir).filter(f => f.startsWith('test-') && f.endsWith('.js')).sort()) {
  const r = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file}`);
  if (!ok) console.log((r.stderr || r.stdout).split('\n').slice(0, 15).join('\n'));
}
process.exit(failed ? 1 : 0);
