import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB, resolveLabConfig, runLabBatch } from '../dist/lab-config.js';
import { createSimulation } from '../dist/engine.js';

const expected = {
  1: { allocation: 'central', negotiation: false, protection: true, scenario: 'normal' },
  2: { allocation: 'central', negotiation: false, protection: true, scenario: 'normal' },
  3: { allocation: 'central', negotiation: true, protection: true, scenario: 'normal' },
  4: { allocation: 'central', negotiation: true, protection: true, scenario: 'device' },
};

test('Профиль сохраняет условия именно этой лабораторной работы', () => {
  const config = resolveLabConfig();
  assert.deepEqual(Object.fromEntries(Object.keys(expected[LAB.number]).map(key => [key, config[key]])), expected[LAB.number]);
  assert.equal(config.seed, 1);
  assert.equal(config.horizon, 180);
  const supplied = { seed: 17, allocation: 'contract', scenario: 'misreport', negotiation: false, protection: false, horizon: 2000 };
  const changed = resolveLabConfig(supplied);
  for (const key of ['allocation', 'scenario', 'negotiation', 'protection']) {
    assert.equal(changed[key], LAB.controls[key] ? supplied[key] : LAB.defaults[key], key);
  }
  assert.equal(changed.seed, 17);
  assert.equal(changed.horizon, 180);
  for (const seed of [0, -1, 1.5, Infinity, NaN, 4294967296]) assert.equal(resolveLabConfig({ seed }).seed, 1);
});

test('Каждый готовый режим соблюдает фиксированные условия работы', () => {
  assert.equal(new Set(LAB.presets.map(preset => preset.id)).size, LAB.presets.length);
  assert.ok(LAB.tabs.includes(LAB.focusTab));
  assert.ok(LAB.tabs.includes('overview'));
  for (const preset of LAB.presets) {
    const config = resolveLabConfig({ ...LAB.defaults, ...preset.config, seed: 9 });
    assert.equal(config.seed, 9);
    for (const key of ['allocation', 'scenario', 'negotiation', 'protection']) {
      if (!LAB.controls[key]) assert.equal(config[key], LAB.defaults[key], `${preset.id}/${key}`);
    }
  }
  assert.equal(LAB.controls.faults, LAB.number === 4);
  assert.equal(LAB.tabs.includes('experiments'), LAB.number !== 1);
});

test('Серия интерфейса содержит только сравниваемые в этой работе режимы', () => {
  if (LAB.number === 1) {
    assert.throws(() => runLabBatch(), /демонстрация архитектуры/);
    return;
  }
  const result = runLabBatch({ seeds: 2, scenario: 'device' });
  assert.equal(result.lab, LAB.number);
  assert.equal(result.rows.length, LAB.batch.configurations * 2);
  assert.equal(result.summary.length, LAB.batch.configurations);
  assert.ok(result.summary.every(row => row.runs === 2));
  assert.equal(new Set(result.rows.map(row => [row.seed, row.allocation, row.negotiation, row.protection].join('/'))).size, result.rows.length);
  for (const row of result.rows) {
    assert.equal(row.scenario, LAB.number === 4 ? 'device' : 'normal');
    assert.equal(row.horizon, 180);
    if (LAB.number === 2) assert.equal(row.negotiation, false);
    if (LAB.number < 4) assert.equal(row.protection, true);
    assert.deepEqual(Object.fromEntries(Object.keys(createSimulation(row).run().metrics).map(key => [key, row[key]])), createSimulation(row).run().metrics);
  }
  const initial = result.rows.filter(row => row.seed === 1).map(row => createSimulation(row).exportTrace().initialTasks);
  for (const workload of initial) assert.deepEqual(workload, initial[0]);
});
