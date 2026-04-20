import { useCallback, useEffect, useMemo, useRef } from "react";

import GroupCard from "./GroupCard";
import HouseholdCard from "./HouseholdCard";
import { useDroppable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

function normalizeForSearch(str: string): string {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function Sidebar() {
  const { state, parties, guests, selectedGuestId } = useSeating();
  const { searchQuery, setSearchQuery } = useSearch();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery.trim()), [searchQuery]);

  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  const dropzoneRef = useRef<HTMLDivElement | null>(null);

  const setDropzoneRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      dropzoneRef.current = node;
    },
    [setNodeRef]
  );

  useEffect(() => {
    const element = dropzoneRef.current;
    if (!element) return;

    const lockHorizontalScroll = () => {
      if (element.scrollLeft !== 0) {
        element.scrollLeft = 0;
      }
    };

    lockHorizontalScroll();
    element.addEventListener("scroll", lockHorizontalScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", lockHorizontalScroll);
    };
  }, []);

  // Show parties that still have at least one unassigned member
  const partiesWithUnassigned = [...parties.values()].filter((party) => {
    const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

    if (unassignedGuestIds.length === 0) return false;
    if (!normalizedQuery) return true;

    if (normalizeForSearch(party.household).includes(normalizedQuery)) return true;
    if (normalizeForSearch(party.group || "No Group").includes(normalizedQuery)) return true;

    return unassignedGuestIds.some((id) => {
      const guest = guests.get(id);
      return guest && normalizeForSearch(guest.fullName).includes(normalizedQuery);
    });
  });

  const groupedParties = new Map<string, typeof partiesWithUnassigned>();
  const groupedGuestIds = new Map<string, string[]>();

  for (const party of partiesWithUnassigned) {
    const groupName = party.group || "No Group";
    const groupParties = groupedParties.get(groupName) ?? [];
    groupParties.push(party);
    groupedParties.set(groupName, groupParties);

    const existingGuestIds = groupedGuestIds.get(groupName) ?? [];
    const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
    groupedGuestIds.set(groupName, [...existingGuestIds, ...unassignedGuestIds]);
  }

  const sortedGroups = [...groupedParties.keys()];
  const selectedGuest = selectedGuestId ? (guests.get(selectedGuestId) ?? null) : null;
  const selectedGuestParty = selectedGuest ? (parties.get(selectedGuest.partyId) ?? null) : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-search-row">
        <div className="sidebar-search-wrap">
          <svg
            className="sidebar-search-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            className="sidebar-search-input"
            placeholder="Search guests, tables, groups"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search unassigned guests, tables, and groups"
          />
        </div>
      </div>
      <div
        ref={setDropzoneRef}
        className={["sidebar-dropzone", isOver ? "is-over" : null].filter(Boolean).join(" ")}>
        {state.unassigned.length === 0 ? (
          <div className="sidebar-empty">All guests are seated ✓</div>
        ) : partiesWithUnassigned.length === 0 ? (
          <div className="sidebar-empty">No unassigned matches for "{searchQuery.trim()}"</div>
        ) : (
          sortedGroups.map((groupName) => (
            <div key={groupName} className="group-section">
              <GroupCard groupName={groupName} guestIds={groupedGuestIds.get(groupName) ?? []} />
              <div className="group-party-list">
                {groupedParties.get(groupName)?.map((party) => (
                  <HouseholdCard key={party.id} party={party} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {selectedGuest && (
        <section
          className="sidebar-selected-guest"
          aria-live="polite"
          aria-label="Selected guest details">
          <p className="sidebar-selected-guest-name">{selectedGuest.fullName}</p>
          <dl className="sidebar-selected-guest-meta">
            <div>
              <dt>Household</dt>
              <dd>{selectedGuestParty?.household ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{selectedGuest.group || "No Group"}</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd>{selectedGuest.host === "r" ? "Ryan" : "Stella"}</dd>
            </div>
          </dl>
        </section>
      )}
    </aside>
  );
}
