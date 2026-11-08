# Internal integration contract

Static dependency-free application. `dist/index.html` loads `app.js` as module and `style.css`. The simulation is `dist/engine.js` (ESM), usable in browser and Node. All UI copy in Russian. Fictional laboratory; no physical nuclear model, real radiation parameters or reactor operations.

## Engine exports

- `createSimulation(config = {})` returns object with `.step(count=1)`, `.getState()`, `.inject(type)`, `.run()`, `.exportTrace()`.
- `runExperiment({ seeds=12, scenario='normal', horizon=180 }={})` returns `{ rows, summary }`. Synchronous, four combinations of allocation and negotiation, same seed per combination. `rows` are flat objects including `seed, allocation, negotiation, protection, scenario` and metric fields. `summary` is array of flat mean metric records grouped by allocation/negotiation; must include `runs`.
- `SCENARIOS` array `{id,name,description}`; ids `normal`, `device`, `ghost`, `duplicate`, `misreport`.
- `AGENT_INFO` array `{id,name,role,goal,knowledge,actions}` for architecture UI.

Config: `{ seed: 42, allocation: 'central' | 'contract', negotiation: true, protection: true, scenario:'normal', horizon:180 }`. Scenarios activate on fixed tick (e.g. 35). Manual `.inject(type)` accepts `device`, `robot`, `ghost`, `duplicate`, `misreport`. Calls return fresh state; `.run()` returns final state. All randomness seeded. `.exportTrace()` returns JSON-serializable object containing config, initial scenario tasks, full messages, events and final state/metrics.

## State fields

`tick, horizon, done, config, tasks, equipment, robots, groups, messages, metrics, history, faults`.

Tasks: `{id,group,title,equipment,duration,deadline,value,release,status,robot,remaining}`. States `pending,reserved,transport,queued,running,verifying,completed,invalid`. Additional fields allowed. Group ids `g1,g2,g3`, equipment ids `eq1,eq2,eq3`, robot ids `r1,r2`.

Equipment: `{id,name,x,y,status,taskId,queue,faulty}`; status `idle,busy,offline`. Robots: `{id,name,x,y,from:{x,y},to:{x,y},progress,taskId,state}`; state `idle,moving,offline`. Coordinates in a fixed SVG viewBox `0 0 800 460`: group origins `(125,100),(125,230),(125,360)`, equipment `(580,100),(580,230),(580,360)`, robot home `(340,400)`. Use corridor through x=340; rendering can use simple interpolated paths. Groups: `{id,name,color,goal,credits,completed,total,utility,wait}`. Colours g1 teal, g2 orange, g3 violet.

Messages: `{id,tick,from,to,type,text,level}` levels `info,success,warning,danger`. Metrics at least `{completed,validCompleted,late,messages,utility,fairness,utilization,meanWait,recoveries,violations,undetected}`; fairness/utilization fractions 0..1. `history` array of metric snapshots with `tick`. `faults` array of objects `{type,tick,description,...}`.

## UI DOM contract

Root app.js owns rendering inside: `#lab-map`, `#metrics`, `#task-list`, `#message-list`, `#equipment-list`, `#agent-list`, `#experiment-results`, `#timeline-chart`, `#fault-list`, `#experiment-status`, `#progress-label`, `#progress-fill`, `#status-label`, `#detail-content`, `#toast`.

Controls: `#play-btn`, `#step-btn`, `#reset-btn`, `#export-btn`, `#export-csv-btn`, `#experiment-btn`, `#seed-input`, `#allocation-select`, `#scenario-select`, `#negotiation-toggle` (checkbox), `#protection-toggle` (checkbox), `#speed-select`. Buttons `[data-inject]` values device,robot,ghost,duplicate,misreport. Tabs `[data-tab]` values overview,agents,experiments,guide; panels `[data-panel]` with same values; active class `.active`. Filters `[data-filter]` values all,negotiation,fault. `#detail-dialog` is native dialog with `#detail-close`. All controls use type=button except inputs/selects. App must tolerate non-critical missing containers.

Styling class hooks for dynamic markup: `.metric-card`, `.metric-label`, `.metric-value`, `.metric-hint`, `.task-row`, `.task-name`, `.task-meta`, `.task-status`, `.pill`, `.pill--success`, `.pill--warning`, `.pill--danger`, `.pill--muted`, `.log-entry`, `.log-time`, `.log-route`, `.log-text`, `.log-type`, `.log-entry--success`, `.log-entry--warning`, `.log-entry--danger`, `.equipment-card`, `.equipment-title`, `.equipment-meta`, `.mini-progress`, `.mini-progress-fill`, `.agent-card`, `.agent-role`, `.agent-goal`, `.agent-stats`, `.empty-state`, `.fault-item`, `.data-table`, `.result-highlight`, `.chart-legend`, `.group-dot`, `.detail-grid`, `.detail-item`. SVG classes can be added by app inline. Use proper aria-labels; support reduced motion and <=390px widths.
