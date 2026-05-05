import type { Guest, GuestInputRow, Party } from "../types";

export const GUEST_SOURCE_SIGNATURE = "json-import-only-v2";

type GuestInputRowLike = Omit<GuestInputRow, "id"> & { id?: string };

export interface ParsedData {
  guests: Map<string, Guest>;
  parties: Map<string, Party>;
  allGuestIds: string[];
  warnings: string[];
}

export function getGuestSourceSignature(): string {
  return GUEST_SOURCE_SIGNATURE;
}

function createLegacyGuestId(index: number): string {
  return `g${index}`;
}

function dedupeGuestId(preferredId: string, usedIds: Set<string>): string {
  if (!usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }

  let suffix = 1;
  while (usedIds.has(`${preferredId}-${suffix}`)) {
    suffix += 1;
  }

  const dedupedId = `${preferredId}-${suffix}`;
  usedIds.add(dedupedId);
  return dedupedId;
}

export function createGuestRowId(rows: Array<Pick<GuestInputRow, "id">>): string {
  const usedIds = new Set(rows.map((row) => row.id));
  let nextIndex = rows.length;

  while (usedIds.has(`g${nextIndex}`)) {
    nextIndex += 1;
  }

  return `g${nextIndex}`;
}

export function normalizeGuestInputRows(rawRows: GuestInputRowLike[]): GuestInputRow[] {
  const usedIds = new Set<string>();

  return rawRows.map((row, index) => {
    const trimmedId = row.id?.trim();
    const normalizedId = dedupeGuestId(trimmedId || createLegacyGuestId(index), usedIds);

    return {
      ...row,
      id: normalizedId,
    };
  });
}

export function parseGuestsFromRows(rawRows: GuestInputRow[]): ParsedData {
  const guests = new Map<string, Guest>();
  const parties = new Map<string, Party>();
  const warnings: string[] = [];
  const partyNameToPartyId = new Map<string, string>();

  rawRows.forEach((row) => {
    const guestId = row.id;

    // Get or create a stable party id keyed by party name
    let partyId: string;
    if (partyNameToPartyId.has(row.party)) {
      partyId = partyNameToPartyId.get(row.party)!;
    } else {
      partyId = `p${partyNameToPartyId.size}`;
      partyNameToPartyId.set(row.party, partyId);
    }

    const guest: Guest = {
      id: guestId,
      fullName: row.fullName,
      partyId,
      host: row.host,
      circle: row.circle,
    };
    guests.set(guestId, guest);

    if (!parties.has(partyId)) {
      parties.set(partyId, {
        id: partyId,
        party: row.party,
        circle: row.circle,
        host: row.host,
        guestIds: [],
      });
    }
    const party = parties.get(partyId)!;
    party.guestIds.push(guestId);

    if (!row.circle) {
      warnings.push(`"${row.fullName}" has no circle assigned`);
    }

    if (party.host !== row.host) {
      warnings.push(`Party "${row.party}": mixed hosts ("${party.host}", "${row.host}")`);
    }

    // Warn on mixed-circle parties (same party, different circle value)
    if (party.circle && row.circle && party.circle !== row.circle) {
      warnings.push(
        `Party "${row.party}": mixed circles ("${party.circle}", "${row.circle}")`
      );
    }
  });

  const allGuestIds = [...guests.keys()];
  return { guests, parties, allGuestIds, warnings };
}
