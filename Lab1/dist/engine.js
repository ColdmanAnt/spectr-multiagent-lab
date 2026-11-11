/**
 * «Спектр» — дискретная модель вымышленной лаборатории.
 * Все длительности и ресурсы условны. Здесь нет модели ядерных процессов.
 * Координация, переговоры и проверки реализованы явно, без AI/API.
 */
export const SCENARIOS = [
  { id: 'normal', name: 'Штатная смена', description: 'Конкурирующие заявки трёх научных групп без внешних отказов.' },
  { id: 'device', name: 'Недостоверный прибор', description: 'На такте 35 установка И-02 начинает выдавать недостоверные результаты.' },
  { id: 'ghost', name: 'Бронь-призрак', description: 'На такте 35 агент резервирует установку и не передаёт образец.' },
  { id: 'duplicate', name: 'Повторное сообщение', description: 'На такте 55 повторяется сообщение о завершённом исследовании.' },
  { id: 'misreport', name: 'Ложное завершение', description: 'На такте 35 приходит сообщение о завершении невыполненной заявки.' }
];

export const AGENT_INFO = [
  ...[
    ['g1', 'Группа «Изотоп»', 'Завершить ценные длительные исследования'],
    ['g2', 'Группа «Импульс»', 'Уложиться в короткие сроки исследований'],
    ['g3', 'Группа «Контур»', 'Выполнить максимальную долю собственного плана']
  ].map(([id, name, goal]) => ({ id, name, role: 'Научная группа', goal, knowledge: 'Собственные задачи, бюджет, полученные предложения и подтверждённые брони.', actions: 'Отправить CFP, выбрать предложение, предложить обмен слотами, принять встречное предложение или отказаться.' })),
  ...['eq1', 'eq2', 'eq3'].map((id, i) => ({ id, name: `Установка И-0${i + 1}`, role: 'Агент измерительной установки', goal: 'Обслужить подтверждённые заявки в порядке очереди', knowledge: 'Своя очередь, текущая работа, доступность и технические события.', actions: 'Рассчитать BID, подтвердить бронь ACK, выполнить задание и выдать результат.' })),
  ...['r1', 'r2'].map((id, i) => ({ id, name: `Робот Р-0${i + 1}`, role: 'Агент перевозки', goal: 'Доставить назначенные контейнеры с минимальным собственным путём', knowledge: 'Собственная позиция, состояние, доступные задания и адреса доставки.', actions: 'Предложить оценку доставки, принять задание, перевезти контейнер, подтвердить прибытие.' })),
  { id: 'coordinator', name: 'Диспетчер', role: 'Центральная координация', goal: 'Назначать заявки с ближайшим дедлайном на допустимое оборудование', knowledge: 'Объявленные заявки, очереди и состояние ресурсов.', actions: 'Оценить срок завершения, назначить оборудование, выдать роботу задачу.' },
  { id: 'quality', name: 'Контроль качества', role: 'Проверка результатов и обязательств', goal: 'Не принимать неподтверждённые результаты и освобождать просроченные брони', knowledge: 'События доставки, завершения, уникальные идентификаторы операций и контрольные проверки модели.', actions: 'Проверить результат, отклонить повтор, назначить повторное исследование, снять бронь и переназначить доставку.' }
];

