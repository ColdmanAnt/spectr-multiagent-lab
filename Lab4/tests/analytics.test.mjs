import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, SCENARIOS } from '../dist/engine.js';
import { analyseShift, taskHistory } from '../dist/analytics.js';

function fixture() {
  return {
    tick: 10, horizon: 180, done: false, config: { protection: true },
    tasks: [], equipment: [{ id: 'eq1', status: 'idle', taskId: null, queue: [], faulty: false, ghost: null, offlineUntil: 0 }],
    robots: [], groups: [{ id: 'g1', name: 'Изотоп', credits: 80, utility: 0 }], events: []
  };
}
const task = (id, values = {}) => ({ id, group: 'g1', equipment: 'eq1', release: 0, deadline: 40, duration: 6, remaining: 0, status: 'queued', delivered: true, actualValid: null, ...values });
const find = (analysis, id) => analysis.tasks.find(task => task.id === id);

test('Прогноз учитывает остаток измерения, очередь и параллельную проверку', () => {
  const s = fixture();
  s.tasks = [task('T01', { status: 'running', remaining: 4, delivered: true }), task('T02')];
  s.equipment[0].taskId = 'T01'; s.equipment[0].status = 'busy'; s.equipment[0].queue = ['T02'];
  const a = analyseShift(s);
  assert.equal(find(a, 'T01').estimatedFinish, 16);
  assert.equal(find(a, 'T02').estimatedFinish, 22);
  assert.equal(a.equipment[0].finish, 20, 'Проверка не удерживает прибор');
  assert.equal(a.equipment[0].queuedWork, 10);
  s.config.protection = false;
  assert.equal(find(analyseShift(s), 'T02').estimatedFinish, 20);
});

test('Диагностика и фактический остаток доставки задают начало очереди', () => {
  const s = fixture(); s.equipment[0].status = 'offline'; s.equipment[0].offlineUntil = 25;
  s.tasks = [task('T01', { status: 'transport', delivered: false })]; s.equipment[0].queue = ['T01'];
  s.robots = [{ taskId: 'T01', state: 'moving', travelTicks: 20, elapsed: 2 }];
  const a = analyseShift(s);
  assert.equal(find(a, 'T01').estimatedFinish, 36, 'Доставка на28, работа6, проверка2');
  assert.deepEqual(a.equipment[0].segments[0], { task: null, start: 10, end: 25, kind: 'offline' });
  assert.deepEqual(a.equipment[0].segments[1], { task: 'T01', start: 28, end: 34, kind: 'queued' });
});

test('Голова очереди без известной доставки блокирует оценки последующих работ', () => {
  const s = fixture(); s.tasks = [task('T01', { status: 'reserved', delivered: false }), task('T02')]; s.equipment[0].queue = ['T01', 'T02'];
  const a = analyseShift(s);
  assert.equal(find(a, 'T01').risk, 'blocked'); assert.equal(find(a, 'T02').estimatedFinish, null);
  assert.equal(a.equipment[0].finish, null); assert.equal(a.summary.blocked, 2);
  s.tasks[0].status = 'transport'; s.robots = [{ taskId: 'T01', state: 'offline', travelTicks: 4, elapsed: 1 }];
  assert.equal(find(analyseShift(s), 'T01').estimatedFinish, null);
});

test('Бронь-призрак снимается по lease только с включённой защитой', () => {
  const s = fixture(); s.tasks = [task('T01')]; s.equipment[0].queue = ['ghost-1', 'T01']; s.equipment[0].ghost = { id: 'ghost-1', expires: 18 };
  assert.equal(find(analyseShift(s), 'T01').estimatedFinish, 26);
  s.config.protection = false; const a = analyseShift(s);
  assert.equal(find(a, 'T01').estimatedFinish, null); assert.equal(a.equipment[0].blocked, true);
  assert.equal(a.equipment[0].segments[0].end, null);
});

test('Фактические завершения, проверка, сроки и ещё не выпущенные заявки различаются', () => {
  const s = fixture(); s.tasks = [
    task('done', { status: 'completed', actualValid: true, finishedTick: 9, deadline: 5 }),
    task('bad', { status: 'completed', actualValid: false, finishedTick: 8 }),
    task('verify', { status: 'verifying', verifyAt: 12, deadline: 11 }),
    task('tight', { status: 'verifying', verifyAt: 12, deadline: 12 }),
    task('future', { status: 'pending', release: 20 }), task('pending', { status: 'pending', delivered: false })
  ];
  const a = analyseShift(s);
  assert.equal(find(a, 'done').risk, 'completed'); assert.equal(find(a, 'done').slack, -4);
  assert.equal(find(a, 'bad').risk, 'invalid'); assert.equal(find(a, 'verify').risk, 'late');
  assert.equal(find(a, 'tight').risk, 'tight'); assert.equal(find(a, 'future').risk, 'unreleased');
  assert.equal(find(a, 'pending').estimatedFinish, null); assert.equal(find(a, 'pending').risk, 'unplanned');
  assert.deepEqual(a.programs[0], { id: 'g1', name: 'Изотоп', total: 6, completed: 1, active: 3, atRisk: 2, credits: 80, utility: 0 });
});

test('Известный недостоверный результат не превращается в обещание успешного завершения', () => {
  const s = fixture(); s.tasks = [task('T01', { status: 'verifying', verifyAt: 12, corrupted: true }), task('T02')]; s.equipment[0].queue = ['T02'];
  const a = analyseShift(s); assert.equal(find(a, 'T01').estimatedFinish, null); assert.equal(find(a, 'T02').estimatedFinish, null);
  assert.equal(a.equipment[0].blocked, true);
  s.tasks[0].status = 'running'; s.tasks[0].remaining = 4; s.equipment[0].taskId = 'T01';
  assert.equal(find(analyseShift(s), 'T01').risk, 'blocked');
});

