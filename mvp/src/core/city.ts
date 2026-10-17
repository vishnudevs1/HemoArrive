// Simulated city: 30 fictional hospitals and blood banks placed on real Jaipur localities.
// All names, phone numbers and stock are synthetic.

import { BLOOD_GROUPS, COMPONENTS, GROUP_WEIGHTS, type BloodGroup, type ComponentCode } from './blood';
import { mulberry32, pickWeighted, randInt } from './rng';
import type { Driver, Lot, Org, OrgType } from './types';

export const JAIPUR_CENTER: [number, number] = [26.89, 75.8];
export const DEMO_RECEIVER_ID = 'org-sanganer';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

type Seed = [id: string, name: string, type: OrgType, area: string, lat: number, lng: number, tier: 1 | 2 | 3];

const ORG_SEEDS: Seed[] = [
  ['org-sanganer', 'St. Mira District Hospital', 'hospital', 'Sanganer', 26.82, 75.79, 2],
  ['org-cscheme', 'Central Blood Centre', 'blood_bank', 'C-Scheme', 26.911, 75.798, 1],
  ['org-malviya', 'Malviya Nagar Care Hospital', 'hospital', 'Malviya Nagar', 26.8549, 75.8243, 1],
  ['org-mansarovar', 'Mansarovar Lifeline Hospital', 'hospital', 'Mansarovar', 26.853, 75.76, 2],
  ['org-vaishali', 'Vaishali Nagar Blood Bank', 'blood_bank', 'Vaishali Nagar', 26.911, 75.727, 2],
  ['org-rajapark', 'Raja Park Hospital', 'hospital', 'Raja Park', 26.899, 75.83, 3],
  ['org-sitapura', 'Sitapura Industrial Hospital', 'hospital', 'Sitapura', 26.775, 75.845, 2],
  ['org-jagatpura', 'Jagatpura Blood Centre', 'blood_bank', 'Jagatpura', 26.825, 75.87, 2],
  ['org-vidhyadhar', 'Vidhyadhar Nagar Hospital', 'hospital', 'Vidhyadhar Nagar', 26.96, 75.78, 2],
  ['org-jhotwara', 'Jhotwara Community Hospital', 'hospital', 'Jhotwara', 26.95, 75.74, 3],
  ['org-durgapura', 'Durgapura City Hospital', 'hospital', 'Durgapura', 26.845, 75.795, 2],
  ['org-banipark', 'Bani Park Heart & Trauma Centre', 'hospital', 'Bani Park', 26.93, 75.795, 1],
  ['org-amer', 'Amer Fort Road Hospital', 'hospital', 'Amer', 26.9855, 75.8513, 3],
  ['org-sodala', 'Sodala Blood Bank', 'blood_bank', 'Sodala', 26.9, 75.765, 2],
  ['org-pratap', 'Pratap Nagar General Hospital', 'hospital', 'Pratap Nagar', 26.8, 75.82, 2],
  ['org-murlipura', 'Murlipura Hospital', 'hospital', 'Murlipura', 26.97, 75.755, 3],
  ['org-shastri', 'Shastri Nagar Medical Centre', 'hospital', 'Shastri Nagar', 26.94, 75.785, 2],
  ['org-adarsh', 'Adarsh Nagar Hospital', 'hospital', 'Adarsh Nagar', 26.9, 75.825, 3],
  ['org-gopalpura', 'Gopalpura Medical College Hospital', 'hospital', 'Gopalpura', 26.865, 75.775, 1],
  ['org-khatipura', 'Khatipura Hospital', 'hospital', 'Khatipura', 26.925, 75.73, 3],
  ['org-johari', 'Johari Bazaar Charitable Blood Bank', 'blood_bank', 'Johari Bazaar', 26.92, 75.827, 2],
  ['org-jamdoli', 'Jamdoli Hospital', 'hospital', 'Jamdoli', 26.92, 75.87, 3],
  ['org-bagru', 'Bagru Primary Hospital', 'hospital', 'Bagru', 26.813, 75.545, 3],
  ['org-chomu', 'Chomu District Hospital', 'hospital', 'Chomu', 27.166, 75.724, 2],
  ['org-kalwar', 'Kalwar Community Hospital', 'hospital', 'Kalwar', 26.96, 75.63, 3],
  ['org-kanota', 'Kanota Highway Hospital', 'hospital', 'Kanota', 26.818, 75.98, 3],
  ['org-bassi', 'Bassi Blood Centre', 'blood_bank', 'Bassi', 26.84, 76.05, 3],
  ['org-chaksu', 'Chaksu Sub-District Hospital', 'hospital', 'Chaksu', 26.605, 75.948, 3],
  ['org-achrol', 'Achrol Rural Hospital', 'hospital', 'Achrol', 27.1, 75.9, 3],
  ['org-bindayaka', 'Bindayaka Blood Bank', 'blood_bank', 'Bindayaka', 26.97, 75.69, 3],
];

/** Planning zones (groups of localities) used for area-level reports. */
export const ZONES = ['Central', 'North', 'South', 'East', 'West'] as const;
export type Zone = (typeof ZONES)[number];

