import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";

interface Props {
  groupName: string;
  guestIds: string[];
}

export default function GroupCard({ groupName, guestIds }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `group-${groupName}`,
    data: { kind: "group", groupName },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={["group-card", isDragging ? "is-dragging" : null].filter(Boolean).join(" ")}>
      <div className="group-card-header" {...listeners} {...attributes}>
        <span className="group-name">{groupName || "No Group"}</span>
        <span className="group-count">{guestIds.length}</span>
      </div>
    </div>
  );
}
