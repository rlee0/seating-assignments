import GuestChip from "./GuestChip";
import type { Party } from "../types";
import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";
import { useSeating } from "../store/SeatingContext";

interface Props {
  party: Party;
}

export default function HouseholdCard({ party }: Props) {
  const { state } = useSeating();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);

  // Only carry unassigned members when dragging the whole party
  const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `party-${party.id}`,
    data: { kind: "party", partyId: party.id, origin: "sidebar" },
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "party-card rounded-lg border border-border bg-card transition-colors",
        isDragging ? "is-dragging" : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      <div
        className="party-card-header flex min-w-0 cursor-grab items-center gap-2 px-3 py-2.5 select-none active:cursor-grabbing"
        {...listeners}
        {...attributes}>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-card-foreground">
          {party.household}
        </span>
      </div>
      <div className="party-members flex flex-wrap gap-1 px-3 pb-2">
        {unassignedGuestIds.map((id) => (
          <GuestChip key={id} guestId={id} context="sidebar" />
        ))}
      </div>
    </div>
  );
}
