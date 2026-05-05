import { ChevronRight, Layers3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import React from "react";
import { cn } from "../lib/utils";
import { useDraggable } from "@dnd-kit/core";

interface Props {
  circleName: string;
  guestIds: string[];
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

const CircleCard = React.memo(function CircleCard({
  circleName,
  guestIds,
  isExpanded,
  onToggleExpanded,
}: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `circle-${circleName}`,
    data: { kind: "circle", circleName, origin: "sidebar" },
  });

  return (
    <div
      ref={setNodeRef}
      data-circle-card
      data-circle-name={circleName}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-card transition-colors hover:bg-(--card-hover-bg) hover:border-(--card-hover-border) active:cursor-grabbing",
        isDragging ? "opacity-0" : null
      )}>
      <div className="flex items-center gap-2 px-3 py-2.5 select-none">
        <button
          type="button"
          className="-m-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={
            isExpanded ? `Collapse ${circleName || "No Circle"}` : `Expand ${circleName || "No Circle"}`
          }
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
        <Layers3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {circleName || "No Circle"}
        </span>
        <Badge variant="secondary" className="h-auto rounded-sm px-1.5 py-0 text-2xs font-normal">
          {guestIds.length}
        </Badge>
      </div>
    </div>
  );
});

export default CircleCard;
