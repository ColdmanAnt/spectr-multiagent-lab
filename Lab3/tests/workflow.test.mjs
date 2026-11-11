import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LAB = 3;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function isolated(t) {
  const sandbox = await mkdtemp(join(tmpdir(), `spectr-lab${LAB}-`));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const folder = join(sandbox, 'lab');
  const files = ['main.mjs', 'package.json', 'dist/engine.js'];
  if (LAB > 1) files.push('experiments.mjs');
  if (LAB === 4) files.push('tools/capture_evidence.mjs', 'tests/engine.test.mjs');
  for (const file of files) {
    const target = join(folder, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  return { folder, outside: sandbox };
}
function run(folder, cwd, ...args) {
  return spawnSync(process.execPath, [join(folder, 'main.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 25000 });
}
function succeeded(result) { assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error)); }

test('Демонстрация запускается из чужой папки без соседних лабораторных', async t => {
  const { folder, outside } = await isolated(t);
  const result = run(folder, outside, 'demo'); succeeded(result);
  const relative = LAB === 1 ? 'architecture-demo.json' : `demo/${LAB === 4 ? 'device' : 'normal'}-central-seed1-neg${LAB >= 3 ? 'on' : 'off'}-protected.json`;
  const trace = JSON.parse(await readFile(join(folder, 'results', relative), 'utf8'));
  assert.equal(trace.config.seed, 1);
  assert.equal(trace.config.negotiation, LAB >= 3);
  assert.equal(trace.config.protection, true);
  assert.equal(trace.config.scenario, LAB === 4 ? 'device' : 'normal');
  assert.equal(trace.finalState.tick, 180);
  assert.ok(trace.messages.length > 0 && trace.events.length > 0);
  await assert.rejects(stat(join(outside, 'results')), { code: 'ENOENT' });
});

test('CLI отклоняет неизвестные, повторяющиеся и недопустимые параметры', async t => {
  const { folder, outside } = await isolated(t);
  const cases = [['unknown'], ['demo', '--unknown'], ['demo', '--seed'], ['demo', '--seed', '0'], ['demo', '--seed', '-1'], ['demo', '--seed', '1.5'], ['demo', '--seed', 'NaN'], ['demo', '--seed', '4294967296'], ['demo', '--seed', '1', '--seed', '2']];
  if (LAB > 1) cases.push(['demo', '--allocation', 'invalid']);
  else cases.push(['demo', '--allocation', 'central'], ['experiment']);
  if (LAB < 3) cases.push(['demo', '--no-negotiation']);
  if (LAB < 4) cases.push(['demo', '--no-protection']);
  else cases.push(['demo', '--scenario', 'invalid'], ['experiment', '--seeds', '2']);
  for (const args of cases) {
    const result = run(folder, outside, ...args);
    assert.equal(result.status, 1, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  }
});

if (LAB > 1) test('Демонстрация с другим seed не изменяет формальные трассы исследования', async t => {
  const { folder, outside } = await isolated(t);
  const name = LAB === 2 ? 'normal-central-no-negotiation.json' : LAB === 3 ? 'normal-central-negotiation.json' : 'device-protected.json';
  const canonical = join(folder, 'results/traces', name);
  await mkdir(dirname(canonical), { recursive: true });
  const original = Buffer.from('canonical research trace must remain unchanged\n');
  await writeFile(canonical, original);
  succeeded(run(folder, outside, 'demo', '--seed', '7'));
  assert.deepEqual(await readFile(canonical), original);
  assert.deepEqual(await readdir(dirname(canonical)), [name]);
  const demo = join(folder, `results/demo/${LAB === 4 ? 'device' : 'normal'}-central-seed7-neg${LAB >= 3 ? 'on' : 'off'}-protected.json`);
  assert.equal(JSON.parse(await readFile(demo, 'utf8')).config.seed, 7);
});

if (LAB === 2 || LAB === 3) test('Эксперимент сохраняет собственный факторный план и CSV вне cwd', async t => {
  const { folder, outside } = await isolated(t);
  succeeded(run(folder, outside, 'experiment', '--seeds', '1'));
  const data = JSON.parse(await readFile(join(folder, 'results/reliability/experiment.json'), 'utf8'));
  assert.equal(data.rows.length, LAB === 2 ? 2 : 4);
  assert.deepEqual([...new Set(data.rows.map(row => row.allocation))].sort(), ['central', 'contract']);
  assert.deepEqual([...new Set(data.rows.map(row => row.negotiation))].sort(), LAB === 2 ? [false] : [false, true]);
  assert.ok(data.rows.every(row => row.seed === 1 && row.protection && row.scenario === 'normal'));
  assert.match(data.engineSHA256, /^[a-f0-9]{64}$/);
  const traces = await readdir(join(folder, 'results/traces'));
  assert.equal(traces.length, LAB === 2 ? 2 : 4);
  for (const file of traces) { const trace = JSON.parse(await readFile(join(folder, 'results/traces', file), 'utf8')); assert.equal(trace.config.seed, 1); assert.equal(trace.finalState.tick, 180); }
  for (const name of ['runs.csv', 'summary.csv']) {
    const text = await readFile(join(folder, 'results/reliability', name), 'utf8');
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.equal(text.trim().split(/\r?\n/).length, data.rows.length + 1);
  }
  for (const seed of ['0', '101', '-1', '1.5', 'Infinity']) assert.equal(run(folder, outside, 'experiment', '--seeds', seed).status, 1);
});

if (LAB === 4) test('Полная серия и 12 трасс воспроизводятся в изолированной папке Lab4', async t => {
  const { folder, outside } = await isolated(t);
  succeeded(run(folder, outside, 'experiment'));
  const data = JSON.parse(await readFile(join(folder, 'results/reliability/experiment.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(folder, 'results/manifest.json'), 'utf8'));
  assert.equal(data.rows.length, 800);
  assert.equal(manifest.experiment.verifiedAgainstEngine, true);
  assert.equal(manifest.traces.length, 12);
  assert.equal(manifest.testsExitCode, 0);
  assert.equal(data.options.out, 'results/reliability');
  for (const trace of manifest.traces) assert.ok((await stat(join(folder, 'results', trace.file))).size > 0);
});
