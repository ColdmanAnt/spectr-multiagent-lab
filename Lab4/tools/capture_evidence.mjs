import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { createSimulation, SCENARIOS, metricDefinitions } from '../dist/engine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'results');
// Do not certify stale or missing experiments merely because the current tests pass.
// Every saved run must reproduce with this engine before any evidence is replaced.
const experimentFile = 'reliability/experiment.json';
const experiment = JSON.parse(await readFile(resolve(out, experimentFile), 'utf8'));
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const expectedRuns = seeds.length * SCENARIOS.length * 2 * 2 * 2;
const configKeys = ['seed', 'allocation', 'negotiation', 'protection', 'scenario', 'horizon'];
const keyOf = (row) => JSON.stringify(configKeys.map((key) => row[key]));
const invalid = (reason) => { throw new Error(`Серия экспериментов не подтверждена: ${reason}. Повторите node experiments.mjs --seeds 20 --scenario all --horizon 180 --compare-protection --out results/reliability`); };
for (const [key, value] of Object.entries({ seeds: 20, scenario: 'all', horizon: 180, compare: true, unprotected: false })) {
  if (experiment.options?.[key] !== value) invalid(`неверная настройка ${key}`);
}
if (!Array.isArray(experiment.rows) || experiment.rows.length !== expectedRuns) invalid(`ожидается ${expectedRuns} прогонов`);
const byConfig = new Map(experiment.rows.map((row) => [keyOf(row), row]));
if (byConfig.size !== expectedRuns) invalid('обнаружены повторяющиеся конфигурации');
for (const scenario of SCENARIOS) for (const seed of seeds) {
  for (const allocation of ['central', 'contract']) for (const negotiation of [false, true]) for (const protection of [false, true]) {
    const config = { seed, allocation, negotiation, protection, scenario: scenario.id, horizon: 180 };
    const row = byConfig.get(keyOf(config));
    if (!row) invalid(`отсутствует конфигурация ${keyOf(config)}`);
    const actual = { ...config, ...createSimulation(config).run().metrics };
    if (!isDeepStrictEqual(row, actual)) invalid(`результат отличается от движка: ${keyOf(config)}`);
  }
}
const metricKeys = Object.keys(experiment.rows[0]).filter((key) => !configKeys.includes(key));
const groups = new Map();
for (const row of experiment.rows) {
  const key = JSON.stringify([row.scenario, row.allocation, row.negotiation, row.protection]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
const expectedSummary = [...groups.values()].map((group) => {
  const { scenario, allocation, negotiation, protection } = group[0];
  const record = { scenario, allocation, negotiation, protection, runs: group.length };
  for (const key of metricKeys) {
    const mean = group.reduce((sum, row) => sum + row[key], 0) / group.length;
    record[`${key}_mean`] = mean;
    record[`${key}_sd`] = Math.sqrt(group.reduce((sum, row) => sum + (row[key] - mean) ** 2, 0) / (group.length - 1));
  }
  return record;
});
if (!isDeepStrictEqual(experiment.summary, expectedSummary)) invalid('сводка не соответствует отдельным прогонам');
const csv = (records) => {
  const keys = [...new Set(records.flatMap(Object.keys))];
  return '\ufeff' + [keys.join(','), ...records.map((row) => keys.map((key) => String(row[key])).join(','))].join('\r\n') + '\r\n';
};
for (const [file, records] of [['runs.csv', experiment.rows], ['summary.csv', experiment.summary]]) {
  if (await readFile(resolve(out, 'reliability', file), 'utf8') !== csv(records)) invalid(`${file} не соответствует experiment.json`);
}
await mkdir(resolve(out, 'traces'), { recursive: true });
const hashes = {};
for (const name of ['dist/engine.js', 'experiments.mjs', 'tools/capture_evidence.mjs', 'results/reliability/experiment.json', 'results/reliability/runs.csv', 'results/reliability/summary.csv']) {
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
  experiment: { file: experimentFile, seeds, horizon: 180, scenarios: SCENARIOS.map(s => s.id), runs: experiment.rows.length, verifiedAgainstEngine: true },
  metricDefinitions: metricDefinitions(), traces,
};
await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Сохранены ${traces.length} трасс, manifest.json и вывод тестов. Код тестов: ${test.status}`);
if (test.status !== 0) process.exitCode = 1;
