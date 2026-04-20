import GroupCard from "./GroupCard";
import PartyCard from "./PartyCard";
import { useDroppable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

export default function Sidebar() {
  const { state, parties, guests } = useSeating();
  const { searchQuery, setSearchQuery } = useSearch();
  const unassignedSet = new Set(state.unassigned);
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });

  // Show parties that still have at least one unassigned member
  const partiesWithUnassigned = [...parties.values()].filter((party) => {
    const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

    if (unassignedGuestIds.length === 0) return false;
    if (!normalizedQuery) return true;

    if (party.household.toLowerCase().includes(normalizedQuery)) return true;
    if ((party.group || "No Group").toLowerCase().includes(normalizedQuery)) return true;

    return unassignedGuestIds.some((id) => {
      const guest = guests.get(id);
      return guest?.fullName.toLowerCase().includes(normalizedQuery);
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

  const sortedGroups = [...groupedParties.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Unassigned</span>
        <span className="sidebar-count">{state.unassigned.length}</span>
      </div>
      <div className="sidebar-search-row">
        <input
          type="search"
          className="sidebar-search-input"
          placeholder="Search guests, tables, groups"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label="Search unassigned guests, tables, and groups"
        />
      </div>
      <div
        ref={setNodeRef}
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
                  <PartyCard key={party.id} party={party} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