test('История использует точные ID, сохраняет порядок событий и не раскрывает изменяемые ссылки', () => {
  const s = fixture(); s.events = [
    { tick: 4, type: 'STARTED', task: 'T01' },
    { tick: 2, type: 'SLOT_SWAP', task: 'T02', displaced: 'T01', meta: { credits: 3 } },
    { tick: 4, type: 'RESULT_ACCEPTED', task: 'T01' },
    { tick: 1, type: 'ASSIGNED', task: 'T010' }
  ];
  const history = taskHistory(s, 'T01');
  assert.deepEqual(history.map(e => e.type), ['SLOT_SWAP', 'STARTED', 'RESULT_ACCEPTED']);
  history[0].meta.credits = 999; assert.equal(s.events[1].meta.credits, 3);
  assert.deepEqual(taskHistory(s, 'missing'), []);
});

test('Аналитика не меняет реальные состояния ни в одном сценарии и учитывает горизонт', () => {
  for (const scenario of SCENARIOS) for (const protection of [false, true]) {
    const sim = createSimulation({ scenario: scenario.id, protection, horizon: 60 });
    for (let i = 0; i <= 60; i++) {
      const s = sim.getState(), original = structuredClone(s); const a = analyseShift(s);
      assert.deepEqual(s, original); assert.equal(a.tasks.length, 24); assert.equal(a.programs.length, 3);
      assert(a.equipment.every(eq => eq.finish === null || Number.isFinite(eq.finish)));
      assert(a.tasks.every(t => t.estimatedFinish === null || Number.isFinite(t.estimatedFinish)));
      assert.equal(a.programs.reduce((sum, p) => sum + p.completed, 0), s.metrics.validCompleted);
      assert.equal(a.summary.active, s.tasks.filter(t => t.release <= s.tick && t.status !== 'completed').length);
      sim.step();
    }
    assert.equal(sim.getState().tick, 60); assert(sim.getState().done);
  }
});

test('Оценённые работы совпадают с последующими завершениями при неизменном порядке очередей', () => {
  // New assignments may append to queues, but negotiation/fault-driven reordering is disabled.
  for (let seed = 1; seed <= 6; seed++) for (const allocation of ['central', 'contract']) for (const protection of [false, true]) for (const tick of [10, 35, 90, 150]) {
    const sim = createSimulation({ seed, allocation, protection, negotiation: false });
    sim.step(tick); const forecast = analyseShift(sim.getState()); const final = sim.run();
    for (const item of forecast.tasks) if (item.estimatedFinish !== null && item.estimatedFinish <= final.horizon) {
      assert.equal(final.tasks.find(task => task.id === item.id).finishedTick, item.estimatedFinish, `${seed}/${allocation}/${protection}/t${tick}/${item.id}`);
    }
  }
});

test('Завершённая смена сохраняет остаток работ и не строит будущих прогнозов', () => {
  const s = fixture(); s.done = true;
  s.tasks = [
    task('running', { status: 'running', remaining: 4, deadline: 9 }),
    task('queued', { deadline: 10 }),
    task('verify', { status: 'verifying', verifyAt: 12, deadline: 20 }),
    task('pending', { status: 'pending', delivered: false, deadline: 8 }),
    task('future', { status: 'pending', delivered: false, release: 20 }),
    task('done', { status: 'completed', actualValid: true, finishedTick: 9 }),
    task('bad', { status: 'completed', actualValid: false, finishedTick: 8 })
  ];
  s.equipment[0].taskId = 'running'; s.equipment[0].status = 'busy'; s.equipment[0].queue = ['queued'];
  s.equipment.push({ id: 'eq2', status: 'idle', taskId: null, queue: [], faulty: false, ghost: null, offlineUntil: 0 });
  const a = analyseShift(s);
  for (const id of ['running', 'queued', 'verify', 'pending']) {
    assert.equal(find(a, id).estimatedFinish, null); assert.equal(find(a, id).slack, null);
    assert.equal(find(a, id).reason, 'Смена завершена; исследование осталось незавершённым');
  }
  assert.equal(find(a, 'running').risk, 'late'); assert.equal(find(a, 'pending').risk, 'late');
  assert.equal(find(a, 'queued').risk, 'blocked'); assert.equal(find(a, 'verify').risk, 'blocked');
  assert.equal(find(a, 'future').risk, 'unreleased');
  assert.equal(find(a, 'done').estimatedFinish, 9); assert.equal(find(a, 'done').risk, 'completed'); assert.equal(find(a, 'bad').risk, 'invalid');
  assert.deepEqual(a.equipment[0], { id: 'eq1', queuedWork: 10, finish: null, blocked: true, segments: [] });
  assert.deepEqual(a.equipment[1], { id: 'eq2', queuedWork: 0, finish: 10, blocked: false, segments: [] });
  const final = createSimulation({ horizon: 30, scenario: 'ghost', protection: false }).run();
  const finalAnalysis = analyseShift(final);
  assert(finalAnalysis.tasks.some(item => item.risk !== 'completed' && item.risk !== 'invalid'));
  for (const task of final.tasks.filter(task => task.status !== 'completed')) assert.equal(find(finalAnalysis, task.id).estimatedFinish, null);
  assert(finalAnalysis.equipment.every(eq => eq.segments.length === 0 && (eq.finish === null || eq.finish === final.tick)));
});
