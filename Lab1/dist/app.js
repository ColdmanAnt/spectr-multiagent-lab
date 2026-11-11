import { LAB, resolveLabConfig, runLabBatch } from './lab-config.js';
import { analyseShift, taskHistory } from './analytics.js';
import { createSimulation, SCENARIOS, AGENT_INFO } from './engine.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v).toLocaleString('ru-RU', {maximumFractionDigits:d}) : '—';
const pct = (v) => `${num(Number(v) * 100, 1)}%`;
const colors = { g1:'#148e83', g2:'#d78a32', g3:'#8571ca' };
const names = Object.fromEntries(AGENT_INFO.map(a => [a.id, a.name]));
const statuses = {pending:'Ожидает',reserved:'Назначено',transport:'В пути',queued:'В очереди',running:'Измерение',verifying:'Проверка',completed:'Подтверждено',invalid:'Перепроверка'};
const taskClass = (status) => status === 'completed' ? 'pill--success' : status === 'invalid' ? 'pill--danger' : ['running','verifying','transport'].includes(status) ? 'pill--warning' : 'pill--muted';
let sim, state, timer = null, messageFilter = 'all', experiment = null, experimentBusy = false, toastTimer;
let activeTab = 'overview';

function toast(message) {
  if (!$('toast')) return;
  $('toast').textContent = message;
  $('toast').hidden = false;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').classList.remove('visible'); $('toast').hidden = true; }, 3600);
}

function config() {
  return resolveLabConfig({
    seed: $('seed-input')?.value,
    allocation: $('allocation-select')?.value,
    scenario: $('scenario-select')?.value,
    negotiation: $('negotiation-toggle')?.checked,
    protection: $('protection-toggle')?.checked,
  });
}

function pause() {
  if (timer) clearInterval(timer);
  timer = null;
  updatePlay();
}
function updatePlay() {
  if ($('play-btn')) $('play-btn').innerHTML = timer ? '<span aria-hidden="true">Ⅱ</span> Пауза' : `<span aria-hidden="true">▶</span> ${state?.done ? 'Новая смена' : 'Запустить'}`;
  if ($('status-label')) {
    $('status-label').textContent = state?.done ? 'Смена завершена' : timer ? 'Симуляция идёт' : 'На паузе';
    $('status-label').dataset.state = timer ? 'running' : state?.done ? 'done' : 'paused';
  }
}
function reset(notify = false) {
  pause();
  sim = createSimulation(config());
  state = sim.getState();
  if ($('seed-input')) $('seed-input').value = state.config.seed;
  render();
  if (notify) toast('Новая смена. Начальные условия зафиксированы.');
}
function advance(count = 1) {
  state = sim.step(count);
  if (!state || !Array.isArray(state.tasks)) state = sim.getState();
  if (state.done) { pause(); toast('Смена завершена. Можно выгрузить полную трассу.'); }
  render();
}
function play() {
  if (timer) return pause();
  if (state.done) reset();
  const speed = Number($('speed-select')?.value || 1);
  timer = setInterval(() => advance(), Math.max(50, 550 / speed));
  updatePlay();
}

function renderMetrics() {
  const m = state.metrics;
  const cards = [
    ['Достоверных',`${num(m.validCompleted)}<small> / ${state.tasks.length}</small>`,'Достоверные результаты по состоянию модели'],
    ['В срок', num(m.onTime ?? Math.max(0, m.validCompleted - m.late)), `${num(m.late)} завершено с опозданием`],
    ['Загрузка приборов',pct(m.utilization),'Доля занятых приборо-тактов'],
    ['Справедливость',num(m.fairness,3),'Индекс Джейна по выполнению планов'],
    ['Сообщений',num(m.messages), `${num(m.negotiationAccepted ?? 0)} соглашений об обмене`],
    ['Восстановлений',num(m.recoveries),`${num(m.violations)} нарушений · ${num(m.undetected ?? 0)} ошибочных зачётов`]
  ];
  if(LAB.number<3)cards[4][2]='Коммуникационная стоимость протокола';
  if(LAB.number===1)cards[5]=['Участников',num(AGENT_INFO.length),'Собственные роли, знания и действия'];
  if(LAB.number===2)cards[5]=['Полезность',num(m.utility,2),'Ценность результатов с учётом ожидания'];
  if(LAB.number===3)cards[5]=['Соглашений',num(m.negotiationAccepted),`${num(m.negotiationRejected)} предложений отклонено`];
  if ($('metrics')) $('metrics').innerHTML = cards.map(([label,value,hint]) => `<article class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-hint">${hint}</div></article>`).join('');
}

