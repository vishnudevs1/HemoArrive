// Worst-case re-route rule from the notebook.
// Case 1 — travelled less than half: source fresh units near the receiver.
// Case 2 — travelled half or more: keep the units in the vehicle (hand-off / continue).
// Either way, if the other option is clearly faster, take it.

export const REROUTE_THRESHOLD = 0.5;
/** Only override the case rule when the other option saves at least this much time. */
export const ETA_OVERRIDE_MARGIN_S = 180;
/** ETA slip that triggers a re-route check. */
export const DELAY_TRIGGER_S = 600;

export type RerouteChoice = 'fresh' | 'keep';

export interface RerouteInput {
  travelledM: number;
  plannedM: number;
  /** ETA (seconds from now) if the units already on the road still go: hand-off or continue */
  keepEtaS: number | null;
  /** ETA (seconds from now) for fresh units from another hospital */
  freshEtaS: number | null;
  threshold?: number;
}

export interface RerouteResult {
  caseNo: 1 | 2;
  fraction: number;
  choice: RerouteChoice;
  overridden: boolean;
}

export function decideReroute(input: RerouteInput): RerouteResult {
  const threshold = input.threshold ?? REROUTE_THRESHOLD;
  const fraction = input.plannedM > 0 ? Math.min(input.travelledM / input.plannedM, 1) : 0;
  const caseNo: 1 | 2 = fraction < threshold ? 1 : 2;
  const { keepEtaS, freshEtaS } = input;

  if (freshEtaS == null && keepEtaS == null) return { caseNo, fraction, choice: 'keep', overridden: false };
  if (freshEtaS == null) return { caseNo, fraction, choice: 'keep', overridden: caseNo === 1 };
  if (keepEtaS == null) return { caseNo, fraction, choice: 'fresh', overridden: caseNo === 2 };

  if (caseNo === 1) {
    const override = keepEtaS + ETA_OVERRIDE_MARGIN_S < freshEtaS;
    return { caseNo, fraction, choice: override ? 'keep' : 'fresh', overridden: override };
  }
  const override = freshEtaS + ETA_OVERRIDE_MARGIN_S < keepEtaS;
  return { caseNo, fraction, choice: override ? 'fresh' : 'keep', overridden: override };
}
