/**
 * The list a folder's "Fills in" picker offers.
 *
 * Split from `lib/fieldMapping` only because that module is unit-tested under
 * the raw `--experimental-strip-types` loader, which cannot resolve
 * extensionless imports — so it must import nothing, and the KYC field list
 * lives in `lib/kyc`. The arithmetic and the validation are there; the labels
 * are here.
 */

import { KYC_FIELDS } from './kyc';
import { DEAL_TARGET_KEYS, LEAD_TARGET_KEYS } from './fieldMapping';

export interface MappingTarget {
  /** Stored on the field: `kyc:cnic`, `deal:totalPrice`, `lead:email`. */
  value: string;
  label: string;
  group: 'Deal Entry' | 'KYC' | 'Lead';
}

const DEAL_LABELS: Record<(typeof DEAL_TARGET_KEYS)[number], string> = {
  totalPrice: 'Total Price',
  downPayment: 'Down Payment',
  adjustment: 'Adjustment',
};

const LEAD_LABELS: Record<(typeof LEAD_TARGET_KEYS)[number], string> = {
  email: 'Email',
  city: 'City',
};

/**
 * Deal fields first: on a society export they are the columns somebody most
 * wants to stop retyping, and they are the shortest group.
 */
export const MAPPING_TARGETS: MappingTarget[] = [
  ...DEAL_TARGET_KEYS.map((key) => ({
    value: `deal:${key}`,
    label: DEAL_LABELS[key],
    group: 'Deal Entry' as const,
  })),
  ...KYC_FIELDS.map((field) => ({
    value: `kyc:${field.key}`,
    label: field.label,
    group: 'KYC' as const,
  })),
  ...LEAD_TARGET_KEYS.map((key) => ({
    value: `lead:${key}`,
    label: LEAD_LABELS[key],
    group: 'Lead' as const,
  })),
];

const BY_VALUE = new Map(MAPPING_TARGETS.map((target) => [target.value, target]));

export function mappingTarget(value: string | null | undefined): MappingTarget | undefined {
  return value ? BY_VALUE.get(value) : undefined;
}

/** The groups in display order, each with its options. */
export const MAPPING_GROUPS: Array<{ group: MappingTarget['group']; options: MappingTarget[] }> = [
  'Deal Entry',
  'KYC',
  'Lead',
].map((group) => ({
  group: group as MappingTarget['group'],
  options: MAPPING_TARGETS.filter((target) => target.group === group),
}));
