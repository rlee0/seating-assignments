import type { MouseEvent, PointerEvent } from "react";

import GuestChip from "./GuestChip";
import { Sparkles } from "lucide-react";
import type { Party } from "../types";
import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";
import { useSeating } from "../store/SeatingContext";

interface Props {
  party: Party;
}

export default function HouseholdCard({ party }: Props) {
  const { state, autoAssignGuestIds } = useSeating();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);

  // Only carry unassigned members when dragging the whole party
  const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `party-${party.id}`,
    data: { kind: "party", partyId: party.id, origin: "sidebar" },
  });

  function stopGuestChipAction(event: PointerEvent | MouseEvent) {
    event.stopPropagation();
  }

  function handleAutoSeatHousehold(event: MouseEvent<HTMLButtonElement>) {
    stopGuestChipAction(event);
    if (isDragging || unassignedGuestIds.length === 0) return;
    autoAssignGuestIds(unassignedGuestIds);
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={["party-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      <div className="party-card-header">
        <span className="party-name">{party.household}</span>
        <button
          type="button"
          className="sidebar-quick-action"
          aria-label={`Auto-seat ${party.household}`}
          title="Auto-seat household"
          onPointerDown={stopGuestChipAction}
          onMouseDown={stopGuestChipAction}
          onClick={handleAutoSeatHousehold}>
          <Sparkles className="sidebar-quick-action-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="party-members">
        {unassignedGuestIds.map((id) => (
          <GuestChip key={id} guestId={id} context="sidebar" />
        ))}
      </div>
    </div>
  );
}
