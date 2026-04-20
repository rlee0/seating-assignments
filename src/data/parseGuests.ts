import type { Guest, Party, RSVPStatus } from "../types";

import rawMd from "../../guest-list-cleaned.md?raw";

export interface ParsedData {
  guests: Map<string, Guest>;
  parties: Map<string, Party>;
  allGuestIds: string[];
  warnings: string[];
}

interface RawRow {
  rsvp: RSVPStatus;
  displayName: string;
  group: string;
  fullName: string;
}

function parseRawRows(): RawRow[] {
  const rows: RawRow[] = [];
  for (const line of rawMd.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const parts = t.split("|").map((p) => p.trim());
    // parts: ['', sr, displayName, group, tableCol, fullName, '']
    const sr = parts[1];
    if (sr !== "r" && sr !== "s") continue;
    const fullName = parts[5];
    if (!fullName) continue;
    rows.push({
      rsvp: sr as RSVPStatus,
      displayName: parts[2],
      group: parts[3],
      fullName,
    });
  }
  return rows;
}

export function parseGuests(): ParsedData {
  const rawRows = parseRawRows();
  const guests = new Map<string, Guest>();
  const parties = new Map<string, Party>();
  const warnings: string[] = [];
  const displayNameToPartyId = new Map<string, string>();

  rawRows.forEach((row, i) => {
    const guestId = `g${i}`;

    // Get or create a stable party id keyed by display name
    let partyId: string;
    if (displayNameToPartyId.has(row.displayName)) {
      partyId = displayNameToPartyId.get(row.displayName)!;
    } else {
      partyId = `p${displayNameToPartyId.size}`;
      displayNameToPartyId.set(row.displayName, partyId);
    }

    const guest: Guest = {
      id: guestId,
      fullName: row.fullName,
      partyId,
      rsvp: row.rsvp,
      group: row.group,
    };
    guests.set(guestId, guest);

    if (!parties.has(partyId)) {
      parties.set(partyId, {
        id: partyId,
        displayName: row.displayName,
        group: row.group || "—",
        rsvp: row.rsvp,
        guestIds: [],
      });
    }
    const party = parties.get(partyId)!;
    party.guestIds.push(guestId);

    // Party is pending if any member is pending
    if (row.rsvp === "s") party.rsvp = "s";

    if (!row.group) {
      warnings.push(`"${row.fullName}" has no group assigned`);
    }

    // Warn on mixed-group parties (same display name, different group value)
    if (party.group && party.group !== "—" && row.group && party.group !== row.group) {
      warnings.push(`Party "${row.displayName}": mixed groups ("${party.group}", "${row.group}")`);
    }
  });

  const allGuestIds = [...guests.keys()];
  return { guests, parties, allGuestIds, warnings };
}
