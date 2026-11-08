import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSimulation, SCENARIOS, metricDefinitions } from '../dist/engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'results');
await mkdir(resolve(out, 'traces'), { recursive: true });
const hashes = {};
for (const name of ['dist/engine.js', 'experiments.mjs']) {
  hashes[name] = createHash('sha256').update(await readFile(resolve(root, name))).digest('hex');
}
const traces = [];
for (const scenario of SCENARIOS) for (const protection of [false, true]) {
  const config = { seed: 1, allocation: 'central', negotiation: true, protection, scenario: scenario.id, horizon: 180 };
  const sim = createSimulation(config); sim.run();
  const file = `traces/${scenario.id}-${protection ? 'protected' : 'unprotected'}.json`;
  await writeFile(resolve(out, file), JSON.stringify(sim.exportTrace(), null, 2));
  traces.push({ file, config });
}
for (const allocation of ['central', 'contract']) {
  const config = { seed: 1, allocation, negotiation: false, protection: true, scenario: 'normal', horizon: 180 };
  const sim = createSimulation(config); sim.run();
  const file = `traces/normal-${allocation}-no-negotiation.json`;
  await writeFile(resolve(out, file), JSON.stringify(sim.exportTrace(), null, 2));
  traces.push({ file, config });
}
const test = spawnSync(process.execPath, ['--test', 'tests/engine.test.mjs'], { cwd: root, encoding: 'utf8' });
await writeFile(resolve(out, 'test-output.txt'), (test.stdout || '') + (test.stderr || ''));
const manifest = {
  model: 'spectr-discrete-fictional-laboratory', capturedAt: new Date().toISOString(),
  node: process.version, hashes, testsExitCode: test.status,
  experiment: { file: 'reliability/experiment.json', seeds: Array.from({ length: 20 }, (_, i) => i + 1), horizon: 180, scenarios: SCENARIOS.map(s => s.id), runs: 800 },
  metricDefinitions: metricDefinitions(), traces,
};
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Сохранены ${traces.length} трасс, manifest.json и вывод тестов. Код тестов: ${test.status}`);
if (test.status !== 0) process.exitCode = 1;
