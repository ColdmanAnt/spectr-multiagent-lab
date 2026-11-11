import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSimulation, runExperiment, SCENARIOS } from './dist/engine.js';

const usage = `СПЕКТР — пакетные воспроизводимые эксперименты

node experiments.mjs [--seeds 12] [--scenario normal|device|ghost|duplicate|misreport|all]
                     [--horizon 180] [--compare-protection | --no-protection] [--out results]

По умолчанию сравниваются central/contract × переговоры выкл./вкл. с защитой.
--compare-protection добавляет те же прогоны без защиты с теми же seed.
--no-protection оставляет только прогоны без защиты.
Сохраняются runs.csv, summary.csv и experiment.json; существующие файлы заменяются.
`;
const argv = process.argv.slice(2);
const options = { seeds: 12, scenario: 'normal', horizon: 180, out: 'results', compare: false, unprotected: false };
const allowedScenarios = new Set(SCENARIOS.map((scenario) => scenario.id));
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--help' || arg === '-h') { console.log(usage); process.exit(0); }
  if (arg === '--compare-protection') { options.compare = true; continue; }
  if (arg === '--no-protection') { options.unprotected = true; continue; }
  const key = { '--seeds': 'seeds', '--scenario': 'scenario', '--horizon': 'horizon', '--out': 'out' }[arg];
  if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) {
    console.error(`Неизвестный аргумент или нет значения: ${arg}\n${usage}`); process.exit(1);
  }
  options[key] = key === 'seeds' || key === 'horizon' ? Number(argv[++i]) : argv[++i];
}
if (!Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > 100 ||
    !Number.isInteger(options.horizon) || options.horizon < 30 || options.horizon > 2000 ||
    (!allowedScenarios.has(options.scenario) && options.scenario !== 'all') ||
    (options.compare && options.unprotected)) {
  console.error(`Проверьте аргументы: seeds 1–100, horizon 30–2000; режимы защиты взаимоисключающие.\n${usage}`);
  process.exit(1);
}

const started = performance.now();
const scenarios = options.scenario === 'all' ? [...allowedScenarios] : [options.scenario];
const rows = [];
for (const scenario of scenarios) {
  const baseline = runExperiment({ seeds: options.seeds, scenario, horizon: options.horizon }).rows;
  if (!options.unprotected) rows.push(...baseline);
  if (options.compare || options.unprotected) {
    for (const row of baseline) {
      const config = {
        seed: row.seed, allocation: row.allocation, negotiation: row.negotiation,
        protection: false, scenario, horizon: options.horizon,
      };
      const state = createSimulation(config).run();
      rows.push({ ...config, ...state.metrics });
    }
  }
}
const configurationKeys = new Set(['seed', 'allocation', 'negotiation', 'protection', 'scenario', 'horizon']);
const numericKeys = [...new Set(rows.flatMap(Object.keys))].filter((key) =>
  !configurationKeys.has(key) && rows.some((row) => typeof row[key] === 'number'));
const grouped = new Map();
for (const row of rows) {
  const key = JSON.stringify([row.scenario, row.allocation, row.negotiation, row.protection]);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(row);
}
const summary = [...grouped.values()].map((group) => {
  const { scenario, allocation, negotiation, protection } = group[0];
  const result = { scenario, allocation, negotiation, protection, runs: group.length };
  for (const key of numericKeys) {
    const values = group.map((row) => row[key]).filter(Number.isFinite);
    if (!values.length) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    result[`${key}_mean`] = mean;
    result[`${key}_sd`] = values.length < 2 ? 0 : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
  }
  return result;
});
const quote = (value) => {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
function csv(records) {
  const keys = [...new Set(records.flatMap(Object.keys))];
  return '\ufeff' + [keys.map(quote).join(','), ...records.map((row) => keys.map((key) => quote(row[key])).join(','))].join('\r\n') + '\r\n';
}
const out = resolve(options.out);
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'runs.csv'), csv(rows));
await writeFile(resolve(out, 'summary.csv'), csv(summary));
await writeFile(resolve(out, 'experiment.json'), JSON.stringify({
  title: 'СПЕКТР: парное сравнение механизмов',
  createdAt: new Date().toISOString(), options,
  note: 'Условные такты и ресурсы. Результаты относятся к данной модели; это не модель реального ядерного объекта.',
  rows, summary,
}, null, 2));
console.log(`Выполнено ${rows.length} прогонов за ${((performance.now() - started) / 1000).toFixed(2)} с.`);
console.log(`Результаты: ${out}`);
console.table(summary.map(({ scenario, allocation, negotiation, protection, runs, validCompleted_mean, utility_mean, fairness_mean, violations_mean }) => ({
  scenario, allocation, negotiation, protection, runs,
  validCompleted: validCompleted_mean?.toFixed(2), utility: utility_mean?.toFixed(2),
  fairness: fairness_mean?.toFixed(3), violations: violations_mean?.toFixed(2),
})));
