import { useEffect, useRef, useState } from "react";

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
  const {
    guests,
    selectedGuestId,
    selectGuest,
    clearSelectedGuest,
    relatedHouseholdGuestIds,
    relatedGroupGuestIds,
  } = useSeating();
  const { searchQuery } = useSearch();
  const guestNameRef = useRef<HTMLSpanElement | null>(null);
  const [isNameTruncated, setIsNameTruncated] = useState(false);
  const guest = guests.get(guestId);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `guest-${guestId}`,
    data: { kind: "guest", guestId },
  });

  useEffect(() => {
    if (!guest || context !== "table") {
      setIsNameTruncated(false);
      return;
    }

    const node = guestNameRef.current;
    if (!node) return;

    const updateIsTruncated = () => {
      setIsNameTruncated(node.scrollWidth > node.clientWidth + 1);
    };

    updateIsTruncated();

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(updateIsTruncated);
      resizeObserver.observe(node);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener("resize", updateIsTruncated);
    return () => window.removeEventListener("resize", updateIsTruncated);
  }, [context, guest, selectedGuestId]);

  if (!guest) return null;

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const relationClass =
    selectedGuestId === guestId
      ? "is-selected"
      : relatedHouseholdGuestIds.has(guestId)
        ? "is-related-household"
        : relatedGroupGuestIds.has(guestId)
          ? "is-related-group"
          : null;

  function handleSelectGuest() {
    if (isDragging) return;
    if (selectedGuestId === guestId) {
      clearSelectedGuest();
    } else {
      selectGuest(guestId);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "guest-chip",
        `guest-chip--${context}`,
        className,
        relationClass,
        isDragging ? "is-dragging" : null,
        searchQuery.trim() &&
        normalizeForSearch(guest.fullName).includes(normalizeForSearch(searchQuery.trim()))
          ? "is-search-match"
          : null,
      ]
        .filter(Boolean)
        .join(" ")}
      title={guest.fullName}
      onClick={handleSelectGuest}
      {...listeners}
      {...attributes}>
      <span
        ref={guestNameRef}
        className={[
          "guest-name",
          `guest-name--host-${guest.host.toLowerCase()}`,
          context === "table" && isNameTruncated ? "is-truncated" : null,
        ]
          .filter(Boolean)
          .join(" ")}>
        {guest.fullName}
      </span>
    </div>
  );
}
