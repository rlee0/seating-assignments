import { Badge } from "@/components/ui/badge";
import { Layers3 } from "lucide-react";
import { cn } from "../lib/utils";
import { useDraggable } from "@dnd-kit/core";

interface Props {
  groupName: string;
  guestIds: string[];
}

export default function GroupCard({ groupName, guestIds }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `group-${groupName}`,
    data: { kind: "group", groupName, origin: "sidebar" },
  });

  return (
    <div
      ref={setNodeRef}
      data-group-card
      data-group-name={groupName}
      {...listeners}
      {...attributes}
      className={cn(
        "cursor-grab rounded-lg border border-border bg-card transition-colors hover:bg-(--card-hover-bg) hover:border-(--card-hover-border) active:cursor-grabbing",
        isDragging ? "opacity-0" : null
      )}>
      <div className="flex items-center gap-2 px-3 py-2.5 select-none">
        <Layers3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {groupName || "No Group"}
        </span>
        <Badge variant="secondary" className="h-auto rounded-sm px-1.5 py-0 text-2xs font-normal">
          {guestIds.length}
        </Badge>
      </div>
    </div>
  );
}
