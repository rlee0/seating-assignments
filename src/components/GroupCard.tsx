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
      className={["group-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      <div className="group-card-header" {...listeners} {...attributes}>
        <span className="group-name">{groupName || "No Group"}</span>
        <Badge
          variant="secondary"
          className="text-[11px] px-1.5 py-0 h-auto rounded-sm font-normal">
          {guestIds.length}
        </Badge>
      </div>
    </div>
  );
}
