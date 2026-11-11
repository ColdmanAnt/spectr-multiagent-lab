import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createSimulation, SCENARIOS } from './dist/engine.js';

const LAB = 1;
const root = dirname(fileURLToPath(import.meta.url));
const usage = `СПЕКТР — лабораторная работа ${LAB}

node main.mjs demo${LAB > 1 ? ' [--allocation central|contract]' : ''} [--seed 1]${LAB >= 3 ? ' [--no-negotiation]' : ''}${LAB === 4 ? ' [--scenario normal|device|ghost|duplicate|misreport] [--no-protection]' : ''}
${LAB === 1 ? '' : `node main.mjs experiment${LAB < 4 ? ' [--seeds 20]' : ''}\n`}node server.mjs

Пути результатов вычисляются относительно main.mjs, независимо от текущей папки.
${LAB === 1 ? 'Работа 1 демонстрирует архитектуру; сравнения механизмов находятся в работах 2–4.' : LAB === 2 ? 'Эксперимент: два распределения, переговоры выключены, защита включена.' : LAB === 3 ? 'Эксперимент: два распределения × переговоры выключены/включены, защита включена.' : 'Эксперимент: 20 seed × пять сценариев × два распределения × два режима переговоров × два режима защиты.'}
`;
function fail(message) { console.error(`${message}\n${usage}`); process.exit(1); }
const args = process.argv.slice(2);
if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(usage); process.exit(0); }
const command = args.shift();
if (!['demo', 'experiment'].includes(command)) fail(`Неизвестная команда: ${command}`);
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0); }
if (command === 'experiment') {
  if (LAB === 1) fail('В работе 1 нет факторного эксперимента; используйте demo.');
  let seeds = 20;
  if (LAB < 4 && args.length === 2 && args[0] === '--seeds') {
    seeds = Number(args[1]);
    if (!/^\d+$/.test(args[1]) || !Number.isInteger(seeds) || seeds < 1 || seeds > 100) fail('seeds должен быть целым числом от 1 до 100.');
  } else if (args.length) fail('Недопустимые параметры эксперимента.');
  const jobs = LAB === 4 ? [
    ['experiments.mjs', '--seeds', '20', '--scenario', 'all', '--horizon', '180', '--compare-protection', '--out', resolve(root, 'results/reliability')],
    ['tools/capture_evidence.mjs'],
  ] : [['experiments.mjs', '--seeds', String(seeds)]];
  for (const job of jobs) {
    const child = spawnSync(process.execPath, job, { cwd: root, stdio: 'inherit' });
    if (child.error) { console.error(child.error.message); process.exit(1); }
    if (child.status !== 0) process.exit(child.status || 1);
  }
  process.exit(0);
}
const config = { seed: 1, allocation: 'central', negotiation: LAB >= 3, protection: true, scenario: LAB === 4 ? 'device' : 'normal', horizon: 180 };
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (seen.has(flag)) fail(`Повтор параметра: ${flag}`);
  seen.add(flag);
  if (flag === '--no-negotiation' && LAB >= 3) { config.negotiation = false; continue; }
  if (flag === '--no-protection' && LAB === 4) { config.protection = false; continue; }
  const key = flag === '--seed' ? 'seed' : flag === '--allocation' && LAB > 1 ? 'allocation' : flag === '--scenario' && LAB === 4 ? 'scenario' : null;
  if (!key || args[i + 1] === undefined || args[i + 1].startsWith('--')) fail(`Неизвестный параметр или нет значения: ${flag}`);
  const value = args[++i];
  if (key === 'seed') {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(number) || number < 1 || number > 4294967295) fail('seed должен быть целым числом от 1 до 4294967295.');
    config.seed = number;
  } else if (key === 'allocation') {
    if (!['central', 'contract'].includes(value)) fail('allocation: central или contract.');
    config.allocation = value;
  } else {
    if (!SCENARIOS.some(scenario => scenario.id === value)) fail('Неизвестный сценарий.');
    config.scenario = value;
  }
}
const simulation = createSimulation(config);
const state = simulation.run();
const name = LAB === 1 ? 'architecture-demo.json' : LAB === 2
  ? `traces/normal-${config.allocation}-no-negotiation.json`
  : LAB === 3 ? `traces/normal-${config.allocation}-${config.negotiation ? 'negotiation' : 'no-negotiation'}.json`
  : `traces/${config.scenario}-${config.protection ? 'protected' : 'unprotected'}.json`;
const output = resolve(root, 'results', name);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(simulation.exportTrace(), null, 2));
console.log(`ЛР${LAB}: ${config.allocation}, seed ${config.seed}, ${config.scenario}; переговоры ${config.negotiation ? 'вкл.' : 'выкл.'}, защита ${config.protection ? 'вкл.' : 'выкл.'}`);
console.table(state.metrics);
console.log(`Полная трасса: ${output}`);
