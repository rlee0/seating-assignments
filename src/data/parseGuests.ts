import type { Guest, GuestInputRow, Party } from "../types";

export const GUEST_SOURCE_SIGNATURE = "json-import-only-v2";

export interface ParsedData {
  guests: Map<string, Guest>;
  parties: Map<string, Party>;
  allGuestIds: string[];
  warnings: string[];
}

export function getGuestSourceSignature(): string {
  return GUEST_SOURCE_SIGNATURE;
}

export function parseGuestsFromRows(rawRows: GuestInputRow[]): ParsedData {
  const guests = new Map<string, Guest>();
  const parties = new Map<string, Party>();
  const warnings: string[] = [];
  const householdToPartyId = new Map<string, string>();

  rawRows.forEach((row, i) => {
    const guestId = `g${i}`;

    // Get or create a stable party id keyed by household
    let partyId: string;
    if (householdToPartyId.has(row.household)) {
      partyId = householdToPartyId.get(row.household)!;
    } else {
      partyId = `p${householdToPartyId.size}`;
      householdToPartyId.set(row.household, partyId);
    }

    const guest: Guest = {
      id: guestId,
      fullName: row.fullName,
      partyId,
      host: row.host,
      group: row.group,
    };
    guests.set(guestId, guest);

    if (!parties.has(partyId)) {
      parties.set(partyId, {
        id: partyId,
        household: row.household,
        group: row.group,
        host: row.host,
        guestIds: [],
      });
    }
    const party = parties.get(partyId)!;
    party.guestIds.push(guestId);

    if (!row.group) {
      warnings.push(`"${row.fullName}" has no group assigned`);
    }

    if (party.host !== row.host) {
      warnings.push(`Household "${row.household}": mixed hosts ("${party.host}", "${row.host}")`);
    }

    // Warn on mixed-group households (same household, different group value)
    if (party.group && row.group && party.group !== row.group) {
      warnings.push(
        `Household "${row.household}": mixed groups ("${party.group}", "${row.group}")`
      );
    }
  });

  const allGuestIds = [...guests.keys()];
  return { guests, parties, allGuestIds, warnings };
}
