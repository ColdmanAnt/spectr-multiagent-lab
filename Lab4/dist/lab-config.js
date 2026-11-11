import { runExperiment, SCENARIOS } from './engine.js';

export const LAB = Object.freeze({
  "number": 4,
  "shortTitle": "Надёжность",
  "title": "Диверсионный анализ и надёжность",
  "description": "Проверьте, как нарушения сообщений и ресурсов меняют результат до и после включения защиты.",
  "heroTitle": "Сбой как эксперимент.\nЗащита как проверяемое правило.",
  "focusTab": "analytics",
  "focusAction": "Открыть аналитику",
  "tabs": [
    "overview",
    "analytics",
    "agents",
    "experiments",
    "guide"
  ],
  "controls": {
    "allocation": true,
    "scenario": true,
    "negotiation": true,
    "protection": true,
    "faults": true
  },
  "defaults": {
    "seed": 1,
    "allocation": "central",
    "scenario": "device",
    "negotiation": true,
    "protection": true,
    "horizon": 180
  },
  "fixedNote": "Сохраняйте seed и такт вмешательства при сравнении режимов защиты. Можно выбрать сценарий или внести сбой вручную.",
  "presets": [
    {
      "id": "baseline",
      "label": "Штатный контроль",
      "note": "Диспетчер · без нарушений",
      "config": {
        "allocation": "central",
        "negotiation": true,
        "scenario": "normal",
        "protection": true
      }
    },
    {
      "id": "resilience",
      "label": "Недостоверный прибор",
      "note": "Ошибка измерения · защита включена",
      "config": {
        "allocation": "central",
        "negotiation": true,
        "scenario": "device",
        "protection": true
      }
    },
    {
      "id": "unprotected",
      "label": "Без защиты",
      "note": "Тот же прибор · проверки отключены",
      "config": {
        "allocation": "central",
        "negotiation": true,
        "scenario": "device",
        "protection": false
      }
    }
  ],
  "batch": {
    "seeds": 12,
    "configurations": 8,
    "runs": 96,
    "protections": [
      true,
      false
    ],
    "negotiation": null,
    "description": "12 seed × 2 механизма × переговоры выкл./вкл. × защита выкл./вкл.",
    "question": "Для выбранного сценария сравниваются восемь сочетаний распределения, переговоров и защиты.",
    "note": "Серия сравнивает оба режима защиты независимо от переключателя текущей смены."
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
