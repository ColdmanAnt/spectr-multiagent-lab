import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulation } from '../dist/engine.js';

// A completion-time measure complements the fixed-horizon completion counts.
// It is conditional on a valid completion; unfinished tasks are counted separately.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
const shared = { scenario: 'normal', negotiation: false, protection: true, horizon: 180 };
const rows = [];
for (const allocation of ['central', 'contract']) for (const seed of seeds) {
  const state = createSimulation({ ...shared, allocation, seed }).run();
  const completed = state.tasks.filter(task => task.status === 'completed' && task.actualValid);
  rows.push({
    seed, allocation, completed: completed.length,
    unfinished: state.tasks.length - completed.length,
    meanCompletionTime: completed.length
      ? completed.reduce((sum, task) => sum + task.finishedTick - task.release, 0) / completed.length
      : null,
  });
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const summary = ['central', 'contract'].map(allocation => {
  const group = rows.filter(row => row.allocation === allocation);
  const values = group.map(row => row.meanCompletionTime).filter(Number.isFinite);
  const average = mean(values);
  return {
    allocation, runs: group.length, runsWithCompletion: values.length,
    completedMean: mean(group.map(row => row.completed)),
    unfinishedMean: mean(group.map(row => row.unfinished)),
    meanCompletionTimeMean: values.length ? average : null,
    meanCompletionTimeSD: values.length > 1
      ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
      : null,
  };
});
const result = {
  schemaVersion: 1,
  engineSHA256: createHash('sha256').update(await readFile(resolve(root, 'dist/engine.js'))).digest('hex'),
  config: { ...shared, seeds, allocations: ['central', 'contract'] },
  definitions: {
    meanCompletionTime: 'В каждом прогоне: среднее finishedTick − release среди уникальных достоверно завершенных задач. В сводке: среднее этих значений и выборочное SD по 20 прогонам.',
    unfinished: 'Число задач без достоверного завершения к такту 180; в условное среднее времени не включаются.',
    interpretation: 'Время относится только к завершенным задачам. Сравнивать вместе с completed и unfinished: разные механизмы завершают разные подмножества задач.',
  },
  rows, summary,
};
const path = resolve(root, 'results/coordination-times.json');
await writeFile(path, JSON.stringify(result, null, 2) + '\n');
console.log(`Сохранены ${rows.length} прогонов времени завершения: ${path}`);
console.table(summary);