const ZONE_OF_AREA: Record<string, Zone> = {
  'C-Scheme': 'Central', 'Raja Park': 'Central', 'Bani Park': 'Central', 'Sodala': 'Central', 'Adarsh Nagar': 'Central', 'Johari Bazaar': 'Central',
  'Vidhyadhar Nagar': 'North', 'Amer': 'North', 'Murlipura': 'North', 'Shastri Nagar': 'North', 'Chomu': 'North', 'Achrol': 'North',
  'Sanganer': 'South', 'Malviya Nagar': 'South', 'Mansarovar': 'South', 'Sitapura': 'South', 'Durgapura': 'South', 'Pratap Nagar': 'South', 'Gopalpura': 'South', 'Chaksu': 'South',
  'Jagatpura': 'East', 'Jamdoli': 'East', 'Kanota': 'East', 'Bassi': 'East',
  'Vaishali Nagar': 'West', 'Jhotwara': 'West', 'Khatipura': 'West', 'Bagru': 'West', 'Kalwar': 'West', 'Bindayaka': 'West',
};

export const zoneOf = (area: string): Zone => ZONE_OF_AREA[area] ?? 'Central';

/** Organisations still waiting for an admin to verify their licence. */
const PENDING = new Set(['org-kalwar']);

const FIRST = ['Ramesh', 'Suresh', 'Anil', 'Vikram', 'Imran', 'Deepak', 'Manoj', 'Rakesh', 'Arjun', 'Sanjay', 'Farhan', 'Gopal', 'Harish', 'Kamal', 'Naveen', 'Pawan'];
const LAST = ['Sharma', 'Meena', 'Gupta', 'Khan', 'Singh', 'Saini', 'Jain', 'Verma', 'Yadav', 'Choudhary'];

export function buildOrgs(): Org[] {
  const rng = mulberry32(42);
  return ORG_SEEDS.map(([id, name, type, area, lat, lng, tier], i) => {
    const driverCount = type === 'blood_bank' || tier === 1 ? 2 : 1;
    const drivers: Driver[] = Array.from({ length: driverCount }, (_, d) => ({
      id: `${id}-drv${d + 1}`,
      name: `${FIRST[randInt(rng, 0, FIRST.length - 1)]} ${LAST[randInt(rng, 0, LAST.length - 1)]}`,
      phone: `+91 90000 ${String(10000 + i * 37 + d * 7).slice(-5)}`,
      orgId: id,
    }));
    return {
      id,
      name,
      type,
      area,
      location: [lat, lng],
      phone: `+91 141 400 ${String(1000 + i * 13).slice(-4)}`,
      tier,
      verified: !PENDING.has(id),
      drivers,
    };
  });
}

const COMPONENT_MIX: ComponentCode[] = ['PRBC', 'WB', 'FFP', 'PLT'];
const COMPONENT_WEIGHTS = [55, 5, 20, 20];

/** Random stock per organisation; expiry = collected + shelf life, so expiry is tracked per lot. */
export function buildInventory(orgs: Org[], now: number, seed = 7): Lot[] {
  const rng = mulberry32(seed);
  const lots: Lot[] = [];
  let n = 1;
  for (const org of orgs) {
    if (org.id === DEMO_RECEIVER_ID) {
      // the demo receiver has run out of B+ red cells — that is why it needs blood
      lots.push(lot(org.id, 'O+', 'PRBC', 2, now - 10 * DAY));
      lots.push(lot(org.id, 'A+', 'FFP', 3, now - 40 * DAY));
      continue;
    }
    const count = org.type === 'blood_bank' ? randInt(rng, 26, 38) : randInt(rng, 8, 15) + (3 - org.tier) * 4;
    for (let i = 0; i < count; i++) {
      const component = pickWeighted(rng, COMPONENT_MIX, COMPONENT_WEIGHTS);
      const group = pickWeighted(rng, BLOOD_GROUPS, BLOOD_GROUPS.map((g) => GROUP_WEIGHTS[g]));
      if (org.id === 'org-durgapura' && group === 'B+' && component === 'PRBC') continue; // demo story, see below
      const shelf = COMPONENTS[component].shelfDays * DAY;
      const age = rng() * shelf * 0.97;
      lots.push(lot(org.id, group, component, randInt(rng, 1, 4), now - age));
    }
  }

  // Demo story: the nearest hospital to St. Mira holds B+ red cells that expire in a few hours.
  // A "nearest-available" system would send them; HemoArrive skips them (they would arrive almost expired).
  lots.push({ ...lot('org-durgapura', 'B+', 'PRBC', 3, now), expiresAt: now + 9 * HOUR, collectedAt: now - 42 * DAY + 9 * HOUR });
  // Make sure a few hospitals in range really have B+ red cells for the demo request.
  lots.push(lot('org-gopalpura', 'B+', 'PRBC', 3, now - 30 * DAY));
  lots.push(lot('org-pratap', 'B+', 'PRBC', 2, now - 12 * DAY));
  lots.push(lot('org-malviya', 'B+', 'PRBC', 4, now - 20 * DAY));
  lots.push(lot('org-sitapura', 'B+', 'PRBC', 2, now - 25 * DAY));
  return lots;

  function lot(orgId: string, group: BloodGroup, component: ComponentCode, units: number, collectedAt: number): Lot {
    return {
      id: `lot-${n++}`,
      orgId,
      group,
      component,
      units,
      collectedAt,
      expiresAt: collectedAt + COMPONENTS[component].shelfDays * DAY,
      status: 'available',
    };
  }
}
