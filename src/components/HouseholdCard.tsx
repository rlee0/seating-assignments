import { ChevronRight, House } from "lucide-react";

import GuestChip from "./GuestChip";
import type { Party } from "../types";
import React from "react";
import { cn } from "../lib/utils";
import { useDraggable } from "@dnd-kit/core";

interface Props {
  party: Party;
  unassignedSet: Set<string>;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

const HouseholdCard = React.memo(function HouseholdCard({
  party,
  unassignedSet,
  onEditGuest,
  onDeleteGuest,
  isExpanded,
  onToggleExpanded,
}: Props) {
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
        <button
          type="button"
          className="-m-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={isExpanded ? `Collapse ${party.household}` : `Expand ${party.household}`}
          aria-expanded={isExpanded}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleExpanded();
          }}>
          <ChevronRight
            className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
            aria-hidden="true"
          />
        </button>
        <House className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-card-foreground">
          {party.household}
        </span>
      </div>
      {isExpanded ? (
        <div className="flex flex-wrap gap-1 px-3 pt-1 pb-2.5">
          {unassignedGuestIds.map((id) => (
            <GuestChip
              key={id}
              guestId={id}
              context="sidebar"
              onEditGuest={onEditGuest}
              onDeleteGuest={onDeleteGuest}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

export default HouseholdCard;