const GROUP_DEFS = [
  { id: 'g1', name: 'Изотоп', color: '#42d6c3', y: 100, goal: 'Ценные исследования', credits: 80 },
  { id: 'g2', name: 'Импульс', color: '#ffb66b', y: 230, goal: 'Срочные исследования', credits: 80 },
  { id: 'g3', name: 'Контур', color: '#b6a0ff', y: 360, goal: 'Выполнение плана', credits: 80 }
];
const EQUIPMENT_DEFS = [
  { id: 'eq1', name: 'И-01 · Спектрометр', x: 580, y: 100 },
  { id: 'eq2', name: 'И-02 · Анализатор', x: 580, y: 230 },
  { id: 'eq3', name: 'И-03 · Сканер', x: 580, y: 360 }
];
const clone = x => structuredClone(x);
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function rng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function workload(seed) {
  const random = rng(seed);
  return Array.from({ length: 24 }, (_, i) => {
    const g = i % 3;
    const release = i < 6 ? 0 : Math.floor(i / 3) * 7 + Math.floor(random() * 4);
    const primary = `eq${1 + (i + Math.floor(i / 3)) % 3}`;
    const compatible = i % 4 === 0 ? [primary, `eq${1 + (Number(primary.at(-1)) % 3)}`] : [primary];
    return {
      id: `T${String(i + 1).padStart(2, '0')}`, group: `g${g + 1}`,
      title: ['Серия спектров', 'Контрольная серия', 'Анализ образца'][g] + ` ${Math.floor(i / 3) + 1}`,
      equipment: primary, compatible, duration: 12 + Math.floor(random() * 13) + (g === 0 ? 4 : 0),
      deadline: release + (g === 1 ? 32 : 44) + Math.floor(random() * 24),
      value: [44, 32, 25][g] + Math.floor(random() * 12), release,
      status: 'pending', robot: null, remaining: 0, assignedTick: null,
      startedTick: null, finishedTick: null, delivered: false, actualValid: null,
      acceptedCount: 0, retries: 0, corrupted: false, negotiatedAt: -100
    };
  });
}

function normaliseConfig(config) {
  return {
    seed: Number.isFinite(Number(config.seed)) ? Math.trunc(Number(config.seed)) >>> 0 : 42,
    allocation: config.allocation === 'contract' ? 'contract' : 'central',
    negotiation: config.negotiation !== false, protection: config.protection !== false,
    scenario: SCENARIOS.some(s => s.id === config.scenario) ? config.scenario : 'normal',
    horizon: clamp(Math.trunc(Number(config.horizon) || 180), 30, 2000)
  };
}

