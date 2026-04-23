import { Badge } from "@/components/ui/badge";
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
      className={[
        "group-card rounded-lg border border-border bg-card transition-colors",
        isDragging ? "is-dragging" : null,
      ]
        .filter(Boolean)
        .join(" ")}>
      <div
        className="group-card-header flex cursor-grab items-center gap-2 px-3 py-2.5 select-none active:cursor-grabbing"
        {...listeners}
        {...attributes}>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {groupName || "No Group"}
        </span>
        <Badge variant="secondary" className="h-auto rounded-sm px-1.5 py-0 text-[11px] font-normal">
          {guestIds.length}
        </Badge>
      </div>
    </div>
  );
}
