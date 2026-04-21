import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { CSS } from "@dnd-kit/utilities";
import { guestChipVariants } from "@/components/ui/chip";
import { useDraggable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

function normalizeForSearch(str: string): string {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const UNIQUE_HUE_COUNT = 360;
const HUE_STEP = 137;

const hueOrder = Array.from(
  { length: UNIQUE_HUE_COUNT },
  (_, i) => (i * HUE_STEP) % UNIQUE_HUE_COUNT
);

const tokenHueByDomain = new Map<string, Map<string, number>>();
const usedHuesByDomain = new Map<string, Set<number>>();

function getTokenHue(token: string): number {
  const separatorIndex = token.indexOf(":");
  const domain = separatorIndex > -1 ? token.slice(0, separatorIndex) : "default";

  const tokenHueMap = tokenHueByDomain.get(domain) ?? new Map<string, number>();
  tokenHueByDomain.set(domain, tokenHueMap);

  const existingHue = tokenHueMap.get(token);
  if (existingHue !== undefined) return existingHue;

  const usedHues = usedHuesByDomain.get(domain) ?? new Set<number>();
  usedHuesByDomain.set(domain, usedHues);

  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash << 5) - hash + token.charCodeAt(index);
    hash |= 0;
  }

  const start = Math.abs(hash) % UNIQUE_HUE_COUNT;
  let selectedHue = hueOrder[start];

  for (let offset = 0; offset < UNIQUE_HUE_COUNT; offset += 1) {
    const candidateHue = hueOrder[(start + offset) % UNIQUE_HUE_COUNT];
    if (!usedHues.has(candidateHue)) {
      selectedHue = candidateHue;
      break;
    }
  }

  tokenHueMap.set(token, selectedHue);
  usedHues.add(selectedHue);
  return selectedHue;
}

function getHighlightColor(token: string): { background: string; border: string } {
  const hue = getTokenHue(token);
  return {
    background: `hsl(${hue} 78% 85%)`,
    border: `hsl(${hue} 58% 64%)`,
  };
}

interface Props {
  guestId: string;
  context: "sidebar" | "table";
  className?: string;
  suppressStateStyles?: boolean;
}

export default function GuestChip({
  guestId,
  context,
  className,
  suppressStateStyles = false,
}: Props) {
  const {
    guests,
    selectedGuestId,
    selectGuest,
    clearSelectedGuest,
    relatedHouseholdGuestIds,
    relatedGroupGuestIds,
  } = useSeating();
  const { searchQuery, isGroupHighlightOn, isHouseholdHighlightOn, isHostHighlightOn } =
    useSearch();
  const guestNameRef = useRef<HTMLSpanElement | null>(null);
  const [isNameTruncated, setIsNameTruncated] = useState(false);
  const guest = guests.get(guestId);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `guest-${guestId}`,
    data: { kind: "guest", guestId, origin: context },
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

  // When DragOverlay is active it owns the visual movement; don't also move the original element.
  const style: CSSProperties & Record<string, string> = {};
  if (!isDragging && transform) {
    style.transform = CSS.Translate.toString(transform);
  }

  const highlightToken =
    context === "table"
      ? isHostHighlightOn
        ? `host:${guest.host || "Unknown"}`
        : isHouseholdHighlightOn
          ? `household:${guest.partyId}`
          : isGroupHighlightOn
            ? `group:${guest.group || "No Group"}`
            : null
      : null;

  let highlightClass: string | null = null;
  if (highlightToken) {
    const { background, border } = getHighlightColor(highlightToken);
    style["--guest-chip-highlight-bg"] = background;
    style["--guest-chip-highlight-border"] = border;
    highlightClass = "is-highlighted";
  }

  const hasInlineStyle = Object.keys(style).length > 0;
  const relationClasses: string[] = [];
  if (!suppressStateStyles) {
    const isSelected = selectedGuestId === guestId;
    const isRelatedHousehold = relatedHouseholdGuestIds.has(guestId);
    const isRelatedGroup = relatedGroupGuestIds.has(guestId);

    if (isSelected) {
      relationClasses.push("is-selected");
    } else if (isRelatedHousehold && isRelatedGroup) {
      relationClasses.push("is-related-household", "is-related-group", "is-related-both");
    } else if (isRelatedHousehold) {
      relationClasses.push("is-related-household");
    } else if (isRelatedGroup) {
      relationClasses.push("is-related-group");
    } else if (selectedGuestId) {
      relationClasses.push("is-dimmed");
    }
  }

  const isSearchMatch =
    !suppressStateStyles &&
    searchQuery.trim() &&
    normalizeForSearch(guest.fullName).includes(normalizeForSearch(searchQuery.trim()));

  const visualState = relationClasses.includes("is-selected")
    ? "selected"
    : relationClasses.includes("is-related-both")
      ? "relatedBoth"
      : relationClasses.includes("is-related-household")
        ? "relatedHousehold"
        : relationClasses.includes("is-related-group")
          ? "relatedGroup"
          : highlightClass
            ? "highlighted"
            : isSearchMatch
              ? "searchMatch"
              : "default";

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
      style={hasInlineStyle ? style : undefined}
      className={[
        "guest-chip",
        `guest-chip--${context}`,
        guestChipVariants({ state: visualState, context }),
        className,
        highlightClass,
        ...relationClasses,
        isDragging ? "is-dragging" : null,
        isSearchMatch ? "is-search-match" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      title={guest.fullName}
      onClick={handleSelectGuest}
      {...listeners}
      {...attributes}>
      <span
        ref={guestNameRef}
        className={["guest-name", context === "table" && isNameTruncated ? "is-truncated" : null]
          .filter(Boolean)
          .join(" ")}>
        {guest.fullName}
      </span>
    </div>
  );
}