export function createSimulation(options = {}) {
  const config = normaliseConfig(options);
  const initialTasks = workload(config.seed);
  const s = {
    tick: 0, horizon: config.horizon, done: false, config,
    tasks: clone(initialTasks),
    equipment: EQUIPMENT_DEFS.map(e => ({ ...e, status: 'idle', taskId: null, queue: [], faulty: false, offlineUntil: 0, ghost: null, busyTicks: 0 })),
    robots: ['r1', 'r2'].map((id, i) => ({ id, name: `Робот Р-0${i + 1}`, x: 340 + i * 35, y: 415, from: { x: 340 + i * 35, y: 415 }, to: { x: 340 + i * 35, y: 415 }, progress: 0, taskId: null, state: 'idle', path: [], travelTicks: 0, elapsed: 0, failedAt: null })),
    groups: GROUP_DEFS.map(g => ({ ...g, completed: 0, total: 8, utility: 0, wait: 0 })),
    messages: [], events: [], metrics: {}, history: [], faults: [],
    scenarioTriggered: false, recoveries: 0, violations: 0, prevented: 0,
    negotiations: 0, negotiationAccepted: 0, negotiationRejected: 0,
    travelDistance: 0, duplicateAccepted: 0, deferredDuplicates: []
  };
  const byTask = id => s.tasks.find(t => t.id === id);
  const byEq = id => s.equipment.find(e => e.id === id);
  const byGroup = id => s.groups.find(g => g.id === id);
  const resultIds = new Set();
  const emit = (from, to, type, text, level = 'info') => {
    const m = { id: `m${s.messages.length + 1}`, tick: s.tick, from, to, type, text, level };
    s.messages.push(m);
    return m;
  };
  const event = (type, data = {}) => s.events.push({ ...data, tick: s.tick, type });
  emit('coordinator', 'all', 'INIT', `Смена начата: 24 заявки, 3 установки, 2 робота. Seed ${config.seed}.`);

  function calculateMetrics() {
    for (const g of s.groups) {
      const valid = s.tasks.filter(t => t.group === g.id && t.status === 'completed' && t.actualValid);
      g.completed = valid.length;
      g.utility = round(valid.reduce((v, t) => v + t.value * (t.finishedTick <= t.deadline ? 1 : .35) - .18 * Math.max(0, t.startedTick - t.release), 0) + g.credits - 80);
      g.wait = valid.length ? round(valid.reduce((v, t) => v + Math.max(0, t.startedTick - t.release), 0) / valid.length) : 0;
    }
    const completed = s.tasks.filter(t => t.status === 'completed');
    const valid = completed.filter(t => t.actualValid);
    const fractions = s.groups.map(g => g.completed / g.total);
    const sum = fractions.reduce((a, b) => a + b, 0);
    const square = fractions.reduce((a, b) => a + b * b, 0);
    const started = s.tasks.filter(t => t.startedTick !== null);
    s.metrics = {
      completed: s.tasks.reduce((n, t) => n + t.acceptedCount, 0),
      validCompleted: valid.length,
      late: valid.filter(t => t.finishedTick > t.deadline).length,
      onTime: valid.filter(t => t.finishedTick <= t.deadline).length,
      messages: s.messages.length, utility: round(s.groups.reduce((n, g) => n + g.utility, 0)),
      fairness: square ? round(sum * sum / (3 * square), 4) : 0,
      utilization: s.tick ? round(s.equipment.reduce((n, e) => n + e.busyTicks, 0) / (3 * s.tick), 4) : 0,
      meanWait: started.length ? round(started.reduce((n, t) => n + Math.max(0, t.startedTick - t.release), 0) / started.length) : 0,
      recoveries: s.recoveries, violations: s.violations,
      undetected: completed.filter(t => !t.actualValid).length + s.duplicateAccepted,
      badResults: completed.filter(t => !t.actualValid).length,
      prevented: s.prevented, negotiations: s.negotiations,
      negotiationAccepted: s.negotiationAccepted, negotiationRejected: s.negotiationRejected,
      travelDistance: round(s.travelDistance), coordinationCost: s.messages.length,
      completionRate: round(valid.length / s.tasks.length, 4)
    };
    return s.metrics;
  }

  function queueFinish(eq, beforeTaskId = null) {
    let at = s.tick + (eq.status === 'offline' ? Math.max(0, eq.offlineUntil - s.tick) : 0);
    if (eq.taskId) at += byTask(eq.taskId)?.remaining || 0;
    for (const id of eq.queue) {
      if (id === beforeTaskId) break;
      const task = byTask(id);
      at += task ? task.duration : 8;
    }
    return at;
  }

  function eligiblePairs(task) {
    return task.compatible.map(byEq).filter(eq => eq.status !== 'offline' && eq.queue.length < 4)
      .map(eq => ({ eq, finish: queueFinish(eq) + task.duration + 7 }));
  }

  function assign(task, eq) {
    task.equipment = eq.id;
    task.status = 'reserved'; task.assignedTick = s.tick;
    eq.queue.push(task.id);
    event('ASSIGNED', { task: task.id, equipment: eq.id, group: task.group });
  }

  function centralAllocation() {
    const pending = s.tasks.filter(t => t.status === 'pending' && t.release <= s.tick)
      .sort((a, b) => a.deadline - b.deadline || b.value - a.value || a.id.localeCompare(b.id));
    for (const task of pending.slice(0, 2)) {
      emit(task.group, 'coordinator', 'REQUEST', `${task.id}: запрос прибора, срок ${task.deadline}, ценность ${task.value}.`);
      const pairs = eligiblePairs(task).sort((a, b) => a.finish - b.finish || a.eq.id.localeCompare(b.eq.id));
      if (!pairs.length) continue;
      assign(task, pairs[0].eq);
      emit('coordinator', pairs[0].eq.id, 'ASSIGN', `${task.id}: бронь по ближайшему дедлайну, оценка завершения ${pairs[0].finish}.`);
      emit(pairs[0].eq.id, task.group, 'ACK', `${task.id}: бронь подтверждена.`);
    }
  }

  function contractAllocation() {
    if (s.tick % 3 !== 1) return;
    // Each group sees its own work and chooses its own most valuable feasible request.
    const rotation = Math.floor(s.tick / 3) % 3;
    for (let n = 0; n < 3; n++) {
      const g = s.groups[(n + rotation) % 3];
      const task = s.tasks.filter(t => t.group === g.id && t.status === 'pending' && t.release <= s.tick)
        .sort((a, b) => (b.value / b.duration + 16 / Math.max(1, b.deadline - s.tick)) - (a.value / a.duration + 16 / Math.max(1, a.deadline - s.tick)) || a.id.localeCompare(b.id))[0];
      if (!task) continue;
      for (const eqId of task.compatible) emit(g.id, eqId, 'CFP', `${task.id}: нужен слот, длительность ${task.duration}, срок ${task.deadline}.`);
      const bids = eligiblePairs(task);
      for (const bid of bids) emit(bid.eq.id, g.id, 'BID', `${task.id}: могу завершить к такту ${bid.finish}; очередь ${bid.eq.queue.length}.`);
      bids.sort((a, b) => a.finish - b.finish || a.eq.id.localeCompare(b.eq.id));
      if (!bids.length) continue;
      assign(task, bids[0].eq);
      emit(g.id, bids[0].eq.id, 'AWARD', `${task.id}: принимаю предложение до такта ${bids[0].finish}.`);
      emit(bids[0].eq.id, g.id, 'ACK', `${task.id}: договор подтверждён, место в очереди ${bids[0].eq.queue.length}.`);
    }
  }

  function negotiation() {
    if (!config.negotiation || s.tick % 7 !== 0) return;
    for (const eq of s.equipment) {
      if (eq.queue.length < 2) continue;
      for (let i = 1; i < eq.queue.length; i++) {
        const buyerTask = byTask(eq.queue[i]); const sellerTask = byTask(eq.queue[i - 1]);
        if (!buyerTask || !sellerTask || buyerTask.group === sellerTask.group || s.tick - buyerTask.negotiatedAt < 18) continue;
        const startSeller = queueFinish(eq, sellerTask.id);
        const finishBuyer = startSeller + sellerTask.duration + buyerTask.duration;
        if (buyerTask.deadline >= sellerTask.deadline && finishBuyer <= buyerTask.deadline) continue;
        const benefit = sellerTask.duration * .18 + (finishBuyer > buyerTask.deadline && finishBuyer - sellerTask.duration <= buyerTask.deadline ? buyerTask.value * .65 : 0);
        const sellerCost = buyerTask.duration * .18 + (startSeller + sellerTask.duration <= sellerTask.deadline && startSeller + sellerTask.duration + buyerTask.duration > sellerTask.deadline ? sellerTask.value * .65 : 0);
        const buyer = byGroup(buyerTask.group); const seller = byGroup(sellerTask.group);
        buyerTask.negotiatedAt = s.tick; s.negotiations++;
        const offer = Math.max(1, Math.floor(benefit * .35));
        emit(buyer.id, seller.id, 'OFFER', `${buyerTask.id}: уступите слот перед ${sellerTask.id}; предлагаю ${offer} кредитов. Моя выгода ≈${round(benefit)}.`, 'warning');
        const counter = Math.ceil(sellerCost + 1);
        emit(seller.id, buyer.id, 'COUNTER', `Мои потери ≈${round(sellerCost)}. Согласен за ${counter} кредитов.`, 'warning');
        if (counter <= benefit && counter <= buyer.credits) {
          buyer.credits -= counter; seller.credits += counter;
          [eq.queue[i - 1], eq.queue[i]] = [eq.queue[i], eq.queue[i - 1]];
          s.negotiationAccepted++;
          emit(buyer.id, seller.id, 'ACCEPT', `Принимаю ${counter} кредитов: ${buyerTask.id} идёт раньше ${sellerTask.id}.`, 'success');
          event('SLOT_SWAP', { equipment: eq.id, buyer: buyer.id, seller: seller.id, task: buyerTask.id, displaced: sellerTask.id, credits: counter });
        } else {
          s.negotiationRejected++;
          emit(buyer.id, seller.id, 'REJECT', `Отказываюсь: цена ${counter} выше моей выгоды или бюджета. Очередь сохранена.`);
        }
        break; // One bilateral negotiation per installation per round.
      }
    }
  }

  function pathLength(points) { return points.slice(1).reduce((n, p, i) => n + distance(points[i], p), 0); }
  function locate(points, progress) {
    const total = pathLength(points); let rest = total * progress;
    for (let i = 1; i < points.length; i++) {
      const d = distance(points[i - 1], points[i]);
      if (rest <= d) { const p = d ? rest / d : 1; return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * p, y: points[i - 1].y + (points[i].y - points[i - 1].y) * p }; }
      rest -= d;
    }
    return points.at(-1);
  }

  function startTransport() {
    for (const robot of s.robots.filter(r => r.state === 'idle')) {
      const candidates = s.tasks.filter(t => t.status === 'reserved');
      if (!candidates.length) break;
      const scored = candidates.map(t => ({ t, cost: distance(robot, { x: 125, y: byGroup(t.group).y }) + distance({ x: 125, y: byGroup(t.group).y }, byEq(t.equipment)) }));
      scored.sort((a, b) => config.allocation === 'central' ? a.t.assignedTick - b.t.assignedTick || a.t.deadline - b.t.deadline || a.t.id.localeCompare(b.t.id) : a.cost - b.cost || a.t.deadline - b.t.deadline || a.t.id.localeCompare(b.t.id));
      const { t, cost } = scored[0]; const group = byGroup(t.group); const eq = byEq(t.equipment);
      t.status = 'transport'; t.robot = robot.id;
      robot.from = { x: robot.x, y: robot.y }; robot.to = { x: eq.x, y: eq.y };
      robot.path = [robot.from, { x: 340, y: robot.y }, { x: 340, y: group.y }, { x: 125, y: group.y }, { x: 340, y: group.y }, { x: 340, y: eq.y }, robot.to];
      robot.travelTicks = Math.max(4, Math.ceil(pathLength(robot.path) / 115)); robot.elapsed = 0; robot.progress = 0; robot.taskId = t.id; robot.state = 'moving';
      if (config.allocation === 'contract') emit(robot.id, t.group, 'DELIVERY_BID', `${t.id}: беру перевозку, оценка ${robot.travelTicks} тактов, маршрут ${Math.round(cost)} ед.`);
      else emit('coordinator', robot.id, 'TRANSPORT', `${t.id}: доставить контейнер к ${eq.id}.`);
      event('TRANSPORT_STARTED', { task: t.id, robot: robot.id, equipment: eq.id });
    }
  }

  function moveRobots() {
    for (const robot of s.robots) {
      if (robot.state === 'offline') {
        if (config.protection && robot.taskId && s.tick - robot.failedAt >= 5) {
          const t = byTask(robot.taskId);
          if (t && t.status === 'transport') { t.status = 'reserved'; t.robot = null; t.delivered = false; s.recoveries++; emit('quality', 'coordinator', 'REASSIGN', `${t.id}: нет heartbeat от ${robot.id}; перевозка переназначена.`, 'success'); event('REASSIGNED', { task: t.id, robot: robot.id }); }
          robot.taskId = null;
        }
        continue;
      }
      if (robot.state !== 'moving') continue;
      robot.elapsed++; robot.progress = Math.min(1, robot.elapsed / robot.travelTicks);
      Object.assign(robot, locate(robot.path, robot.progress));
      s.travelDistance += pathLength(robot.path) / robot.travelTicks;
      if (robot.progress >= 1) {
        const t = byTask(robot.taskId);
        if (t && t.status === 'transport') { t.status = 'queued'; t.delivered = true; emit(robot.id, t.equipment, 'DELIVERED', `${t.id}: контейнер доставлен, ожидание слота.`); event('DELIVERED', { task: t.id, robot: robot.id }); }
        robot.state = 'idle'; robot.taskId = null;
      }
    }
  }

  function releaseTaskResources(task) {
    for (const eq of s.equipment) {
      eq.queue = eq.queue.filter(id => id !== task.id);
      if (eq.taskId === task.id) { eq.taskId = null; eq.status = 'idle'; }
    }
    for (const r of s.robots) if (r.taskId === task.id) { r.taskId = null; if (r.state !== 'offline') r.state = 'idle'; }
    task.robot = null;
  }

  function acceptResult(task, { forged = false, duplicate = false } = {}) {
    const operation = `RESULT:${task.id}`;
    if (config.protection && (resultIds.has(operation) || forged || task.status !== 'verifying')) {
      s.prevented++;
      emit('quality', task.group, 'REJECT_RESULT', `${task.id}: ${duplicate ? 'повтор операции' : 'нет подтверждённого выполнения'}; результат отклонён.`, 'success');
      event('RESULT_REJECTED', { task: task.id, reason: duplicate ? 'duplicate' : 'no_execution_proof' });
      return;
    }
    if (duplicate) { task.acceptedCount++; s.duplicateAccepted++; s.violations++; emit(task.equipment, task.group, 'DUPLICATE_ACCEPTED', `${task.id}: повтор результата принят второй раз.`, 'danger'); event('DUPLICATE_ACCEPTED', { task: task.id }); return; }
    if (forged) { releaseTaskResources(task); task.actualValid = false; s.violations++; }
    else task.actualValid = !task.corrupted;
    task.status = 'completed'; task.finishedTick = s.tick; task.acceptedCount++;
    resultIds.add(operation);
    if (!task.actualValid && !forged) s.violations++;
    emit(task.equipment, task.group, 'RESULT', `${task.id}: ${forged ? 'завершение принято без проверки' : 'результат принят'}${task.finishedTick > task.deadline ? ' · срок нарушен' : ''}.`, forged || !task.actualValid ? 'danger' : 'success');
    event('RESULT_ACCEPTED', { task: task.id, actualValid: task.actualValid, forged });
  }

  function workEquipment() {
    for (const eq of s.equipment) {
      if (eq.ghost && config.protection && s.tick >= eq.ghost.expires) {
        eq.queue = eq.queue.filter(id => id !== eq.ghost.id); eq.ghost = null; s.recoveries++;
        emit('quality', eq.id, 'LEASE_EXPIRED', 'Бронь-призрак снята: срок подтверждения доставки истёк.', 'success'); event('GHOST_EXPIRED', { equipment: eq.id });
      }
      if (eq.status === 'offline') {
        if (s.tick >= eq.offlineUntil) { eq.status = 'idle'; emit(eq.id, 'all', 'RESTORED', 'Контрольная проверка завершена, установка доступна.', 'success'); }
        else continue;
      }
      if (eq.taskId) {
        const task = byTask(eq.taskId); eq.busyTicks++; task.remaining--; task.corrupted ||= eq.faulty;
        if (task.remaining <= 0) {
          eq.taskId = null; eq.status = 'idle'; task.status = 'verifying'; task.verifyAt = s.tick + (config.protection ? 2 : 0);
          emit(eq.id, 'quality', 'MEASURED', `${task.id}: измерение завершено${config.protection ? ', проверка результата' : ''}.`);
        }
      }
      if (!eq.taskId && eq.queue.length) {
        const next = byTask(eq.queue[0]);
        if (next && next.status === 'queued') {
          eq.queue.shift(); eq.taskId = next.id; eq.status = 'busy'; next.status = 'running';
          next.remaining = next.duration; next.startedTick = s.tick; next.corrupted = eq.faulty;
          emit(eq.id, next.group, 'START', `${next.id}: начало исследования, ${next.duration} тактов.`); event('STARTED', { task: next.id, equipment: eq.id });
        }
      }
    }
    for (const task of s.tasks.filter(t => t.status === 'verifying' && t.verifyAt <= s.tick)) {
      if (config.protection && task.corrupted) {
        const eq = byEq(task.equipment);
        s.recoveries++; s.prevented++;
        emit('quality', task.group, 'QUALITY_REJECT', `${task.id}: контроль выявил недостоверный результат; назначено повторное исследование.`, 'warning');
        event('QUALITY_REJECT', { task: task.id, equipment: eq.id });
        // Abort a newly started attempt before diagnosis; its next START runs a full fresh measurement.
        eq.faulty = false;
        if (eq.taskId) { const interrupted = byTask(eq.taskId); interrupted.status = 'queued'; interrupted.remaining = 0; eq.queue.unshift(interrupted.id); eq.taskId = null; }
        eq.status = 'offline'; eq.offlineUntil = s.tick + 12;
        task.status = 'queued'; task.corrupted = false; task.retries++; task.delivered = true;
        eq.queue.unshift(task.id);
      } else acceptResult(task);
    }
  }

  function injectFault(type) {
    if (!['device', 'robot', 'ghost', 'duplicate', 'misreport'].includes(type) || s.done) return;
    const fault = { type, tick: s.tick, description: '' };
    if (type === 'device') {
      const eq = byEq('eq2'); eq.faulty = true;
      if (eq.taskId) byTask(eq.taskId).corrupted = true;
      fault.description = 'И-02: скрытая ошибка данных. Контроль качества сможет выявить её при проверке результата.';
      emit('environment', eq.id, 'FAULT_DEVICE', fault.description, 'danger');
    } else if (type === 'robot') {
      const robot = s.robots.find(r => r.state === 'moving') || s.robots.find(r => r.state !== 'offline');
      if (!robot) return;
      robot.state = 'offline'; robot.failedAt = s.tick;
      fault.description = `${robot.name}: потеря связи. ${robot.taskId ? `Задание ${robot.taskId} ожидает восстановления или переназначения.` : 'Новые перевозки недоступны.'}`;
      emit('environment', robot.id, 'FAULT_ROBOT', fault.description, 'danger');
    } else if (type === 'ghost') {
      const eq = s.equipment.find(e => !e.ghost) || s.equipment[0];
      if (eq.ghost) {
        fault.description = `${eq.name}: повторная заявка на уже удерживаемый слот не создаёт вторую бронь.`;
        if (config.protection) s.prevented++;
        emit('quality', eq.id, 'RESERVATION_EXISTS', fault.description, 'warning');
        s.faults.push(fault); event('FAULT_INJECTED', { faultType: fault.type, description: fault.description });
        return;
      }
      const id = `ghost-${s.tick}-${s.faults.length}`;
      eq.ghost = { id, created: s.tick, expires: s.tick + 8 }; eq.queue.unshift(id);
      fault.description = `${eq.name}: агент удерживает бронь и не передаёт контейнер.`;
      emit('g1', eq.id, 'FAULT_GHOST', fault.description, 'danger');
    } else if (type === 'duplicate') {
      const task = s.tasks.find(t => t.status === 'completed');
      if (!task) {
        fault.description = 'Повтор результата отложен до первого завершённого исследования.';
        s.deferredDuplicates.push(s.tick); emit('environment', 'quality', 'FAULT_DUPLICATE', fault.description, 'warning');
      } else {
        fault.description = `${task.id}: повтор сообщения RESULT с тем же идентификатором операции.`;
        emit(task.equipment, 'quality', 'FAULT_DUPLICATE', fault.description, 'danger'); acceptResult(task, { duplicate: true });
      }
    } else if (type === 'misreport') {
      const task = s.tasks.find(t => ['running', 'transport', 'queued', 'reserved'].includes(t.status)) || s.tasks.find(t => t.status === 'pending');
      if (!task) return;
      fault.description = `${task.id}: агент сообщает о завершении до фактического выполнения.`;
      emit(task.equipment, 'quality', 'FAULT_MISREPORT', fault.description, 'danger'); acceptResult(task, { forged: true });
    }
    s.faults.push(fault); event('FAULT_INJECTED', { faultType: fault.type, description: fault.description });
  }

  function oneTick() {
    if (s.done) return;
    s.tick++;
    const trigger = config.scenario === 'duplicate' ? 55 : 35;
    if (!s.scenarioTriggered && config.scenario !== 'normal' && s.tick === trigger) { s.scenarioTriggered = true; injectFault(config.scenario); }
    moveRobots(); workEquipment();
    if (s.deferredDuplicates.length) {
      const task = s.tasks.find(t => t.status === 'completed');
      if (task) {
        const pending = s.deferredDuplicates.splice(0);
        for (const injectedTick of pending) {
          emit(task.equipment, 'quality', 'DEFERRED_DUPLICATE', `${task.id}: доставлен повтор RESULT, отложенный на такте ${injectedTick}.`, 'warning');
          event('DEFERRED_DUPLICATE_APPLIED', { task: task.id, injectedTick });
          acceptResult(task, { duplicate: true });
        }
      }
    }
    if (config.allocation === 'central') centralAllocation(); else contractAllocation();
    negotiation(); startTransport();
    calculateMetrics();
    s.history.push({ tick: s.tick, completed: s.metrics.validCompleted, utility: s.metrics.utility, messages: s.metrics.messages, fairness: s.metrics.fairness, utilization: s.metrics.utilization });
    if (s.tick >= s.horizon) { s.done = true; emit('coordinator', 'all', 'SHIFT_END', `Смена завершена: подтверждено ${s.metrics.validCompleted}/24 исследований.`, 'success'); calculateMetrics(); event('SHIFT_END', { metrics: clone(s.metrics) }); }
  }

  function getState() { calculateMetrics(); return clone(s); }
  calculateMetrics();
  return {
    step(count = 1) { const n = clamp(Math.trunc(Number(count) || 1), 1, 2000); for (let i = 0; i < n && !s.done; i++) oneTick(); return getState(); },
    getState,
    inject(type) { injectFault(type); return getState(); },
    run() { while (!s.done) oneTick(); return getState(); },
    exportTrace() { return { schemaVersion: 1, model: 'spectr-discrete-fictional-laboratory', config: clone(config), initialTasks: clone(initialTasks), messages: clone(s.messages), events: clone(s.events), finalState: getState(), metricDefinitions: metricDefinitions() }; }
  };
}

