import { createSimulation, runExperiment, SCENARIOS, AGENT_INFO } from './engine.js';

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
  const seed = Number($('seed-input')?.value || 42);
  return { seed: Number.isSafeInteger(seed) && seed >= 1 && seed <= 4294967295 ? seed : 42,
    allocation: $('allocation-select')?.value || 'central',
    scenario: $('scenario-select')?.value || 'normal',
    negotiation: $('negotiation-toggle')?.checked ?? true,
    protection: $('protection-toggle')?.checked ?? true, horizon:180 };
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

function render() {
  renderMetrics(); renderMap(); renderTasks(); renderMessages(); renderEquipment(); renderTimeline(); renderFaults();
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
    html=`<span class="eyebrow">Карточка исследования</span><h2>${esc(t.id)} · ${esc(t.title)}</h2><div class="detail-grid">${field('Группа',names[t.group] || t.group)}${field('Установка',names[t.equipment] || t.equipment)}${field('Состояние',t.status==='completed'&&!t.actualValid?'Ошибочный зачёт':statuses[t.status]||t.status)}${field('Достоверность по состоянию модели',t.actualValid===null?'Результат ещё не получен':t.actualValid?'Достоверен':'Недостоверен')}${field('Число зачётов результата',t.acceptedCount)}${field('Появление / дедлайн',t.release+' / '+t.deadline+' тактов')}${field('Длительность',t.duration+' тактов')}${field('Полезность',t.value)}${field('Робот',t.robot||'Не назначен')}${field('Осталось',t.remaining??'—')}</div>`;
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
  if(experimentBusy)return;
  pause();experimentBusy=true;
  $('experiment-btn').disabled=true;
  if($('experiment-status')) $('experiment-status').textContent='Подготовка: одинаковые исходные условия для всех режимов…';
  const scenario=$('scenario-select')?.value||'normal';
  try {
    // Yield first, so status is painted before deterministic CPU work.
    await new Promise(resolve=>setTimeout(resolve,60));
    const protectedBatch=runExperiment({seeds:12,scenario,horizon:180,protection:true});
    if($('experiment-status')) $('experiment-status').textContent='48 смен с защитой выполнено. Сравнение с отключённой защитой…';
    await new Promise(resolve=>setTimeout(resolve,30));
    const unprotectedBatch=runExperiment({seeds:12,scenario,horizon:180,protection:false});
    experiment={scenario,seeds:12,rows:[...protectedBatch.rows,...unprotectedBatch.rows],summary:[...protectedBatch.summary.map(r=>({...r,protection:true})),...unprotectedBatch.summary.map(r=>({...r,protection:false}))]};
    renderExperiment();
    if($('export-csv-btn')) $('export-csv-btn').disabled=false;
    if($('experiment-status')) $('experiment-status').textContent=`Готово: ${experiment.rows.length} смен, 12 одинаковых seed на каждый режим. Сценарий: ${SCENARIOS.find(s=>s.id===scenario)?.name||scenario}.`;
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
  activeTab=tab;
  document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-selected',String(el.dataset.tab===tab));el.tabIndex=el.dataset.tab===tab?0:-1;});
  document.querySelectorAll('[data-panel]').forEach(el=>{el.classList.toggle('active',el.dataset.panel===tab);el.hidden=el.dataset.panel!==tab;});
  const titles={overview:'Центр управления',agents:'Агенты и взаимодействия',experiments:'Исследование механизмов',guide:'Как устроена система'};
  if($('page-title')) $('page-title').textContent=titles[tab]||titles.overview;
  if(tab==='agents')renderAgents();
}

function init() {
  if($('scenario-select')) $('scenario-select').innerHTML=SCENARIOS.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('play-btn')?.addEventListener('click',play);
  $('step-btn')?.addEventListener('click',()=>{pause();if(state.done)reset();advance();});
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
    const fault=event.target.closest('[data-inject]');if(fault){if(state.done)return toast('Начните новую смену для проверки сбоя.');state=sim.inject(fault.dataset.inject)||sim.getState();render();toast('Сбой добавлен. Решения агентов появятся в журнале.');}
    const filter=event.target.closest('[data-filter]');if(filter){messageFilter=filter.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===filter));renderMessages();}
    const agent=event.target.closest('[data-agent]');if(agent)showDetail('agent',agent.dataset.agent);
    const task=event.target.closest('[data-task]');if(task)showDetail('task',task.dataset.task);
  });
  document.addEventListener('keydown',event=>{
    if(event.target.matches('[data-tab]') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const tabs=[...document.querySelectorAll('[data-tab]')], current=tabs.indexOf(event.target);
      const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(['ArrowDown','ArrowRight'].includes(event.key)?1:tabs.length-1))%tabs.length;
      setTab(tabs[index].dataset.tab);tabs[index].focus();
    }
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('svg [data-agent]')){event.preventDefault();showDetail('agent',event.target.dataset.agent);}
  });
  reset();setTab('overview');
}
init();
