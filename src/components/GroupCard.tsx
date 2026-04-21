import type { MouseEvent, PointerEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { useMemo } from "react";
import { useSeating } from "../store/SeatingContext";

interface Props {
  groupName: string;
  guestIds: string[];
}

export default function GroupCard({ groupName, guestIds }: Props) {
  const { state, autoAssignGuestIds } = useSeating();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);
  const unassignedGuestIds = guestIds.filter((id) => unassignedSet.has(id));

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group-${groupName}`,
    data: { kind: "group", groupName, origin: "sidebar" },
  });

  function stopPropagation(event: PointerEvent | MouseEvent) {
    event.stopPropagation();
  }

  function handleAutoSeatGroup(event: MouseEvent<HTMLButtonElement>) {
    stopPropagation(event);
    if (isDragging || unassignedGuestIds.length === 0) return;
    autoAssignGuestIds(unassignedGuestIds);
  }

  return (
    <div
      ref={setNodeRef}
      className={["group-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      <div className="group-card-header" {...listeners} {...attributes}>
        <span className="group-name">{groupName || "No Group"}</span>
        <Badge
          variant="secondary"
          className="text-[11px] px-1.5 py-0 h-auto rounded-sm font-normal">
          {guestIds.length}
        </Badge>
        <button
          type="button"
          className="sidebar-quick-action"
          aria-label={`Auto-seat ${groupName || "group"}`}
          title="Auto-seat group"
          onPointerDown={stopPropagation}
          onMouseDown={stopPropagation}
          onClick={handleAutoSeatGroup}>
          <Sparkles className="sidebar-quick-action-icon" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