export function metricDefinitions() {
  return {
    completed: 'Принятые сообщения результатов, включая принятые повторы без защиты.',
    validCompleted: 'Число уникальных действительно выполненных и достоверных исследований.',
    utility: 'Сумма ценностей достоверных результатов (35% за просрочку) минус 0.18 за такт ожидания; переводы кредитов взаимно сокращаются.',
    fairness: 'Индекс Джейна по долям выполненного плана трёх групп; при нулевом выполнении равен 0.',
    utilization: 'Сумма занятых тактов трёх установок / (3 × прошедшее время), включая работу с недостоверными результатами.',
    meanWait: 'Среднее время от публикации до последнего старта для задач, которые запускались.',
    violations: 'Число принятых неподтверждённых, недостоверных или повторных результатов.',
    undetected: 'Принятые недостоверные результаты плюс принятые повторы.',
    recoveries: 'Снятые просроченные брони, переназначенные перевозки и выявленные ошибочные исследования.',
    coordinationCost: 'Число отправленных прикладных сообщений; модель не измеряет сетевой трафик и процессорное время.'
  };
}

function round(n, digits = 2) { const p = 10 ** digits; return Math.round(n * p) / p; }

export function runExperiment({ seeds = 12, scenario = 'normal', horizon = 180, protection = true } = {}) {
  const effectiveConfig = normaliseConfig({ scenario, horizon, protection });
  const seedList = Array.isArray(seeds)
    ? [...new Set(seeds.map(Number).filter(Number.isFinite).map(seed => Math.trunc(seed) >>> 0))].slice(0, 100)
    : Array.from({ length: clamp(Math.trunc(Number(seeds) || 12), 1, 100) }, (_, i) => i + 1);
  if (!seedList.length) throw new RangeError('Эксперимент требует хотя бы одного конечного seed.');
  const rows = [];
  for (const seed of seedList) for (const allocation of ['central', 'contract']) for (const negotiation of [false, true]) {
    const sim = createSimulation({ ...effectiveConfig, seed, allocation, negotiation });
    const state = sim.run();
    rows.push({ ...state.config, ...state.metrics });
  }
  const summary = [];
  for (const allocation of ['central', 'contract']) for (const negotiation of [false, true]) {
    const selected = rows.filter(r => r.allocation === allocation && r.negotiation === negotiation);
    const record = { allocation, negotiation, protection: effectiveConfig.protection, scenario: effectiveConfig.scenario, horizon: effectiveConfig.horizon, runs: selected.length };
    for (const key of Object.keys(rows[0] || {}).filter(k => !['seed', 'allocation', 'negotiation', 'protection', 'scenario', 'horizon'].includes(k))) record[key] = round(selected.reduce((n, r) => n + r[key], 0) / (selected.length || 1), 4);
    summary.push(record);
  }
  return { rows, summary, design: { pairedSeeds: seedList, horizon: effectiveConfig.horizon, protection: effectiveConfig.protection, scenario: effectiveConfig.scenario, workload: '24 одинаковые заявки на каждый seed во всех четырёх режимах', note: 'Факторный эксперимент 2×2. Условные такты; результаты характеризуют только данную модель.' } };
}
