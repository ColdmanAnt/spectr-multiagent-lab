import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, runExperiment, SCENARIOS } from '../dist/engine.js';

test('Одинаковые seed и настройки дают одинаковые задачи, события и результаты', () => {
  const config = { seed: 31415, allocation: 'contract', scenario: 'device', negotiation: true };
  const a = createSimulation(config); const b = createSimulation(config);
  assert.deepEqual(a.run(), b.run());
  assert.deepEqual(a.exportTrace(), b.exportTrace());
  assert.notDeepEqual(a.exportTrace().initialTasks, createSimulation({ ...config, seed: 31416 }).exportTrace().initialTasks);
});

test('Выданный снимок состояния не позволяет изменить внутреннее состояние', () => {
  const sim = createSimulation(); const view = sim.getState();
  view.tasks[0].status = 'completed'; view.groups[0].credits = 0; view.config.seed = 999;
  const actual = sim.getState();
  assert.equal(actual.tasks[0].status, 'pending'); assert.equal(actual.groups[0].credits, 80); assert.equal(actual.config.seed, 42);
});

test('Ресурсные инварианты сохраняются на каждом такте во всех сценариях и режимах', () => {
  for (const scenario of SCENARIOS.map(s => s.id)) for (const allocation of ['central', 'contract']) for (const protection of [false, true]) {
    const sim = createSimulation({ seed: 7, scenario, allocation, protection });
    for (let tick = 0; tick < 180; tick++) {
      const s = sim.step();
      const held = s.equipment.flatMap(e => [...e.queue.filter(id => !id.startsWith('ghost-')), ...(e.taskId ? [e.taskId] : [])]);
      assert.equal(new Set(held).size, held.length, `${scenario}/${allocation}/${protection}: задача заняла два ресурса на такте ${s.tick}`);
      const transporting = s.robots.map(r => r.taskId).filter(Boolean);
      assert.equal(new Set(transporting).size, transporting.length);
      assert.equal(s.groups.reduce((n, g) => n + g.credits, 0), 240, 'Переговоры должны сохранять сумму кредитов');
      assert(s.groups.every(g => g.credits >= 0));
      for (const task of s.tasks) {
        if (task.status === 'completed') assert(!held.includes(task.id), 'Завершённая задача не удерживает прибор');
        if (protection) assert(task.acceptedCount <= 1, 'Защита не допускает повторного зачёта');
      }
      assert(s.metrics.validCompleted <= 24); assert(s.metrics.fairness >= 0 && s.metrics.fairness <= 1);
      assert(s.metrics.utilization >= 0 && s.metrics.utilization <= 1);
      assert.equal(s.metrics.messages, s.messages.length);
    }
    assert(sim.getState().done);
  }
});

test('Contract Net содержит явные CFP/BID/AWARD/ACK, центральный режим использует ASSIGN', () => {
  const distributed = createSimulation({ allocation: 'contract' }).run();
  for (const type of ['CFP', 'BID', 'AWARD', 'ACK']) assert(distributed.messages.some(m => m.type === type), `Нет ${type}`);
  const central = createSimulation({ allocation: 'central' }).run();
  assert(central.messages.some(m => m.type === 'ASSIGN'));
  assert(!central.messages.some(m => m.type === 'CFP'));
});

test('Переговоры имеют встречные предложения, принятия, отказы и реальные переводы/перестановки', () => {
  const sim = createSimulation({ allocation: 'contract', negotiation: true }); const s = sim.run();
  for (const type of ['OFFER', 'COUNTER', 'ACCEPT', 'REJECT']) assert(s.messages.some(m => m.type === type), `Нет ${type}`);
  const swaps = sim.exportTrace().events.filter(e => e.type === 'SLOT_SWAP');
  assert.equal(swaps.length, s.metrics.negotiationAccepted); assert(swaps.length > 0);
  assert(s.groups.some(g => g.credits !== 80));
  const baseline = createSimulation({ allocation: 'contract', negotiation: false }).run();
  assert.equal(baseline.metrics.negotiations, 0); assert(baseline.groups.every(g => g.credits === 80));
});

test('Повтор результата без защиты искажает отчётность, с защитой отклоняется', () => {
  const safe = createSimulation({ scenario: 'duplicate', protection: true }).run();
  const unsafe = createSimulation({ scenario: 'duplicate', protection: false }).run();
  assert.equal(safe.metrics.undetected, 0); assert(safe.metrics.prevented > 0);
  assert.equal(safe.metrics.completed, safe.metrics.validCompleted);
  assert(unsafe.metrics.completed > unsafe.metrics.validCompleted);
  assert.equal(unsafe.metrics.violations, 1);
});

