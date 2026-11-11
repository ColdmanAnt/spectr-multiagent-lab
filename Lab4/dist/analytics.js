/**
 * Read-only operational analytics for a single simulation snapshot.
 * Estimates freeze the present queue and known deliveries. They exclude future
 * allocation, negotiations, faults and retries; null means no defensible estimate.
 * This module never changes the simulation or claims to predict future decisions.
 */
const active = (task, tick) => task.release <= tick && task.status !== 'completed';
const threatened = result => ['late', 'tight', 'blocked'].includes(result.risk);
const later = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function analyseShift(state) {
  const now = state.tick;
  const verification = state.config.protection ? 2 : 0;
  const taskById = new Map(state.tasks.map(task => [task.id, task]));
  const resultById = new Map();
  const put = (task, estimatedFinish, reason, explicitRisk) => {
    const slack = estimatedFinish === null ? null : task.deadline - estimatedFinish;
    const risk = explicitRisk || (slack < 0 ? 'late' : slack <= 5 ? 'tight' : 'ontrack');
    resultById.set(task.id, { id: task.id, equipment: task.equipment, estimatedFinish, slack, risk, reason });
  };

  for (const task of state.tasks) {
    if (task.status === 'completed') {
      put(task, later(task.finishedTick, null), task.actualValid ? 'Достоверный результат получен.' : 'Зачтён недостоверный результат.', task.actualValid ? 'completed' : 'invalid');
    } else if (task.release > now) {
      put(task, null, `Заявка появится на такте ${task.release}.`, 'unreleased');
    } else if (state.done) {
      put(task, null, 'Смена завершена; исследование осталось незавершённым', task.deadline < now ? 'late' : 'blocked');
    } else if (task.status === 'verifying') {
      if (state.config.protection && task.corrupted) put(task, null, 'Текущая попытка недостоверна: предстоят повтор и диагностика.', 'blocked');
      else put(task, Math.max(now + 1, later(task.verifyAt, now + 1)), 'Осталась контрольная проверка результата.');
    } else {
      put(task, null, task.status === 'pending' ? 'Ожидает назначения; срок завершения ещё не оценён.' : 'Доставка или очередь ещё не оценены.', task.status === 'pending' ? 'unplanned' : 'ontrack');
    }
  }

  const equipment = state.equipment.map(eq => {
    if (state.done) {
      const running = taskById.get(eq.taskId);
      const queued = eq.queue.map(id => taskById.get(id)).filter(task => task && task.status !== 'completed');
      const queuedWork = (running && running.status !== 'completed' ? Math.max(0, running.remaining) : 0) + queued.reduce((sum, task) => sum + task.duration, 0);
      const blocked = Boolean((running && running.status !== 'completed') || queued.length || eq.ghost || state.tasks.some(task => task.equipment === eq.id && task.status === 'verifying'));
      return { id: eq.id, queuedWork, finish: blocked ? null : now, blocked, segments: [] };
    }
    const segments = [];
    let cursor = now + 1;
    let blocked = false;
    let queuedWork = 0;
    let blockingReason = '';
    if (eq.status === 'offline') {
      const end = Math.max(now + 1, later(eq.offlineUntil, now + 1));
      segments.push({ task: null, start: now, end, kind: 'offline' });
      cursor = end;
    }
    // A known quality rejection will interrupt and reorder this installation.
    const rejectionPending = state.config.protection && state.tasks.some(task => task.equipment === eq.id && task.status === 'verifying' && task.corrupted);
    if (rejectionPending) {
      blocked = true;
      blockingReason = 'Контроль отклонит текущий результат; порядок работ изменится после диагностики.';
    }
    const running = taskById.get(eq.taskId);
    if (running) {
      const end = Math.max(cursor, now + Math.max(0, running.remaining));
      segments.push({ task: running.id, start: now, end, kind: 'running' });
      queuedWork += Math.max(0, running.remaining);
      if (blocked || (state.config.protection && (running.corrupted || eq.faulty))) {
        blocked = true;
        blockingReason ||= 'Текущая попытка недостоверна: повторное исследование изменит очередь.';
        put(running, null, blockingReason, 'blocked');
      } else {
        put(running, end + verification, state.config.protection ? 'Остаток измерения и два такта проверки.' : 'Остаток текущего измерения; проверка отключена.');
      }
      cursor = end;
    }
    for (const id of eq.queue) {
      if (eq.ghost?.id === id) {
        if (state.config.protection) {
          const end = Math.max(cursor, later(eq.ghost.expires, cursor));
          segments.push({ task: id, start: cursor, end, kind: 'ghost' });
          cursor = end;
        } else {
          segments.push({ task: id, start: cursor, end: null, kind: 'ghost' });
          blocked = true;
          blockingReason = 'Бронь-призрак удерживает начало очереди; автоматическое снятие отключено.';
        }
        continue;
      }
      const task = taskById.get(id);
      if (!task || task.status === 'completed') continue;
      queuedWork += task.duration;
      if (blocked) {
        put(task, null, blockingReason, 'blocked');
        continue;
      }
      let arrival;
      if (task.status === 'queued' || task.delivered) arrival = now + 1;
      else if (task.status === 'transport') {
        const robot = state.robots.find(robot => robot.taskId === task.id && robot.state === 'moving');
        arrival = robot ? now + Math.max(1, robot.travelTicks - robot.elapsed) : null;
      } else arrival = null;
      if (arrival === null) {
        blocked = true;
        blockingReason = task.status === 'transport' ? `Нет подтверждённого времени доставки ${task.id}; требуется решение о перевозке.` : `${task.id} ожидает назначения перевозки; время доставки неизвестно.`;
        put(task, null, blockingReason, 'blocked');
        continue;
      }
      if (state.config.protection && eq.faulty) {
        blocked = true;
        blockingReason = 'Известное отклонение прибора потребует повторной работы и диагностики.';
        put(task, null, blockingReason, 'blocked');
        continue;
      }
      const start = Math.max(cursor, arrival);
      const end = start + task.duration;
      segments.push({ task: task.id, start, end, kind: 'queued' });
      put(task, end + verification, task.status === 'transport' ? 'Текущая доставка, работы перед заявкой и проверка результата.' : 'Текущая очередь и проверка результата.');
      cursor = end;
    }
    return { id: eq.id, queuedWork, finish: blocked ? null : segments.length ? cursor : now, blocked, segments };
  });

  const tasks = state.tasks.map(task => resultById.get(task.id));
  const programs = state.groups.map(group => {
    const own = state.tasks.filter(task => task.group === group.id);
    return {
      id: group.id, name: group.name,
      completed: own.filter(task => task.status === 'completed' && task.actualValid).length,
      total: own.length, active: own.filter(task => active(task, now)).length,
      atRisk: own.filter(task => active(task, now) && threatened(resultById.get(task.id))).length,
      credits: group.credits, utility: group.utility
    };
  });
  const activeTasks = state.tasks.filter(task => active(task, now));
  const bottleneck = equipment.filter(eq => eq.queuedWork > 0 || eq.blocked)
    .sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.queuedWork - a.queuedWork || a.id.localeCompare(b.id))[0]?.id || null;
  return {
    tasks, equipment, programs,
    summary: {
      atRisk: activeTasks.filter(task => threatened(resultById.get(task.id))).length,
      blocked: activeTasks.filter(task => resultById.get(task.id).risk === 'blocked').length,
      active: activeTasks.length,
      bottleneck
    }
  };
}

/** Actual task events only. Same-tick source order is retained; output is detached. */
export function taskHistory(state, taskId) {
  return state.events.filter(event => event.task === taskId || event.displaced === taskId)
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.tick - b.event.tick || a.index - b.index)
    .map(({ event }) => structuredClone(event));
}
