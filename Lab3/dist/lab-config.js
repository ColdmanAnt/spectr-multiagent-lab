import { runExperiment, SCENARIOS } from './engine.js';

export const LAB = Object.freeze({
  "number": 3,
  "shortTitle": "Переговоры",
  "title": "Переговоры и разрешение конфликтов",
  "description": "Исследуйте обмен местами в очереди: интересы групп, компенсации и справедливость распределения.",
  "heroTitle": "Ограниченные слоты.\nСогласованные решения.",
  "focusTab": "experiments",
  "focusAction": "Исследовать переговоры",
  "tabs": [
    "overview",
    "analytics",
    "agents",
    "experiments",
    "guide"
  ],
  "controls": {
    "allocation": true,
    "scenario": false,
    "negotiation": true,
    "protection": false,
    "faults": false
  },
  "defaults": {
    "seed": 1,
    "allocation": "central",
    "scenario": "normal",
    "negotiation": true,
    "protection": true,
    "horizon": 180
  },
  "fixedNote": "Предмет исследования — переговоры об очереди. Сценарий штатный, проверка результатов включена.",
  "presets": [
    {
      "id": "without-negotiation",
      "label": "Без переговоров",
      "note": "Диспетчер · исходная очередь",
      "config": {
        "allocation": "central",
        "negotiation": false
      }
    },
    {
      "id": "with-negotiation",
      "label": "С переговорами",
      "note": "Диспетчер · обмен слотами",
      "config": {
        "allocation": "central",
        "negotiation": true
      }
    }
  ],
  "batch": {
    "seeds": 12,
    "configurations": 4,
    "runs": 48,
    "protections": [
      true
    ],
    "negotiation": null,
    "description": "12 seed × 2 механизма × переговоры выкл./вкл.; защита включена.",
    "question": "Внутри каждого механизма одни и те же задачи выполняются с переговорами и без них.",
    "note": "Эффект переговоров оценивайте при неизменном механизме распределения."
  }
});

// The profile fixes the controlled conditions of this laboratory work.
export function resolveLabConfig(input = {}) {
  const seed = Number(input.seed ?? LAB.defaults.seed);
  return {
    ...LAB.defaults,
    seed: Number.isSafeInteger(seed) && seed >= 1 && seed <= 4294967295 ? seed : LAB.defaults.seed,
    allocation: LAB.controls.allocation && input.allocation === 'contract' ? 'contract' : LAB.defaults.allocation,
    scenario: LAB.controls.scenario && SCENARIOS.some(s => s.id === input.scenario) ? input.scenario : LAB.defaults.scenario,
    negotiation: LAB.controls.negotiation ? input.negotiation !== false : LAB.defaults.negotiation,
    protection: LAB.controls.protection ? input.protection !== false : LAB.defaults.protection,
  };
}

export function runLabBatch({ seeds = 12, scenario = LAB.defaults.scenario } = {}) {
  if (!LAB.batch) throw new Error('В лабораторной работе 1 выполняется демонстрация архитектуры, а не пакетное сравнение.');
  const effectiveScenario = LAB.controls.scenario && SCENARIOS.some(s => s.id === scenario) ? scenario : 'normal';
  const batches = LAB.batch.protections.map(protection => ({
    protection, result: runExperiment({ seeds, scenario: effectiveScenario, horizon: 180, protection })
  }));
  const allowed = row => LAB.batch.negotiation === null || row.negotiation === LAB.batch.negotiation;
  return {
    lab: LAB.number, scenario: effectiveScenario, seeds,
    rows: batches.flatMap(({ result }) => result.rows.filter(allowed)),
    summary: batches.flatMap(({ protection, result }) => result.summary.filter(allowed).map(row => ({ ...row, protection }))),
  };
}