function renderMap() {
  if (!$('lab-map')) return;
  const groups = state.groups;
  const node = (id,x,y,w,h,fill,stroke,content) => `<g role="button" tabindex="0" aria-label="${esc(names[id] || id)}" data-agent="${id}" class="map-node"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${stroke}"/>${content}</g>`;
  const rooms = groups.map((g,i) => {
    const y = 62 + i * 130;
    const count = state.tasks.filter(t => t.group === g.id && !['completed','invalid'].includes(t.status) && t.release <= state.tick).length;
    return node(g.id,42,y,192,90,'#ffffff',colors[g.id],`<rect x="55" y="${y+15}" width="5" height="24" rx="2.5" fill="${colors[g.id]}"/><text x="72" y="${y+27}" fill="#24333d" font-size="14" font-weight="650">${esc(g.name)}</text><text x="58" y="${y+53}" fill="#75828b" font-size="11">${num(g.completed)} / ${num(g.total)} исследований</text><text x="58" y="${y+74}" fill="${colors[g.id]}" font-size="11">${count} активных · ${num(g.credits)} кредитов</text>`);
  }).join('');
  const equipment = state.equipment.map((e,i) => {
    const y = 62 + i * 130;
    const task = state.tasks.find(t => t.id === e.taskId);
    const color = e.status === 'offline' ? '#d25858' : e.faulty ? '#d78a32' : e.status === 'busy' ? '#148e83' : '#a2b2b8';
    const progress = task ? Math.max(0, Math.min(1, 1 - (task.remaining ?? task.duration) / task.duration)) : 0;
    return node(e.id,496,y,260,90,'#fff',e.status === 'offline' ? '#efbcbc' : '#dce5e7',`<rect x="511" y="${y+17}" width="24" height="27" rx="5" fill="${color}" opacity=".12"/><path d="M518 ${y+23}h10m-10 5h6m-6 5h10" stroke="${color}" stroke-width="2"/><text x="546" y="${y+29}" fill="#24333d" font-size="14" font-weight="650">${esc(e.name)}</text><circle cx="738" cy="${y+25}" r="4" fill="${color}"/><text x="512" y="${y+56}" fill="#75828b" font-size="11">${e.status === 'offline' ? 'Диагностика' : e.faulty ? 'Отклонение результатов' : task ? esc(task.id) + ' · измерение' : 'Готов к работе'} · очередь ${(e.queue || []).length}</text><rect x="512" y="${y+70}" width="224" height="4" rx="2" fill="#edf2f2"/><rect x="512" y="${y+70}" width="${224*progress}" height="4" rx="2" fill="${color}"/>`);
  }).join('');
  const robots = state.robots.map((r,i) => {
    const x = Number.isFinite(r.x) ? r.x : 340;
    const y = Number.isFinite(r.y) ? r.y : 400 + i*20;
    const task = state.tasks.find(t => t.id === r.taskId);
    const color = r.state === 'offline' ? '#d25858' : colors[task?.group] || '#148e83';
    let route = '';
    if (r.state === 'moving' && r.path?.length) route = `<polyline points="${r.path.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 6" opacity=".45"/>`;
    return `${route}<g role="button" tabindex="0" data-agent="${r.id}" aria-label="${esc(r.name)}" class="map-node"><circle cx="${x}" cy="${y}" r="24" fill="${color}" opacity=".1"/><rect x="${x-13}" y="${y-12}" width="26" height="24" rx="8" fill="${color}" stroke="white" stroke-width="3"/><circle cx="${x-4}" cy="${y-1}" r="2" fill="white"/><circle cx="${x+4}" cy="${y-1}" r="2" fill="white"/><text x="${x}" y="${y+32}" text-anchor="middle" font-size="10" font-weight="600" fill="#53656f">${esc(r.id.toUpperCase())}${task ? ' · '+esc(task.id) : ''}</text></g>`;
  }).join('');
  $('lab-map').innerHTML = `<svg viewBox="0 0 800 460" role="group" aria-label="План лаборатории: три научные группы, три измерительных установки и два транспортных робота"><defs><pattern id="mapGrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#dce6e8"/></pattern></defs><rect width="800" height="460" fill="#f5f8f8"/><rect width="800" height="460" fill="url(#mapGrid)"/><path d="M234 107H496M234 237H496M234 367H496M340 107V420" stroke="#e1e9e9" stroke-width="30" fill="none" stroke-linecap="round"/><path d="M234 107H496M234 237H496M234 367H496M340 107V420" stroke="#fff" stroke-width="1.5" stroke-dasharray="5 7" fill="none"/><text x="44" y="32" fill="#8b9a9f" font-size="10" letter-spacing="1.7">ИССЛЕДОВАТЕЛЬСКИЕ ГРУППЫ</text><text x="498" y="32" fill="#8b9a9f" font-size="10" letter-spacing="1.7">ИЗМЕРИТЕЛЬНЫЙ КОМПЛЕКС</text><text x="360" y="436" fill="#8b9a9f" font-size="10">Транспортный коридор</text>${rooms}${equipment}${robots}</svg>`;
}

function renderTasks() {
  if (!$('task-list')) return;
  const tasks = state.tasks.filter(t => t.release <= state.tick).sort((a,b) => (a.status === 'completed')-(b.status === 'completed') || a.deadline-b.deadline);
  $('task-list').innerHTML = tasks.length ? tasks.map(t => `<button type="button" class="task-row" data-task="${esc(t.id)}"><span class="group-dot" style="background:${colors[t.group]}"></span><span class="task-name"><strong>${esc(t.id)} · ${esc(t.title)}</strong><span class="task-meta">${esc(names[t.group] || t.group)} · ${esc(names[t.equipment] || t.equipment)} · срок ${t.deadline}</span></span><span class="task-status pill ${t.status==='completed'&&!t.actualValid?'pill--danger':taskClass(t.status)}">${esc(t.status==='completed'&&!t.actualValid?'Ошибочный зачёт':statuses[t.status] || t.status)}</span></button>`).join('') : '<div class="empty-state">Заявки появятся после начала смены.</div>';
}

function renderMessages() {
  if (!$('message-list')) return;
  const negotiationTypes = new Set(['OFFER','COUNTER','ACCEPT','REJECT']);
  const faultTypes = new Set(['REJECT_RESULT','QUALITY_REJECT','LEASE_EXPIRED','REASSIGN','RESTORED','DUPLICATE_ACCEPTED','RESERVATION_EXISTS','DEFERRED_DUPLICATE_APPLIED']);
  const filtered = state.messages.filter(m => messageFilter === 'all' || (messageFilter === 'fault' ? (m.type.startsWith('FAULT_') || faultTypes.has(m.type)) : negotiationTypes.has(m.type)));
  $('message-list').innerHTML = filtered.length ? filtered.slice(-65).reverse().map(m => `<article class="log-entry log-entry--${esc(m.level)}"><span class="log-time">${String(m.tick).padStart(3,'0')}</span><div><div class="log-route">${esc(names[m.from] || m.from)} <span aria-hidden="true">→</span> ${esc(names[m.to] || m.to)} <span class="log-type">${esc(m.type)}</span></div><div class="log-text">${esc(m.text)}</div></div></article>`).join('') : '<div class="empty-state">В этом фильтре пока нет сообщений. Запустите смену.</div>';
}

