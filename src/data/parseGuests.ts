import type { Guest, GuestInputRow, Host, Party } from "../types";

import rawMd from "../../guest-list-cleaned.md?raw";

function hashGuestSource(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export const GUEST_SOURCE_SIGNATURE = hashGuestSource(rawMd);

export interface ParsedData {
  guests: Map<string, Guest>;
  parties: Map<string, Party>;
  allGuestIds: string[];
  warnings: string[];
}

function parseRawRows(): GuestInputRow[] {
  const rows: GuestInputRow[] = [];
  for (const line of rawMd.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const parts = t.split("|").map((p) => p.trim());
    // parts: ['', host, household, group, tableCol, fullName, '']
    const hostRaw = parts[1];
    if (hostRaw !== "Ryan" && hostRaw !== "Stella") continue;
    const fullName = parts[5];
    if (!fullName) continue;
    rows.push({
      host: (hostRaw === "Ryan" ? "r" : "s") as Host,
      household: parts[2],
      group: parts[3],
      fullName,
    });
  }
  return rows;
}

export function getDefaultGuestRows(): GuestInputRow[] {
  return parseRawRows().map((row) => ({ ...row }));
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

    // Party host follows Stella if any member is Stella's
    if (row.host === "s") party.host = "s";

    if (!row.group) {
      warnings.push(`"${row.fullName}" has no group assigned`);
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
