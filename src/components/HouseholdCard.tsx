import GuestChip from "./GuestChip";
import type { Party } from "../types";
import { useDraggable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";

interface Props {
  party: Party;
}

export default function HouseholdCard({ party }: Props) {
  const { state } = useSeating();
  const unassignedSet = new Set(state.unassigned);

  // Only carry unassigned members when dragging the whole party
  const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `party-${party.id}`,
    data: { kind: "party", partyId: party.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title="Drag to move all unassigned members"
      className={["party-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      <div className="party-card-header">
        <span className="party-name">{party.household}</span>
      </div>
      <div className="party-members">
        {unassignedGuestIds.map((id) => (
          <GuestChip key={id} guestId={id} context="sidebar" />
        ))}
      </div>
    </div>
  );
}
