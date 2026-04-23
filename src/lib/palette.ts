export type HighlightDomain = "group" | "household" | "host" | "default";

export interface DomainCounts {
  group: number;
  household: number;
  host: number;
}

export interface PaletteSlot {
  hue: number;
  tier: number;
}

export interface DomainPalette {
  domain: HighlightDomain;
  slots: PaletteSlot[];
  distinctHueCount: number;
}

const GOLDEN_ANGLE = 137.508;
const TONE_PATTERN = [0, 1, -1, 2, -2, 3, -3, 4, -4];

const DISTINCT_HUE_CAPACITY: Record<HighlightDomain, number> = {
  group: 20,
  household: 120,
  host: 24,
  default: 20,
};

const DOMAIN_SEED: Record<HighlightDomain, number> = {
  group: 11,
  household: 17,
  host: 7,
  default: 11,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hashToken(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function getDomainFromToken(token: string): HighlightDomain {
  const separatorIndex = token.indexOf(":");
  if (separatorIndex < 0) return "default";

  const domain = token.slice(0, separatorIndex);
  if (domain === "group" || domain === "household" || domain === "host") return domain;
  return "default";
}

function buildHueOrder(domain: HighlightDomain, distinctHueCount: number): number[] {
  if (distinctHueCount <= 0) return [0];

  const huePool = Array.from({ length: distinctHueCount }, (_, index) =>
    Math.round((index * GOLDEN_ANGLE) % 360)
  );

  const seed = DOMAIN_SEED[domain] % distinctHueCount;
  const step = seed === 0 ? 1 : seed;

  return Array.from({ length: distinctHueCount }, (_, index) => {
    const orderedIndex = (index * step) % distinctHueCount;
    return huePool[orderedIndex];
  });
}

function getTierOffset(tier: number): number {
  if (tier < TONE_PATTERN.length) return TONE_PATTERN[tier];

  const loopedIndex = tier % TONE_PATTERN.length;
  const growth = Math.floor(tier / TONE_PATTERN.length);
  const sign = loopedIndex % 2 === 0 ? 1 : -1;
  return TONE_PATTERN[loopedIndex] + growth * sign;
}

function buildDomainPalette(domain: HighlightDomain, count: number): DomainPalette {
  const normalizedCount = Math.max(1, count);
  const capacity = DISTINCT_HUE_CAPACITY[domain] ?? DISTINCT_HUE_CAPACITY.default;
  const distinctHueCount = Math.min(normalizedCount, capacity);
  const hueOrder = buildHueOrder(domain, distinctHueCount);
  const tierCount = Math.ceil(normalizedCount / distinctHueCount);

  const slots: PaletteSlot[] = [];
  for (let tier = 0; tier < tierCount; tier += 1) {
    for (let index = 0; index < hueOrder.length; index += 1) {
      if (slots.length >= normalizedCount) break;
      slots.push({ hue: hueOrder[index], tier });
    }
  }

  return {
    domain,
    slots,
    distinctHueCount,
  };
}

export function createHighlightPalettes(
  counts: DomainCounts
): Record<HighlightDomain, DomainPalette> {
  return {
    group: buildDomainPalette("group", counts.group),
    household: buildDomainPalette("household", counts.household),
    host: buildDomainPalette("host", counts.host),
    default: buildDomainPalette("default", counts.group),
  };
}

export function assignTokenSlots(
  tokens: string[],
  palette: DomainPalette
): Map<string, PaletteSlot> {
  const sortedTokens = [...new Set(tokens)].sort((left, right) => left.localeCompare(right));
  const slots = palette.slots.length > 0 ? palette.slots : [{ hue: 0, tier: 0 }];
  const usedIndexes = new Set<number>();
  const assignments = new Map<string, PaletteSlot>();

  for (const token of sortedTokens) {
    const start = hashToken(token) % slots.length;
    let selectedIndex = start;

    for (let offset = 0; offset < slots.length; offset += 1) {
      const candidateIndex = (start + offset) % slots.length;
      if (!usedIndexes.has(candidateIndex)) {
        selectedIndex = candidateIndex;
        break;
      }
    }

    assignments.set(token, slots[selectedIndex]);
    usedIndexes.add(selectedIndex);
  }

  return assignments;
}

export function buildHighlightColor(slot: PaletteSlot): {
  background: string;
  border: string;
  solid: string;
} {
  const offset = getTierOffset(slot.tier);
  const saturationBoost = Math.min(Math.abs(offset) * 0.008, 0.035);

  const backgroundL = clamp(0.88 + offset * 0.04, 0.68, 0.96);
  const borderL = clamp(0.72 + offset * 0.035, 0.5, 0.86);
  const solidL = clamp(0.62 + offset * 0.03, 0.42, 0.78);

  const backgroundC = clamp(0.1 + saturationBoost, 0.08, 0.2);
  const borderC = clamp(0.15 + saturationBoost, 0.1, 0.24);
  const solidC = clamp(0.17 + saturationBoost, 0.12, 0.27);

  return {
    background: `oklch(${backgroundL} ${backgroundC} ${slot.hue})`,
    border: `oklch(${borderL} ${borderC} ${slot.hue})`,
    solid: `oklch(${solidL} ${solidC} ${slot.hue})`,
  };
}
