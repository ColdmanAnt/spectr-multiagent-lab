import { runExperiment, SCENARIOS } from './engine.js';

export const LAB = Object.freeze({
  "number": 1,
  "shortTitle": "Архитектура",
  "title": "Спецификация и архитектура МАС",
  "description": "Наблюдайте роли агентов, передачу задач и последовательность состояний одного исследования.",
  "heroTitle": "От роли к действию.\nАрхитектура в работе.",
  "focusTab": "agents",
  "focusAction": "Изучить агентов",
  "tabs": [
    "overview",
    "agents",
    "guide"
  ],
  "controls": {
    "allocation": false,
    "scenario": false,
    "negotiation": false,
    "protection": false,
    "faults": false
  },
  "defaults": {
    "seed": 1,
    "allocation": "central",
    "scenario": "normal",
    "negotiation": false,
    "protection": true,
    "horizon": 180
  },
  "fixedNote": "Архитектурная демонстрация: диспетчеризация, штатная смена, переговоры выключены, проверка результатов включена.",
  "presets": [
    {
      "id": "architecture",
      "label": "Архитектурная демонстрация",
      "note": "Одна смена · роли и состояния",
      "config": {
        "allocation": "central",
        "negotiation": false,
        "scenario": "normal",
        "protection": true
      }
    }
  ],
  "batch": null
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