test('Каждый отложенный повтор обрабатывается один раз и не создаёт новую инъекцию сбоя', () => {
  for (const protection of [false, true]) {
    const sim = createSimulation({ protection });
    sim.inject('duplicate');
    sim.step(1);
    sim.inject('duplicate');
    const s = sim.run();
    const injections = s.events.filter(e => e.type === 'FAULT_INJECTED');
    const deliveries = s.events.filter(e => e.type === 'DEFERRED_DUPLICATE_APPLIED');
    assert.deepEqual(injections.map(e => [e.faultType, e.tick]), [['duplicate', 0], ['duplicate', 1]]);
    assert.equal(s.faults.length, 2);
    assert.deepEqual(deliveries.map(e => e.injectedTick), [0, 1]);
    assert(deliveries.every(e => e.tick > e.injectedTick));
    assert.deepEqual(s.deferredDuplicates, []);
    if (protection) {
      assert.equal(s.metrics.prevented, 2);
      assert.equal(s.metrics.violations, 0);
      assert.equal(s.metrics.completed, s.metrics.validCompleted);
    } else {
      assert.equal(s.metrics.violations, 2);
      assert.equal(s.metrics.undetected, 2);
      assert.equal(s.metrics.completed - s.metrics.validCompleted, 2);
    }
  }
});

test('Отложенные повторы остаются в трассе, если смена закончилась до первого результата', () => {
  const sim = createSimulation({ horizon: 30 });
  sim.inject('ghost'); sim.inject('ghost'); sim.inject('ghost');
  sim.inject('robot'); sim.inject('robot');
  sim.inject('duplicate'); sim.inject('duplicate');
  const s = sim.run();
  assert.equal(s.metrics.completed, 0);
  assert.deepEqual(s.deferredDuplicates, [0, 0]);
  assert.equal(s.events.filter(e => e.type === 'FAULT_INJECTED' && e.faultType === 'duplicate').length, 2);
  assert(!s.events.some(e => e.type === 'DEFERRED_DUPLICATE_APPLIED'));
  assert.deepEqual(sim.inject('duplicate'), s, 'После конца смены сбой не изменяет состояние');
});

test('Ложное завершение принимается без проверки и отклоняется с проверкой состояния', () => {
  const safe = createSimulation({ scenario: 'misreport', protection: true }).run();
  const unsafe = createSimulation({ scenario: 'misreport', protection: false }).run();
  assert.equal(safe.metrics.badResults, 0); assert(safe.metrics.prevented > 0);
  assert.equal(unsafe.metrics.badResults, 1);
  assert(unsafe.messages.some(m => m.type === 'RESULT' && m.text.includes('без проверки')));
});

test('Просроченная бронь блокирует очередь без защиты и снимается по lease с защитой', () => {
  const safe = createSimulation({ scenario: 'ghost', protection: true }).run();
  const unsafe = createSimulation({ scenario: 'ghost', protection: false }).run();
  assert(safe.messages.some(m => m.type === 'LEASE_EXPIRED'));
  assert(safe.equipment.every(e => !e.ghost)); assert(unsafe.equipment.some(e => e.ghost));
  assert(safe.metrics.validCompleted > unsafe.metrics.validCompleted);
});

test('Повторные ручные брони не оставляют бессрочные lease при включённой защите', () => {
  const sim = createSimulation({ protection: true }); sim.step(20);
  for (let i = 0; i < 12; i++) sim.inject('ghost');
  const busy = sim.getState();
  assert.equal(busy.equipment.flatMap(e => e.queue).filter(id => id.startsWith('ghost-')).length, 3);
  sim.step(9);
  const cleared = sim.getState();
  assert(cleared.equipment.every(e => e.ghost === null));
  assert(!cleared.equipment.flatMap(e => e.queue).some(id => id.startsWith('ghost-')));
});

test('Проверка недостоверного прибора запускает повтор и устраняет ошибочные зачёты', () => {
  const safe = createSimulation({ scenario: 'device', protection: true }).run();
  const unsafe = createSimulation({ scenario: 'device', protection: false }).run();
  assert(safe.tasks.some(t => t.retries > 0)); assert(safe.metrics.recoveries > 0);
  assert.equal(safe.metrics.badResults, 0); assert(unsafe.metrics.badResults > 0);
});

test('Полный перезапуск прерванной работы не наследует недостоверность отменённой попытки', () => {
  const sim = createSimulation({ seed: 1, scenario: 'device', protection: true });
  const stopped = sim.step(37);
  const interrupted = stopped.tasks.find(t => t.id === 'T02');
  assert.equal(interrupted.status, 'queued');
  assert.equal(interrupted.corrupted, true, 'Первая попытка действительно затронута отказом');
  assert.equal(stopped.equipment.find(e => e.id === 'eq2').status, 'offline');
  const restarted = sim.step(36);
  const fresh = restarted.tasks.find(t => t.id === 'T02');
  assert.equal(fresh.status, 'running');
  assert.equal(fresh.startedTick, 73);
  assert.equal(fresh.remaining, fresh.duration);
  assert.equal(fresh.corrupted, false, 'Полное измерение после ремонта начинает новую попытку');
  const s = sim.run();
  const finished = s.tasks.find(t => t.id === 'T02');
  assert.equal(finished.actualValid, true);
  assert.equal(finished.finishedTick, 99);
  assert.equal(finished.retries, 0);
  assert.deepEqual(s.events.filter(e => e.type === 'QUALITY_REJECT').map(e => e.task), ['T01']);
});

