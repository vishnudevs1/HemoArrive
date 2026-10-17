// Reason for a request, as a controlled list mapped to ICD-10 blocks.
// This is the condition the blood is for, entered by blood bank staff — not a diagnosis,
// and never linked to a patient. It lets planners see which conditions drive demand where.

import type { ComponentCode } from './blood';

export type ConditionCode = 'dengue' | 'thalassaemia' | 'sickle_cell' | 'anaemia' | 'obstetric' | 'injury' | 'cancer' | 'surgery';

export interface Condition {
  code: ConditionCode;
  label: string;
  icd: string;
  /** usual component mix, used by the history generator */
  components: Partial<Record<ComponentCode, number>>;
}

export const CONDITIONS: Condition[] = [
  { code: 'injury', label: 'Injury / road accident', icd: 'S00–T14', components: { PRBC: 65, FFP: 30, WB: 5 } },
  { code: 'obstetric', label: 'Bleeding in pregnancy / after childbirth', icd: 'O44–O46, O67, O72', components: { PRBC: 70, FFP: 30 } },
  { code: 'surgery', label: 'Planned surgery', icd: 'Z (procedure)', components: { PRBC: 80, FFP: 20 } },
  { code: 'anaemia', label: 'Anaemia (not pregnancy)', icd: 'D50–D64', components: { PRBC: 100 } },
  { code: 'thalassaemia', label: 'Thalassaemia', icd: 'D56', components: { PRBC: 100 } },
  { code: 'sickle_cell', label: 'Sickle cell disease', icd: 'D57', components: { PRBC: 100 } },
  { code: 'dengue', label: 'Dengue', icd: 'A90–A91', components: { PLT: 95, FFP: 5 } },
  { code: 'cancer', label: 'Cancer treatment', icd: 'C00–D48', components: { PLT: 60, PRBC: 40 } },
];

export const conditionOf = (code: ConditionCode) => CONDITIONS.find((c) => c.code === code)!;
