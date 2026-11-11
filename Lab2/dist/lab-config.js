import { runExperiment, SCENARIOS } from './engine.js';

export const LAB = Object.freeze({
  "number": 2,
  "shortTitle": "Координация",
  "title": "Механизмы распределения и координации",
  "description": "Сравните диспетчеризацию и контрактную сеть на одинаковых исходных заданиях.",
  "heroTitle": "Одна нагрузка.\nДва способа координации.",
  "focusTab": "experiments",
  "focusAction": "Сравнить механизмы",
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
  "fixedNote": "Для чистого сравнения механизмов: штатная смена, переговоры выключены, проверка результатов включена.",
  "presets": [
    {
      "id": "central",
      "label": "Центральный диспетчер",
      "note": "Назначения по срокам",
      "config": {
        "allocation": "central"
      }
    },
    {
      "id": "contract",
      "label": "Контрактная сеть",
      "note": "CFP → BID → AWARD → ACK",
      "config": {
        "allocation": "contract"
      }
    }
  ],
  "batch": {
    "seeds": 12,
    "configurations": 2,
    "runs": 24,
    "protections": [
      true
    ],
    "negotiation": false,
    "description": "12 seed × 2 механизма; переговоры выключены, защита включена.",
    "question": "Каждый seed задаёт одинаковые задачи для диспетчеризации и контрактной сети. Различаются правила распределения.",
    "note": "Сравнение фиксирует штатный сценарий и исключает влияние переговоров."
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