function renderEquipment() {
  if (!$('equipment-list')) return;
  $('equipment-list').innerHTML = state.equipment.map(e => {
    const t = state.tasks.find(t => t.id === e.taskId);
    const progress = t ? Math.max(0,Math.min(100,100*(1-(t.remaining??t.duration)/t.duration))) : 0;
    return `<button type="button" data-agent="${e.id}" class="equipment-card"><div class="equipment-title"><span>${esc(e.name)}</span><span class="pill ${e.status==='offline'?'pill--danger':e.status==='busy'?'pill--success':'pill--muted'}">${e.status==='offline'?'Недоступен':e.status==='busy'?'В работе':'Свободен'}</span></div><div class="equipment-meta">${t ? esc(t.id)+' · осталось '+num(t.remaining)+' такт.' : 'Ожидание заявки'}<span>${(e.queue || []).length} в очереди</span></div><div class="mini-progress"><div class="mini-progress-fill" style="width:${progress}%"></div></div></button>`;
  }).join('') + `<div class="robot-summary">${state.robots.map(r=>`<span><i style="background:${r.state==='offline'?'#d25858':'#148e83'}"></i>${esc(r.name)} · ${r.state==='offline'?'нет связи':r.state==='moving'?'доставка':'свободен'}</span>`).join('')}</div>`;
}

function renderAgents() {
  if (!$('agent-list')) return;
  $('agent-list').innerHTML = AGENT_INFO.map(a => {
    const g=state.groups.find(g=>g.id===a.id);
    const e=state.equipment.find(e=>e.id===a.id);
    const r=state.robots.find(r=>r.id===a.id);
    const info = g ? `${g.completed} / ${g.total} завершено · ${num(g.credits)} кредитов` : e ? `Очередь: ${e.queue.length} · ${e.status==='busy'?'в работе':e.status==='offline'?'недоступен':'свободен'}` : r ? (r.state==='moving'?'Перевозит '+r.taskId:r.state==='offline'?'Недоступен':'Готов к заявке') : 'Координация и контроль протоколов';
    return `<button type="button" data-agent="${a.id}" class="agent-card"><div class="agent-role"><span class="group-dot" style="background:${colors[a.id] || '#66858b'}"></span>${esc(a.role)}</div><h3>${esc(a.name)}</h3><p class="agent-goal">${esc(a.goal)}</p><div class="agent-stats">${esc(info)}</div></button>`;
  }).join('');
}

