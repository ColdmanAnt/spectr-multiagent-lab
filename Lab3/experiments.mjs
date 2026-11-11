import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulation } from './dist/engine.js';

const LAB = 3;
const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const usage = `ЛР${LAB}: node experiments.mjs [--seeds 20]\nШтатная смена, горизонт 180, защита включена. Результаты: results/reliability/.`;
if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage); process.exit(0); }
let seeds = 20;
if (args.length) {
  if (args.length !== 2 || args[0] !== '--seeds' || !/^\d+$/.test(args[1])) { console.error(usage); process.exit(1); }
  seeds = Number(args[1]);
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 100) { console.error('seeds: целое число от 1 до 100.'); process.exit(1); }
}
const rows = [];
for (let seed = 1; seed <= seeds; seed++) for (const allocation of ['central', 'contract']) for (const negotiation of LAB === 2 ? [false] : [false, true]) {
  const config = { seed, allocation, negotiation, protection: true, scenario: 'normal', horizon: 180 };
  rows.push({ ...config, ...createSimulation(config).run().metrics });
}
const configurationKeys = new Set(['seed', 'allocation', 'negotiation', 'protection', 'scenario', 'horizon']);
const metricKeys = Object.keys(rows[0]).filter(key => !configurationKeys.has(key));
const grouped = new Map();
for (const row of rows) {
  const key = JSON.stringify([row.allocation, row.negotiation]);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}
const summary = [...grouped.values()].map(group => {
  const { allocation, negotiation, protection, scenario } = group[0];
  const record = { scenario, allocation, negotiation, protection, runs: group.length };
  for (const key of metricKeys) {
    const mean = group.reduce((sum, row) => sum + row[key], 0) / group.length;
    record[`${key}_mean`] = mean;
    record[`${key}_sd`] = group.length > 1 ? Math.sqrt(group.reduce((sum, row) => sum + (row[key] - mean) ** 2, 0) / (group.length - 1)) : 0;
  }
  return record;
});
function csv(records) {
  const keys = Object.keys(records[0]);
  return '\ufeff' + [keys.join(','), ...records.map(record => keys.map(key => String(record[key])).join(','))].join('\r\n') + '\r\n';
}
const output = resolve(root, 'results/reliability');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'runs.csv'), csv(rows));
await writeFile(resolve(output, 'summary.csv'), csv(summary));
await writeFile(resolve(output, 'experiment.json'), JSON.stringify({
  engineSHA256: createHash('sha256').update(await readFile(resolve(root, 'dist/engine.js'))).digest('hex'),
  title: LAB === 2 ? 'СПЕКТР: сравнение механизмов распределения' : 'СПЕКТР: сравнение переговоров при дефиците ресурсов',
  options: { seeds, scenario: 'normal', horizon: 180, protection: true, allocations: ['central', 'contract'], negotiations: LAB === 2 ? [false] : [false, true] },
  note: 'Парные нагрузки: одинаковый seed задает одинаковые исходные исследования. Времена и ресурсы условны.',
  rows, summary,
}, null, 2) + '\n');
// Formal explanatory traces use the first seed of the same experiment plan.
const traces = resolve(root, 'results/traces');
await mkdir(traces, { recursive: true });
for (const allocation of ['central', 'contract']) for (const negotiation of LAB === 2 ? [false] : [false, true]) {
  const simulation = createSimulation({ seed: 1, allocation, negotiation, protection: true, scenario: 'normal', horizon: 180 });
  simulation.run();
  const suffix = negotiation ? 'negotiation' : 'no-negotiation';
  await writeFile(resolve(traces, `normal-${allocation}-${suffix}.json`), JSON.stringify(simulation.exportTrace(), null, 2));
}
console.log(`ЛР${LAB}: сохранены ${rows.length} прогонов (${seeds} одинаковых seed) в ${output}.`);
console.table(summary.map(row => ({allocation: row.allocation, negotiation: row.negotiation, runs: row.runs, validCompleted: row.validCompleted_mean, utility: row.utility_mean, fairness: row.fairness_mean, messages: row.messages_mean})));
