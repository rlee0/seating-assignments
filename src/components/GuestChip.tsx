import { CSS } from "@dnd-kit/utilities";
import { useDraggable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

function normalizeForSearch(str: string): string {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface Props {
  guestId: string;
  context: "sidebar" | "table";
  className?: string;
}

export default function GuestChip({ guestId, context, className }: Props) {
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
        className,
        isDragging ? "is-dragging" : null,
        searchQuery.trim() &&
        normalizeForSearch(guest.fullName).includes(normalizeForSearch(searchQuery.trim()))
          ? "is-search-match"
          : null,
      ]
        .filter(Boolean)
        .join(" ")}
      title={guest.fullName}
      {...listeners}
      {...attributes}>
      <span className={`guest-name guest-name--host-${guest.host}`}>{guest.fullName}</span>
    </div>
  );
}
