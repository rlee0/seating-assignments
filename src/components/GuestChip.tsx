import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

interface Props {
  guestId: string;
  context: "sidebar" | "table";
}

export default function GuestChip({ guestId, context }: Props) {
  const { guests } = useSeating();
  const { searchQuery } = useSearch();
  const guest = guests.get(guestId);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `guest-${guestId}`,
    data: { kind: "guest", guestId },
  });

  if (!guest) return null;

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "guest-chip",
        `guest-chip--${context}`,
        isDragging ? "is-dragging" : null,
        searchQuery.trim() &&
        guest?.fullName.toLowerCase().includes(searchQuery.trim().toLowerCase())
          ? "is-search-match"
          : null,
      ]
        .filter(Boolean)
        .join(" ")}
      title={guest.fullName}
      {...listeners}
      {...attributes}>
      <span className={`rsvp-dot rsvp-${guest.rsvp}`} />
      <span className="guest-name">{guest.fullName}</span>
    </div>
  );
}
