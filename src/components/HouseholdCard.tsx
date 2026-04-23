import GuestChip from "./GuestChip";
import type { Party } from "../types";
import { cn } from "../lib/utils";
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

  const containerListeners = {
    ...listeners,
    onPointerDown: (event: React.PointerEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onPointerDown?.(event);
    },
    onMouseDown: (event: React.MouseEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onMouseDown?.(event);
    },
    onTouchStart: (event: React.TouchEvent) => {
      if ((event.target as Element).closest("[data-guest-chip]")) return;
      listeners?.onTouchStart?.(event);
    },
  };

  return (
    <div
      ref={setNodeRef}
      data-household-card
      data-party-id={party.id}
      {...containerListeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-card transition-colors hover:bg-(--card-hover-bg) hover:border-(--card-hover-border) active:cursor-grabbing",
        isDragging ? "opacity-0" : null
      )}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5 select-none">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
          {party.household}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 px-3 pt-1 pb-2.5">
        {unassignedGuestIds.map((id) => (
          <GuestChip key={id} guestId={id} context="sidebar" />
        ))}
      </div>
    </div>
  );
}