test('Отказ робота приводит к переназначению только после проверки heartbeat', () => {
  const safe = createSimulation({ protection: true }); safe.step(4); safe.inject('robot'); const safeEnd = safe.run();
  const unsafe = createSimulation({ protection: false }); unsafe.step(4); unsafe.inject('robot'); const unsafeEnd = unsafe.run();
  assert(safeEnd.messages.some(m => m.type === 'REASSIGN'));
  assert(!unsafeEnd.messages.some(m => m.type === 'REASSIGN'));
  assert(safeEnd.metrics.recoveries > 0);
});

test('Факторный эксперимент использует одинаковый набор seed в четырёх режимах', () => {
  const experiment = runExperiment({ seeds: [11, 12, 13], scenario: 'ghost', horizon: 150 });
  assert.equal(experiment.rows.length, 12); assert.equal(experiment.summary.length, 4);
  for (const row of experiment.summary) assert.equal(row.runs, 3);
  for (const seed of [11, 12, 13]) {
    const rows = experiment.rows.filter(r => r.seed === seed);
    assert.equal(rows.length, 4);
    assert(rows.every(r => r.protection === true && r.scenario === 'ghost' && r.horizon === 150));
    assert.deepEqual(rows.map(r => [r.allocation, r.negotiation]), [['central', false], ['central', true], ['contract', false], ['contract', true]]);
  }
});

test('Метаданные эксперимента содержат эффективные настройки и уникальные нормализованные seed', () => {
  const experiment = runExperiment({ seeds: [-1.7, 4294967295, 1.8, 1, NaN, Infinity], scenario: 'unknown', horizon: 1, protection: 0 });
  assert.deepEqual(experiment.design.pairedSeeds, [4294967295, 1]);
  assert.equal(experiment.rows.length, 8);
  for (const record of [experiment.design, ...experiment.rows, ...experiment.summary]) {
    assert.equal(record.scenario, 'normal');
    assert.equal(record.horizon, 30);
    assert.equal(record.protection, true);
  }
  for (const seed of experiment.design.pairedSeeds) {
    const rows = experiment.rows.filter(r => r.seed === seed);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      const actual = createSimulation(row).run();
      for (const [key, value] of Object.entries(actual.config)) assert.equal(row[key], value);
      for (const [key, value] of Object.entries(actual.metrics)) assert.equal(row[key], value);
    }
  }
  assert(experiment.summary.every(row => row.runs === 2));
  assert.throws(() => runExperiment({ seeds: [] }), /хотя бы одного конечного seed/);
  assert.throws(() => runExperiment({ seeds: [NaN, Infinity] }), /хотя бы одного конечного seed/);
});

test('Трасса содержит исходную нагрузку, все сообщения, события и конечные метрики', () => {
  const sim = createSimulation({ seed: 8, horizon: 45 }); sim.run(); const trace = sim.exportTrace();
  assert.equal(trace.initialTasks.length, 24);
  assert(trace.initialTasks.every(t => t.status === 'pending'));
  assert.equal(trace.messages.length, trace.finalState.metrics.messages);
  assert(trace.events.some(e => e.type === 'SHIFT_END'));
  assert.doesNotThrow(() => JSON.stringify(trace));
  const before = sim.getState(); assert.deepEqual(sim.step(200), before, 'После конца смены состояние стабильно');
});

test('Трасса сохраняет тип события внедрения отдельно от типа сбоя и фиксирует такт', () => {
  for (const scenario of SCENARIOS.filter(s => s.id !== 'normal')) {
    const sim = createSimulation({ scenario: scenario.id }); sim.run();
    const events = sim.exportTrace().events.filter(e => e.type === 'FAULT_INJECTED');
    assert.equal(events.length, 1, `Неоднозначная трасса сценария ${scenario.id}`);
    assert.equal(events[0].faultType, scenario.id);
    assert.equal(events[0].tick, scenario.id === 'duplicate' ? 55 : 35);
    assert.equal(typeof events[0].description, 'string');
  }
  const manual = createSimulation(); manual.step(4); manual.inject('robot');
  const event = manual.exportTrace().events.find(e => e.type === 'FAULT_INJECTED');
  assert.equal(event.faultType, 'robot'); assert.equal(event.tick, 4);
});