function renderTimeline() {
  if (!$('timeline-chart')) return;
  const history=state.history || [];
  const width=680,height=128,left=28,top=12,bottom=104;
  const pts=history.map(h=>`${left + (h.tick/state.horizon)*(width-left-14)},${bottom-((h.validCompleted??h.completed??0)/state.tasks.length)*(bottom-top)}`).join(' ');
  $('timeline-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Число подтверждённых исследований по тактам"><path d="M${left} ${top}V${bottom}H${width-14}" fill="none" stroke="#dce5e7"/><path d="M${left} 58H${width-14}" stroke="#edf1f1" stroke-dasharray="4 5"/><text x="4" y="16" font-size="9" fill="#84939a">${state.tasks.length}</text><text x="12" y="${bottom+3}" font-size="9" fill="#84939a">0</text><text x="${left}" y="123" font-size="9" fill="#84939a">0</text><text x="${width-40}" y="123" font-size="9" fill="#84939a">${state.horizon}</text>${pts?`<polygon points="${left},${bottom} ${pts} ${left + (state.tick/state.horizon)*(width-left-14)},${bottom}" fill="#148e83" opacity=".07"/><polyline points="${pts}" fill="none" stroke="#148e83" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`:''}</svg>`;
}

function renderFaults() {
  if (!$('fault-list')) return;
  $('fault-list').innerHTML=state.faults.length?state.faults.slice(-5).reverse().map(f=>`<div class="fault-item"><span class="pill pill--warning">Такт ${f.tick}</span><p>${esc(f.description || f.type)}</p></div>`).join(''):'<div class="empty-state">Вмешательств пока нет. Выберите сценарий или добавьте сбой вручную.</div>';
}

const riskNames = {unreleased:'Ещё не опубликовано',unplanned:'Без назначения',completed:'Завершено',invalid:'Ошибочный зачёт',blocked:'Нет оценки',late:'Риск просрочки',tight:'Малый запас',ontrack:'В пределах срока'};
const eventNames = {ASSIGNED:'Оборудование назначено',TRANSPORT_STARTED:'Началась доставка',DELIVERED:'Контейнер доставлен',STARTED:'Началось измерение',RESULT_ACCEPTED:'Результат принят',RESULT_REJECTED:'Результат отклонён',QUALITY_REJECT:'Назначено повторное измерение',REASSIGNED:'Доставка переназначена',SLOT_SWAP:'Изменена очередь',DUPLICATE_ACCEPTED:'Повтор принят без защиты',DEFERRED_DUPLICATE_APPLIED:'Доставлен отложенный повтор'};
const programGoals = {g1:'Ценные длительные измерения и серии спектров.',g2:'Короткие сроки и оперативные контрольные серии.',g3:'Равномерное выполнение собственного плана.'};
let analytics, controlSnapshot = null;
function workloadKey() {
  return JSON.stringify(state.tasks.map(t=>[t.id,t.group,t.release,t.deadline,t.duration,t.value,t.compatible]));
}
function snapshot() {
  return {tick:state.tick,config:structuredClone(state.config),metrics:structuredClone(state.metrics),workload:workloadKey(),faults:structuredClone(state.faults)};
}
function comparisonReady() {
  return !!controlSnapshot && controlSnapshot.tick===state.tick && controlSnapshot.config.seed===state.config.seed && controlSnapshot.config.horizon===state.config.horizon && controlSnapshot.workload===workloadKey();
}
function describeConfig(config) {
  return `${config.allocation==='central'?'Диспетчер':'Контрактная сеть'} · переговоры ${config.negotiation?'вкл.':'выкл.'} · защита ${config.protection?'вкл.':'выкл.'} · ${SCENARIOS.find(s=>s.id===config.scenario)?.name||config.scenario}`;
}
function faultHistory(faults) {
  const labels={device:'прибор',robot:'робот',ghost:'бронь',duplicate:'повтор',misreport:'ложный отчёт'};
  return faults.length?faults.map(f=>`${labels[f.type]||f.type}@${f.tick}`).join(', '):'нет';
}
function renderOperational() {
  analytics=analyseShift(state);
  const m=state.metrics, a=analytics.summary;
  $('hero-count').textContent=String(m.validCompleted).padStart(2,'0');
  $('hero-state').textContent=state.done?'Смена завершена':`Такт ${state.tick} · ${state.tasks.filter(t=>t.release<=state.tick&&t.status!=='completed').length} активных заявок`;
  $('hero-description').textContent=LAB.number===4?(SCENARIOS.find(s=>s.id===state.config.scenario)?.description||LAB.description):LAB.description;
  const bad=m.undetected>0;
  const title=state.done?'Итоги смены':bad?'Нужна проверка результатов':a.blocked?'Есть неопределённость сроков':a.atRisk?'Сроки требуют внимания':'Оперативная обстановка';
  const text=state.done?`Достоверно завершено ${m.validCompleted} из ${state.tasks.length}. В срок — ${m.onTime}. Ошибочных зачётов — ${m.undetected}.`:bad?`Принято ${m.undetected} ошибочных зачётов. Разберите события в паспортах образцов.`:`${a.atRisk} заявок с риском по сроку или неизвестным завершением. ${a.blocked} ожидают снятия ограничения.`;
  $('shift-alert').innerHTML=`<div class="alert-content" data-level="${bad?'danger':a.atRisk?'warning':'normal'}"><strong>${esc(title)}</strong><span>${esc(text)}</span><button type="button" class="text-action" data-open-tab="${LAB.number===1?'agents':'analytics'}">${LAB.number===1?'Роли и действия':state.done?'Разобрать результаты':'Подробнее'} ↗</button></div>`;
  if(activeTab==='analytics')renderAnalytics();
}
function renderAnalytics() {
  const a=analytics.summary;
  $('analytics-kpis').innerHTML=[['Активных заявок',a.active,'Опубликованы и ещё не завершены'],['Требуют внимания',a.atRisk,'Сроки или неизвестное завершение'],['Узкое место',a.bottleneck?names[a.bottleneck]:'—','Блокировка или наибольшая нагрузка'],['Полезность',num(state.metrics.utility,2),'Фактическая, с учётом ожидания']].map(([label,value,note])=>`<article class="analysis-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
  const filter=$('program-filter').value;
  $('program-cards').innerHTML=analytics.programs.map(p=>`<button type="button" class="program-card ${filter===p.id?'selected':''}" style="--program-color:${colors[p.id]}" data-program="${p.id}" aria-pressed="${filter===p.id}"><span class="program-code">ПРОГРАММА / ${p.id.toUpperCase()}</span><h3>${esc(p.name)}</h3><p>${esc(programGoals[p.id])}</p><div class="program-progress"><strong>${p.completed}</strong> / ${p.total} подтверждено</div><div class="program-progress-track"><i style="width:${p.completed/p.total*100}%"></i></div><div class="program-detail"><span><strong>${p.atRisk}</strong> требуют внимания</span><span><strong>${num(p.credits)}</strong> кредитов</span></div></button>`).join('');
  document.querySelector('.schedule-note').textContent=state.done?'Смена завершена. Показан остаток работ; прогноз завершения больше не строится.':'Оценка при неизменной очереди. Новые заявки, переговоры, сбои и повторные измерения могут изменить сроки. «Нет оценки» означает неизвестное время доставки или блокировку.';
  $('schedule-tick').textContent=`Снимок на такте ${state.tick}`;
  const max=Math.max(state.tick+30,...analytics.equipment.flatMap(e=>e.segments.map(s=>s.end).filter(Number.isFinite)));
  const span=max-state.tick;
  $('equipment-schedule').innerHTML=analytics.equipment.map(e=>{
    const segments=e.segments.filter(s=>Number.isFinite(s.end)&&s.end>state.tick);
    return `<div class="schedule-row"><div class="schedule-resource"><strong>${esc(names[e.id])}</strong><small>${num(e.queuedWork)} тактов в работе и очереди</small></div><div class="schedule-track" aria-label="${esc(names[e.id])}: ${e.blocked?'часть очереди без оценки':'прогноз до такта '+e.finish}">${segments.map(s=>`<${s.task&&state.tasks.some(t=>t.id===s.task)?'button type="button" data-task="'+s.task+'"':'span'} class="schedule-segment" data-kind="${s.kind}" style="left:${Math.max(0,s.start-state.tick)/span*100}%;width:${(s.end-Math.max(state.tick,s.start))/span*100}%" title="${esc(s.task||s.kind)} · ${s.start}–${s.end}">${esc(s.task||'Проверка')}</${s.task&&state.tasks.some(t=>t.id===s.task)?'button':'span'}>`).join('')}</div><span class="schedule-result ${e.blocked?'blocked':''}">${state.done?(e.blocked?'Не завершено':'Работы окончены'):e.blocked?'Часть очереди<br>без оценки':`До такта ${e.finish}`}</span></div>`;
  }).join('')+(state.done?'':`<div class="schedule-axis"><span></span><div><span>${state.tick}</span><span>${Math.round(state.tick+span/2)}</span><span>${max}</span></div><span>такты</span></div>`);
  const ranks={invalid:0,blocked:1,late:2,tight:3,unplanned:4,ontrack:5,unreleased:6,completed:7};
  const risks=analytics.tasks.filter(t=>{const task=state.tasks.find(x=>x.id===t.id);return task.release<=state.tick&&(filter==='all'||task.group===filter)&&t.risk!=='completed';}).sort((a,b)=>ranks[a.risk]-ranks[b.risk]||(a.slack??Infinity)-(b.slack??Infinity));
  $('risk-list').innerHTML=risks.length?risks.map(t=>`<button type="button" class="risk-row" data-task="${t.id}"><div><strong>${esc(t.id)} · ${esc(names[state.tasks.find(x=>x.id===t.id).group])}</strong><p>${esc(t.reason)}${t.estimatedFinish!==null?` · оценка: такт ${t.estimatedFinish}, запас ${t.slack}`:''}</p></div><span class="risk-status" data-risk="${t.risk}">${esc(riskNames[t.risk])}</span></button>`).join(''):'<div class="empty-state">Все опубликованные исследования этой программы завершены достоверно.</div>';
  renderComparison();
  const decisions=state.messages.filter(m=>['ASSIGN','AWARD','BID','OFFER','COUNTER','ACCEPT','REJECT','QUALITY_REJECT','REASSIGN','REJECT_RESULT','LEASE_EXPIRED'].includes(m.type)).slice(-6).reverse();
  $('decision-feed').innerHTML=decisions.length?decisions.map(m=>`<article class="decision-item"><span>${String(m.tick).padStart(3,'0')}</span><div><strong>${esc(names[m.from]||m.from)} → ${esc(names[m.to]||m.to)} · ${esc(m.type)}</strong><p>${esc(m.text)}</p></div></article>`).join(''):'<div class="empty-state">Выполните несколько тактов: здесь появятся назначения, предложения и решения контроля.</div>';
}
function renderComparison() {
  const host=$('comparison-content');
  if(!controlSnapshot){host.innerHTML='<span class="comparison-empty-icon" aria-hidden="true">⇄</span><p>Сохраните текущее состояние как контроль, начните другую смену с тем же seed и сравните результат на том же такте.</p><p>Можно проверить эффект переговоров, способа координации или защиты. Контроль хранится до закрытия страницы.</p>';return;}
  const c=controlSnapshot;
  const details=`<div class="comparison-config"><strong>Контроль: такт ${c.tick} · seed ${c.config.seed}</strong><br>${esc(describeConfig(c.config))}<br>Сбои контроля: ${esc(faultHistory(c.faults))}.<br>Сейчас: ${esc(describeConfig(state.config))}<br>Сбои текущей смены: ${esc(faultHistory(state.faults))}.</div>`;
  const buttons=`<div class="comparison-buttons">${state.tick<c.tick&&state.config.seed===c.config.seed&&state.config.horizon===c.config.horizon?'<button type="button" class="button button-light" id="align-btn">К такту контроля</button>':''}<button type="button" class="text-action" id="clear-control-btn">Удалить контроль</button></div>`;
  if(!comparisonReady()){host.innerHTML=details+`<p>Для сопоставления нужны одинаковые задачи, seed, горизонт и такт. Сейчас: такт ${state.tick} / seed ${state.config.seed}; контроль: такт ${c.tick} / seed ${c.config.seed}.</p>`+buttons;return;}
  const measures=[['Достоверных','validCompleted',0],['Полезность','utility',2],['Справедливость','fairness',3],['Сообщений','messages',0],['Ошибочных зачётов','undetected',0]];
  host.innerHTML=details+'<p>Разница: текущая смена минус контроль. Одиночное сравнение описывает этот seed.</p><div class="comparison-deltas">'+measures.map(([label,key,d])=>{const diff=state.metrics[key]-c.metrics[key];return `<div><span>${label}</span><strong data-direction="${diff<0?'negative':'normal'}">${diff>0?'+':''}${num(diff,d)}</strong></div>`;}).join('')+'</div>'+buttons;
}
function preparePreset(id) {
  const preset=LAB.presets.find(p=>p.id===id);if(!preset)return;
  const next=resolveLabConfig({...config(),...preset.config});
  $('allocation-select').value=next.allocation;$('negotiation-toggle').checked=next.negotiation;
  $('scenario-select').value=next.scenario;$('protection-toggle').checked=next.protection;
  reset();toast('Новая смена подготовлена. Нажмите «Запустить» или выполните такт.');
}

function exportBrief() {
  pause();
  const brief={schemaVersion:1,applicationVersion:'1.2.0',lab:LAB.number,kind:state.done?'final':'interim',tick:state.tick,config:state.config,metrics:state.metrics,groups:state.groups,faults:state.faults,analytics,forecastAssumptions:'Текущая очередь, известная доставка и диагностика; будущие назначения, переговоры, сбои и повторы не моделируются. null означает отсутствие оценки. После завершения смены будущие сроки не строятся.',control:controlSnapshot,comparable:comparisonReady()};
  download(`spectr-brief-${state.config.seed}-t${state.tick}.json`,JSON.stringify(brief,null,2),'application/json');toast('Оперативная сводка сохранена.');
}

function render() {
  renderOperational(); renderMetrics(); renderMap(); renderTasks(); renderMessages(); renderEquipment(); renderTimeline(); renderFaults();
  if(activeTab==='agents') renderAgents();
  if($('progress-label')) $('progress-label').textContent=`Такт ${state.tick} / ${state.horizon}`;
  if($('progress-fill')) $('progress-fill').style.width=`${Math.min(100,state.tick/state.horizon*100)}%`;
  updatePlay();
}

function showDetail(type,id) {
  const dialog=$('detail-dialog');
  if(!dialog || !$('detail-content')) return;
  pause();
  let html='';
  const field=(title,value)=>`<div class="detail-item"><span>${esc(title)}</span><p>${esc(Array.isArray(value)?value.join('; '):value)}</p></div>`;
  if(type==='task') {
    const t=state.tasks.find(t=>t.id===id); if(!t)return;
    html=`<span class="eyebrow">Паспорт образца</span><h2>${esc(t.id)} · ${esc(t.title)}</h2><div class="detail-grid">${field('Группа',names[t.group] || t.group)}${field('Установка',names[t.equipment] || t.equipment)}${field('Состояние',t.status==='completed'&&!t.actualValid?'Ошибочный зачёт':statuses[t.status]||t.status)}${field('Достоверность по состоянию модели',t.actualValid===null?'Результат ещё не получен':t.actualValid?'Достоверен':'Недостоверен')}${field('Число зачётов результата',t.acceptedCount)}${field('Появление / дедлайн',t.release+' / '+t.deadline+' тактов')}${field('Длительность',t.duration+' тактов')}${field('Ценность результата в срок',t.value)}${field('Робот',t.robot||'Не назначен')}${field('Осталось измерять',t.status==='running'?t.remaining+' такт.':t.status==='verifying'?'Измерение окончено':'—')}</div>`;
    const forecast=analytics.tasks.find(x=>x.id===id);
    const history=taskHistory(state,id);
    html+=`<div class="passport-forecast"><strong>${esc(riskNames[forecast.risk])}${forecast.estimatedFinish!==null?' · такт '+forecast.estimatedFinish:''}</strong>${esc(forecast.reason)}${forecast.slack!==null?' · запас до срока: '+forecast.slack+' такт.':''}</div><h3 class="passport-heading">Фактическая история образца</h3><ol class="passport-history"><li><time>${t.release}</time><div><strong>${t.release<=state.tick?'Заявка опубликована':'Публикация запланирована'}</strong><small>Срок ${t.deadline} · длительность ${t.duration} тактов · повторов ${t.retries}</small></div></li>${history.map(e=>`<li data-alert="${['QUALITY_REJECT','RESULT_REJECTED','DUPLICATE_ACCEPTED'].includes(e.type)||(e.type==='RESULT_ACCEPTED'&&!e.actualValid)}"><time>${e.tick}</time><div><strong>${esc(eventNames[e.type]||e.type)}</strong><small>${esc(e.type==='RESULT_ACCEPTED'?(e.actualValid?'Достоверный результат':'Результат недостоверен по состоянию модели'):[e.equipment?names[e.equipment]:null,e.robot?names[e.robot]:null,e.credits!==undefined?'Компенсация '+e.credits+' кредитов':null,e.reason].filter(Boolean).join(' · '))}</small></div></li>`).join('')}</ol>`;
  } else {
    const a=AGENT_INFO.find(a=>a.id===id); if(!a)return;
    html=`<span class="eyebrow">Автономный агент · ${esc(a.id)}</span><h2>${esc(a.name)}</h2><div class="detail-grid">${field('Роль',a.role)}${field('Личная цель',a.goal)}${field('Локальные знания',a.knowledge)}${field('Действия',a.actions)}</div>`;
  }
  $('detail-content').innerHTML=html.replace('<h2>', '<h2 id="detail-title">') + `<p class="muted">Снимок на такте ${state.tick}. Смена приостановлена.</p>`;
  if(!dialog.open) dialog.showModal();
}

function download(name,content,type) {
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csv(rows) {
  if(!rows.length) return '';
  const keys=[...new Set(rows.flatMap(Object.keys))];
  const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  return '\uFEFF'+keys.map(q).join(',')+'\r\n'+rows.map(r=>keys.map(k=>q(r[k])).join(',')).join('\r\n');
}

async function runBatch() {
  if(experimentBusy || !LAB.batch)return;
  pause();experimentBusy=true;
  $('experiment-btn').disabled=true;
  if($('experiment-status')) $('experiment-status').textContent=`Расчёт ${LAB.batch.runs} смен на одинаковых начальных условиях…`;
  try {
    await new Promise(resolve=>setTimeout(resolve,60));
    experiment=runLabBatch({seeds:12,scenario:config().scenario});
    renderExperiment();
    if($('export-csv-btn')) $('export-csv-btn').disabled=false;
    if($('experiment-status')) $('experiment-status').textContent=`Готово: ${experiment.rows.length} смен, 12 одинаковых seed на каждый режим. Сценарий: ${SCENARIOS.find(s=>s.id===experiment.scenario)?.name||experiment.scenario}.`;
    toast('Эксперимент завершён. CSV содержит все отдельные прогоны.');
  }catch(error){
    if($('experiment-status')) $('experiment-status').textContent='Не удалось выполнить эксперимент: '+error.message;
    console.error(error);
  }finally{experimentBusy=false;$('experiment-btn').disabled=false;}
}

function renderExperiment() {
  if(!$('experiment-results')||!experiment)return;
  const summary=experiment.summary;
  const table=`<div class="table-scroll"><table class="data-table"><thead><tr><th>Распределение</th><th>Переговоры</th><th>Защита</th><th>Подтверждено</th><th>В срок</th><th>Сообщений</th><th>Справедливость</th><th>Ожидание</th><th>Ошибочных зачётов</th></tr></thead><tbody>${summary.map(r=>`<tr><td>${r.allocation==='central'?'Диспетчер':'Контрактная сеть'}</td><td>${r.negotiation?'Вкл.':'Выкл.'}</td><td><span class="pill ${r.protection?'pill--success':'pill--muted'}">${r.protection?'Вкл.':'Выкл.'}</span></td><td>${num(r.validCompleted,2)}</td><td>${num(r.onTime,2)}</td><td>${num(r.messages,1)}</td><td>${num(r.fairness,3)}</td><td>${num(r.meanWait,1)}</td><td>${num(r.undetected,2)}</td></tr>`).join('')}</tbody></table></div>`;
  const max=Math.max(1,...summary.map(r=>r.validCompleted));
  const bars=`<div class="experiment-bars">${summary.map(r=>`<div class="experiment-bar-row"><span>${r.allocation==='central'?'Диспетчер':'Контрактная сеть'} · переговоры ${r.negotiation?'да':'нет'} · защита ${r.protection?'да':'нет'}</span><div><i style="width:${r.validCompleted/max*100}%;background:${r.protection?'#148e83':'#a0b7b5'}"></i></div><strong>${num(r.validCompleted,2)}</strong></div>`).join('')}</div>`;
  $('experiment-results').innerHTML=`<div class="result-highlight"><strong>Средние по ${experiment.seeds} прогонам</strong><p>Числа получены симуляцией. Режимы сравниваются на одинаковых задачах. Улучшение всех показателей одновременно не гарантируется.</p></div>${bars}${table}`;
}

function setTab(tab) {
  if(!LAB.tabs.includes(tab))tab=LAB.tabs[0];
  activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-selected',String(el.dataset.tab===tab));el.tabIndex=el.dataset.tab===tab?0:-1;});
  document.querySelectorAll('[data-panel]').forEach(el=>{el.classList.toggle('active',el.dataset.panel===tab);el.hidden=el.dataset.panel!==tab;});
  const titles={analytics:'Аналитика смены',overview:LAB.title,agents:'Агенты и взаимодействия',experiments:'Исследование механизмов',guide:'Как устроена система'};
  if($('page-title')) $('page-title').textContent=titles[tab]||titles.overview;
  if(tab==='agents')renderAgents();
  if(tab==='analytics')renderAnalytics();
}

function applyLabProfile() {
  document.title=`СПЕКТР · Лабораторная работа ${LAB.number} — ${LAB.shortTitle}`;
  document.body.dataset.lab=String(LAB.number);
  document.querySelector('.breadcrumb').textContent=`СПЕКТР / Лабораторная работа ${LAB.number} / ${LAB.shortTitle}`;
  document.querySelector('.page-subtitle').textContent=LAB.description;
  document.querySelector('.brand-word small').textContent=`ЛАБОРАТОРНАЯ № ${LAB.number}`;
  document.querySelector('.sidebar-footer small').textContent='Самостоятельная работа · v1.2';
  document.querySelector('.hero-kicker').textContent=`ЛАБОРАТОРНАЯ РАБОТА ${String(LAB.number).padStart(2,'0')} / СПЕКТР`;
  document.querySelector('.hero-copy h2').innerHTML=esc(LAB.heroTitle).replace('\n','<br>');
  const action=document.querySelector('.hero-actions [data-open-tab]');
  action.dataset.openTab=LAB.focusTab;action.textContent=LAB.focusAction+' ↗';
  document.querySelector('.presets').innerHTML='<span class="preset-label">НОВАЯ СМЕНА</span>'+LAB.presets.map((p,i)=>`<button type="button" data-preset="${esc(p.id)}"><b>${String(i+1).padStart(2,'0')}</b><span>${esc(p.label)}<small>${esc(p.note)}</small></span><i aria-hidden="true">↗</i></button>`).join('');
  document.querySelector('.presets').style.setProperty('--preset-count',LAB.presets.length);
  const controls=[['allocation-select','allocation'],['scenario-select','scenario'],['negotiation-toggle','negotiation'],['protection-toggle','protection']];
  for(const [id,key] of controls){const el=$(id);el.disabled=!LAB.controls[key];el.closest('label').hidden=!LAB.controls[key];}
  $('seed-input').value=LAB.defaults.seed;$('allocation-select').value=LAB.defaults.allocation;
  $('scenario-select').value=LAB.defaults.scenario;$('negotiation-toggle').checked=LAB.defaults.negotiation;$('protection-toggle').checked=LAB.defaults.protection;
  const toggles=document.querySelector('.toggle-field');toggles.hidden=!LAB.controls.negotiation&&!LAB.controls.protection;
  document.querySelector('.configuration-grid').classList.add('lab-config-grid');
  $('lab-profile-note').textContent=LAB.fixedNote;
  document.querySelector('.fault-panel').hidden=!LAB.controls.faults;
  document.querySelector('.analysis-grid').classList.toggle('lab-without-faults',!LAB.controls.faults);
  document.querySelector('[data-filter="negotiation"]').hidden=LAB.number<3;
  document.querySelector('[data-filter="fault"]').hidden=LAB.number<4;
  for(const tab of document.querySelectorAll('[data-tab]'))tab.hidden=!LAB.tabs.includes(tab.dataset.tab);
  for(const panel of document.querySelectorAll('[data-panel]'))if(!LAB.tabs.includes(panel.dataset.panel))panel.hidden=true;
  document.querySelector('.labs-guide').hidden=true;
  const guideTitle=document.querySelector('#panel-guide .section-intro h2');guideTitle.innerHTML=`Как проверить<br>лабораторную работу ${LAB.number}.`;
  document.querySelector('#panel-guide .section-intro p').textContent=LAB.fixedNote;
  const cards=[...document.querySelectorAll('.guide-card')];
  cards[0].querySelector('p').textContent='Задайте seed и подготовьте смену. «Один такт» позволяет разбирать отдельные решения; «+10 тактов» ускоряет просмотр. Карточки объектов показывают роли и фактические события.';
  for(let i=1;i<cards.length;i++)cards[i].hidden=(i===1&&LAB.number===1)||(i===2&&LAB.number<3)||(i===3&&LAB.number<4);
  if(LAB.number===1){cards[1].hidden=false;cards[1].querySelector('h3').textContent='Изучите роли и сообщения';cards[1].querySelectorAll('p')[0].textContent='Научные группы формируют заявки, диспетчер назначает оборудование, роботы доставляют контейнеры, установки выполняют измерения.';cards[1].querySelectorAll('p')[1].textContent='Сопоставьте журнал событий с графом коммуникаций и состояниями исследования.';}
  if(LAB.batch){
    const panel=$('panel-experiments');
    panel.querySelector('.section-intro p').textContent=LAB.batch.question;
    panel.querySelector('.intro-number').textContent=`${LAB.batch.configurations}×12`;
    panel.querySelector('.experiment-toolbar h3').textContent=`Серия из ${LAB.batch.runs} запусков`;
    panel.querySelector('.experiment-toolbar p').textContent=LAB.batch.description;
    panel.querySelector('.experiment-toolbar .small-text').textContent=LAB.batch.note;
    if(LAB.number===2){panel.querySelector('.experiment-empty p').textContent='Сравните завершения, время ожидания и коммуникационную стоимость двух механизмов. Переговоры и защита зафиксированы.';}
  }
}

function init() {
  if($('scenario-select')) $('scenario-select').innerHTML=SCENARIOS.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('play-btn')?.addEventListener('click',play);
  $('step-btn')?.addEventListener('click',()=>{pause();if(state.done)reset();advance();});
  $('jump-btn')?.addEventListener('click',()=>{pause();if(state.done)reset();advance(10);});
  $('pin-btn')?.addEventListener('click',()=>{pause();controlSnapshot=snapshot();renderComparison();toast('Контроль сохранён. Повторите тот же seed с другими настройками.');});
  $('brief-btn')?.addEventListener('click',exportBrief);
  $('program-filter')?.addEventListener('change',renderAnalytics);
  $('reset-btn')?.addEventListener('click',()=>reset(true));
  $('speed-select')?.addEventListener('change',()=>{if(timer){pause();play();}});
  ['seed-input','allocation-select','scenario-select','negotiation-toggle','protection-toggle'].forEach(id=>$(id)?.addEventListener('change',()=>reset(true)));
  $('export-btn')?.addEventListener('click',()=>{download(`spectr-trace-${state.config.seed}-t${state.tick}.json`,JSON.stringify(sim.exportTrace(),null,2),'application/json');toast('Трасса JSON сохранена.');});
  $('export-csv-btn')?.addEventListener('click',()=>{if(!experiment)return toast('Сначала выполните серию экспериментов.');download(`spectr-experiment-${experiment.scenario}.csv`,csv(experiment.rows),'text/csv;charset=utf-8');});
  $('experiment-btn')?.addEventListener('click',runBatch);
  $('detail-close')?.addEventListener('click',()=>$('detail-dialog').close());
  $('detail-dialog')?.addEventListener('click',event=>{if(event.target===$('detail-dialog'))$('detail-dialog').close();});
  document.addEventListener('click',event=>{
    const tab=event.target.closest('[data-tab]');if(tab)setTab(tab.dataset.tab);
    const open=event.target.closest('[data-open-tab]');if(open){setTab(open.dataset.openTab);$('tab-'+open.dataset.openTab)?.focus();}
    const preset=event.target.closest('[data-preset]');if(preset)preparePreset(preset.dataset.preset);
    const program=event.target.closest('[data-program]');if(program){$('program-filter').value=$('program-filter').value===program.dataset.program?'all':program.dataset.program;renderAnalytics();}
    if(event.target.closest('#clear-control-btn')){controlSnapshot=null;renderComparison();}
    if(event.target.closest('#align-btn')&&controlSnapshot&&state.tick<controlSnapshot.tick){pause();advance(controlSnapshot.tick-state.tick);}
    const fault=event.target.closest('[data-inject]');if(fault){if(!LAB.controls.faults)return toast('Ручные нарушения исследуются в лабораторной работе 4.');if(state.done)return toast('Начните новую смену для проверки сбоя.');state=sim.inject(fault.dataset.inject)||sim.getState();render();toast('Сбой добавлен. Решения агентов появятся в журнале.');}
    const filter=event.target.closest('[data-filter]');if(filter){messageFilter=filter.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderMessages();}
    const agent=event.target.closest('[data-agent]');if(agent)showDetail('agent',agent.dataset.agent);
    const task=event.target.closest('[data-task]');if(task)showDetail('task',task.dataset.task);
  });
  document.addEventListener('keydown',event=>{
    if(event.target.matches('[data-tab]') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const tabs=[...document.querySelectorAll('[data-tab]:not([hidden])')], current=tabs.indexOf(event.target);
      const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(['ArrowDown','ArrowRight'].includes(event.key)?1:tabs.length-1))%tabs.length;
      setTab(tabs[index].dataset.tab);tabs[index].focus();
    }
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('svg [data-agent]')){event.preventDefault();showDetail('agent',event.target.dataset.agent);}
  });
  applyLabProfile();reset();setTab('overview');
}
init();
