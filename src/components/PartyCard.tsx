import { CSS } from "@dnd-kit/utilities";
import GuestChip from "./GuestChip";
import type { Party } from "../types";
import { useDraggable } from "@dnd-kit/core";
import { useSeating } from "../store/SeatingContext";

interface Props {
  party: Party;
}

export default function PartyCard({ party }: Props) {
  const { state } = useSeating();
  const unassignedSet = new Set(state.unassigned);

  // Only carry unassigned members when dragging the whole party
  const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `party-${party.id}`,
    data: { kind: "party", partyId: party.id },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={["party-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      {/* Drag handle is the header row */}
      <div
        className="party-card-header"
        {...listeners}
        {...attributes}
        title="Drag to move all unassigned members">
        <span className="party-name">{party.displayName}</span>
        <span
          className={`rsvp-dot rsvp-${party.rsvp}`}
          title={party.rsvp === "r" ? "RSVP confirmed" : "Pending"}
        />
      </div>
      <div className="party-members">
        {unassignedGuestIds.map((id) => (
          <GuestChip key={id} guestId={id} context="sidebar" />
        ))}
      </div>
    </div>
  );
}
