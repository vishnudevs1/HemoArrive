// Blood groups, components and the compatibility table.
// The table is configuration owned by the transfusion officer — the app never auto-substitutes.

export const BLOOD_GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export type ComponentCode = 'PRBC' | 'WB' | 'FFP' | 'PLT';

export const COMPONENTS: Record<ComponentCode, { label: string; short: string; shelfDays: number; marginHours: number }> = {
  PRBC: { label: 'Red cells (PRBC)', short: 'Red cells', shelfDays: 42, marginHours: 24 },
  WB: { label: 'Whole blood', short: 'Whole blood', shelfDays: 35, marginHours: 24 },
  FFP: { label: 'Plasma (FFP)', short: 'Plasma', shelfDays: 365, marginHours: 24 },
  PLT: { label: 'Platelets', short: 'Platelets', shelfDays: 5, marginHours: 6 },
};
export const COMPONENT_CODES = Object.keys(COMPONENTS) as ComponentCode[];

/** Safe temperature on arrival (°C): red cells and whole blood 1–10, platelets 20–24, plasma frozen at −18 or colder. */
export const TRANSPORT_TEMP: Record<ComponentCode, { min: number; max: number; typical: number }> = {
  PRBC: { min: 1, max: 10, typical: 4.5 },
  WB: { min: 1, max: 10, typical: 4.5 },
  PLT: { min: 20, max: 24, typical: 22 },
  FFP: { min: -60, max: -18, typical: -20 },
};

export const tempInRange = (component: ComponentCode, t: number) => t >= TRANSPORT_TEMP[component].min && t <= TRANSPORT_TEMP[component].max;

/** ABO mix from a Delhi study (n = 16,925): B 37.7%, O 29.3%, A 23.1%, AB 10.0%; Rh-negative ≈ 5%. */
export const GROUP_WEIGHTS: Record<BloodGroup, number> = {
  'B+': 37.7 * 0.95, 'B-': 37.7 * 0.05,
  'O+': 29.3 * 0.95, 'O-': 29.3 * 0.05,
  'A+': 23.1 * 0.95, 'A-': 23.1 * 0.05,
  'AB+': 10.0 * 0.95, 'AB-': 10.0 * 0.05,
};

const abo = (g: BloodGroup) => g.replace(/[+-]$/, '');
const rhNeg = (g: BloodGroup) => g.endsWith('-');

/**
 * Donor groups a recipient can take for a component, best first.
 * Index 0 is always the identical group (rank 1); the rest are compatible substitutes (rank 2).
 */
export function compatibleDonors(component: ComponentCode, recipient: BloodGroup): BloodGroup[] {
  const others = BLOOD_GROUPS.filter((g) => g !== recipient);
  let allowed: BloodGroup[];
  if (component === 'WB') {
    allowed = []; // whole blood: identical group only
  } else if (component === 'PRBC') {
    allowed = others.filter((d) => {
      const okAbo = abo(d) === 'O' || abo(d) === abo(recipient) || abo(recipient) === 'AB';
      const okRh = rhNeg(d) || !rhNeg(recipient);
      return okAbo && okRh;
    });
  } else if (component === 'FFP') {
    // plasma is reversed: AB plasma suits everyone, O plasma suits only O
    allowed = others.filter((d) => abo(d) === 'AB' || abo(d) === abo(recipient) || abo(recipient) === 'O');
  } else {
    // platelets: identical preferred, others a soft option; Rh-negative recipients only get Rh-negative
    allowed = others.filter((d) => !rhNeg(recipient) || rhNeg(d));
  }
  return [recipient, ...allowed];
}

export function isCompatible(component: ComponentCode, recipient: BloodGroup, donor: BloodGroup): boolean {
  return compatibleDonors(component, recipient).includes(donor);
}

/** Rare stock that should be kept for patients who truly need it. */
export function isRare(component: ComponentCode, donor: BloodGroup): boolean {
  if (component === 'PRBC' || component === 'WB') return donor === 'O-';
  if (component === 'FFP') return abo(donor) === 'AB';
  return rhNeg(donor);
}
