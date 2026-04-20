import GroupCard from "./GroupCard";
import PartyCard from "./PartyCard";
import { useDroppable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";

export default function Sidebar() {
  const { state, parties } = useSeating();
  const unassignedSet = new Set(state.unassigned);

  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });

  // Show parties that still have at least one unassigned member
  const partiesWithUnassigned = [...parties.values()].filter((party) =>
    party.guestIds.some((id) => unassignedSet.has(id))
  );

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
      <div
        ref={setNodeRef}
        className={["sidebar-dropzone", isOver ? "is-over" : null].filter(Boolean).join(" ")}>
        {partiesWithUnassigned.length === 0 ? (
          <div className="sidebar-empty">All guests are seated ✓</div>
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
