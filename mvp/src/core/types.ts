import type { BloodGroup, ComponentCode } from './blood';
import type { ConditionCode } from './conditions';
import type { LatLng } from './geo';

export type OrgType = 'hospital' | 'blood_bank';

export interface Driver {
  id: string;
  name: string;
  phone: string;
  orgId: string;
}

export interface Org {
  id: string;
  name: string;
  type: OrgType;
  area: string;
  location: LatLng;
  phone: string;
  /** 1 = large / priority, 3 = small */
  tier: 1 | 2 | 3;
  verified: boolean;
  drivers: Driver[];
}

export type LotStatus = 'available' | 'reserved' | 'issued' | 'expired';

export interface Lot {
  id: string;
  orgId: string;
  group: BloodGroup;
  component: ComponentCode;
  units: number;
  collectedAt: number;
  expiresAt: number;
  status: LotStatus;
}

export type Urgency = 'routine' | 'urgent' | 'critical';

/**
 * searching   – broadcast sent, collecting offers (2.5 min)
 * planning    – receiver reviews the suggested supply plan (nothing sent yet)
 * in_progress – parts sent to hospitals; each part moves on its own
 */
export type RequestStatus = 'searching' | 'planning' | 'in_progress' | 'closed' | 'no_match' | 'cancelled';

/** One patient need inside a request (a mass-casualty request has several). */
export interface RequestLine {
  id: string;
  group: BloodGroup;
  component: ComponentCode;
  units: number;
  reason: ConditionCode;
}

export interface Broadcast {
  orgId: string;
  distanceM: number;
  ringKm: number;
  hasStock: boolean;
  /** sim time the hospital answers (only if it has stock) */
  respondAt: number;
  responded: boolean;
}

export type OfferStatus = 'pending' | 'selected' | 'approved' | 'declined' | 'expired';

/** What one hospital can give for one request line. */
export interface Offer {
  id: string;
  lineId: string;
  supplierOrgId: string;
  group: BloodGroup;
  substitute: boolean;
  /** all usable lots at the supplier, soonest-expiring first — availability is read live from these */
  lotIds: string[];
  /** units offered when the offer arrived (capped at the line's need) */
  units: number;
  nearestExpiry: number;
  distanceM: number;
  etaS: number;
  route: LatLng[];
  score: number;
  status: OfferStatus;
}

/** A pick in the supply plan the receiver is editing (not sent yet). */
export interface PlanPick {
  offerId: string;
  units: number;
}

export interface PartItem {
  lineId: string;
  offerId: string;
  units: number;
  /** reserved lots (filled on approval) */
  lotIds: string[];
}

export type PartStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'in_transit'
  | 'arrived'
  | 'received'
  | 'reported'
  | 'declined'
  | 'timed_out'
  | 'conflict'
  | 'cancelled';

/** The share of a request sent to one hospital: approved, carried and reported on its own. */
export interface Part {
  id: string;
  supplierOrgId: string;
  items: PartItem[];
  units: number;
  status: PartStatus;
  sentAt: number;
  senderDeadline: number;
  approvedAt?: number;
  deliveryId?: string;
  arrivedAt?: number;
  receivedAt?: number;
  report?: DeliveryReport;
  failReason?: string;
}

export interface BloodRequest {
  id: string;
  requesterOrgId: string;
  lines: RequestLine[];
  urgency: Urgency;
  status: RequestStatus;
  createdAt: number;
  /** written to the history ledger already */
  archived?: boolean;
  matchDeadline: number;
  radiusKm: number;
  broadcasts: Broadcast[];
  offers: Offer[];
  /** supply plan being edited by the receiver */
  draft: PlanPick[];
  /** offers the receiver unticked — never re-suggested */
  excludedOfferIds: string[];
  /** hospitals that declined, timed out or ran out — not suggested again for this request */
  failedOrgIds: string[];
  substitutesConfirmed: boolean;
  parts: Part[];
  closedAt?: number;
}

export type DeliveryStatus = 'loading' | 'moving' | 'stopped' | 'handover' | 'arrived' | 'cancelled' | 'handed_off';

export interface Delivery {
  id: string;
  partId: string;
  kind: 'main' | 'fresh' | 'handoff';
  fromOrgId: string;
  driver: Driver;
  route: LatLng[];
  lengthM: number;
  travelledM: number;
  status: DeliveryStatus;
  /** sim time loading / hand-over finishes */
  waitUntil: number;
  /** 1 = normal speed, < 1 = traffic */
  speedFactor: number;
  dispatchedAt: number;
  plannedArrival: number;
  /** ETA promised at dispatch (never re-planned) — used for the on-time score */
  promisedArrival: number;
  /** minutes from approval to dispatch */
  dispatchMin: number;
  /** delivery outcome already recorded for the performance score */
  recorded?: boolean;
  eta: number;
  lotIds: string[];
  units: number;
  parentId?: string;
  /** for hand-off legs: distance at which the units are picked up from the broken vehicle */
  handoffAtM?: number;
  handoffDone?: boolean;
  delayChecked?: boolean;
  lastWatch: number;
}

export type Actor = 'Receiver' | 'Sender' | 'Driver' | 'System' | 'Admin';

export interface TimelineEvent {
  id: number;
  at: number;
  actor: Actor;
  text: string;
  tone?: 'info' | 'good' | 'warn' | 'bad';
}

export interface RerouteDecision {
  partId: string;
  at: number;
  trigger: 'breakdown' | 'delay';
  travelledPct: number;
  caseNo: 1 | 2;
  options: { key: 'fresh' | 'handoff' | 'continue'; label: string; etaMin: number | null }[];
  chosen: 'fresh' | 'handoff' | 'continue';
  explanation: string;
}

export interface DeliveryReport {
  receivedBy: string;
  unitsReceived: number;
  bagNumbers: string;
  tempOnArrival: number;
  condition: 'good' | 'damaged';
  notes: string;
  photoName?: string;
  filedAt: number;
}
