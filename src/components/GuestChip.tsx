import type { CSSProperties, MouseEvent } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

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

// 20 evenly-spaced hues at 18° intervals — one per group with no near-duplicates
const GROUP_PALETTE_HUES = [
  0, 18, 36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 234, 252, 270, 288, 306, 324, 342,
];
// Step of 11 is coprime to 20, giving golden-angle-like distribution across the palette
const groupHueOrder = Array.from(
  { length: GROUP_PALETTE_HUES.length },
  (_, i) => GROUP_PALETTE_HUES[(i * 11) % GROUP_PALETTE_HUES.length]
);

// 120 golden-angle hues (137.508° step) for households — stays well-distributed
// regardless of how many distinct households exist
const GOLDEN_ANGLE = 137.508;
const householdHueOrder = Array.from({ length: 120 }, (_, i) =>
  Math.round((i * GOLDEN_ANGLE) % 360)
);

const domainHueOrders: Record<string, number[]> = {
  group: groupHueOrder,
  household: householdHueOrder,
};
const DEFAULT_HUE_ORDER = groupHueOrder;

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

  const hueOrder = domainHueOrders[domain] ?? DEFAULT_HUE_ORDER;
  const paletteSize = hueOrder.length;

  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash << 5) - hash + token.charCodeAt(index);
    hash |= 0;
  }

  const start = Math.abs(hash) % paletteSize;
  let selectedHue = hueOrder[start];

  for (let offset = 0; offset < paletteSize; offset += 1) {
    const candidateHue = hueOrder[(start + offset) % paletteSize];
    if (!usedHues.has(candidateHue)) {
      selectedHue = candidateHue;
      break;
    }
  }

  tokenHueMap.set(token, selectedHue);
  usedHues.add(selectedHue);
  return selectedHue;
}

function getHighlightColor(token: string): {
  background: string;
  border: string;
  solid: string;
} {
  const hue = getTokenHue(token);
  return {
    background: `hsl(${hue} 78% 85%)`,
    border: `hsl(${hue} 58% 64%)`,
    solid: `hsl(${hue} 52% 56%)`,
  };
}

function getHighlightTokenForGuest(
  guest: { host: string; partyId: string; group: string },
  options: {
    isHostHighlightOn: boolean;
    isHouseholdHighlightOn: boolean;
    isGroupHighlightOn: boolean;
  }
): string | null {
  const { isHostHighlightOn, isHouseholdHighlightOn, isGroupHighlightOn } = options;

  if (isHostHighlightOn) return `host:${guest.host || "Unknown"}`;
  if (isHouseholdHighlightOn) return `household:${guest.partyId}`;
  if (isGroupHighlightOn) return `group:${guest.group || "No Group"}`;

  return null;
}

interface Props {
  guestId: string;
  context: "sidebar" | "table";
  tableNumber?: number;
  seatIndex?: number;
  className?: string;
  suppressStateStyles?: boolean;
}

export default function GuestChip({
  guestId,
  context,
  tableNumber,
  seatIndex,
  className,
  suppressStateStyles = false,
}: Props) {
  const {
    state,
    guests,
    parties,
    selectedGuestId,
    selectGuest,
    clearSelectedGuest,
    relatedHouseholdGuestIds,
    relatedGroupGuestIds,
  } = useSeating();
  const { searchQuery, isGroupHighlightOn, isHouseholdHighlightOn, isHostHighlightOn } =
    useSearch();
  const guest = guests.get(guestId);
  const selectedGuest = selectedGuestId ? guests.get(selectedGuestId) : null;
  const isAnchored = (state.lockedGuestIds ?? []).includes(guestId);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `guest-${guestId}`,
    data:
      context === "table" && typeof tableNumber === "number" && typeof seatIndex === "number"
        ? { kind: "guest", guestId, origin: context, tableNumber, seatIndex }
        : { kind: "guest", guestId, origin: context },
  });

  if (!guest) return null;

  const householdName = parties.get(guest.partyId)?.household?.trim() || "Unknown household";
  const groupName = guest.group.trim() || "No group";
  const hostName = guest.host.trim() || "Unknown host";
  const lockedStatusLabel = isAnchored ? "Locked" : "Not locked";
  const shouldShowHovercard = context === "table" && !isDragging;

  // When DragOverlay is active it owns the visual movement; don't also move the original element.
  const style: CSSProperties & Record<string, string> = {};
  if (!isDragging && transform) {
    style.transform = CSS.Translate.toString(transform);
  }

  const highlightToken =
    context === "table"
      ? getHighlightTokenForGuest(guest, {
          isHostHighlightOn,
          isHouseholdHighlightOn,
          isGroupHighlightOn,
        })
      : null;
  const selectedHighlightToken = selectedGuest
    ? getHighlightTokenForGuest(selectedGuest, {
        isHostHighlightOn,
        isHouseholdHighlightOn,
        isGroupHighlightOn,
      })
    : null;
  const isSelected = selectedGuestId === guestId;
  const isRelatedHousehold = relatedHouseholdGuestIds.has(guestId);
  const isRelatedGroup = relatedGroupGuestIds.has(guestId);

  let highlightClass: string | null = null;
  if (highlightToken) {
    const { background, border } = getHighlightColor(highlightToken);
    style["--guest-chip-highlight-bg"] = background;
    style["--guest-chip-highlight-border"] = border;
    highlightClass = "is-highlighted";
  }

  if (!suppressStateStyles && selectedGuestId) {
    if (selectedHighlightToken) {
      const { solid } = getHighlightColor(selectedHighlightToken);
      style["--guest-chip-selected-color"] = solid;
    } else {
      style["--guest-chip-selected-color"] = "var(--primary)";
    }
  }

  if (isAnchored) {
    style.borderColor = "#dc2626";
  }

  const hasInlineStyle = Object.keys(style).length > 0;
  const relationClasses: string[] = [];
  if (!suppressStateStyles) {
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

  function handleMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (!shouldShowHovercard) return;

    // Prevent focus-on-click so the hover card only opens via deliberate hover.
    event.preventDefault();
  }

  const chip = (
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
        isAnchored ? "is-anchored" : null,
        isDragging ? "is-dragging" : null,
        isSearchMatch ? "is-search-match" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      title={shouldShowHovercard ? undefined : guest.fullName}
      onMouseDown={handleMouseDown}
      onClick={handleSelectGuest}
      {...listeners}
      {...attributes}>
      <span className="guest-name">{guest.fullName}</span>
    </div>
  );

  if (!shouldShowHovercard) {
    return chip;
  }

  return (
    <HoverCard openDelay={1000} closeDelay={100}>
      <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
      <HoverCardContent className="w-64 space-y-3">
        <div>
          <h4 className="text-sm font-semibold leading-tight">{guest.fullName}</h4>
        </div>

        <dl className="space-y-2 text-xs">
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Household</dt>
            <dd className="min-w-0 font-medium text-foreground">{householdName}</dd>
          </div>
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Group</dt>
            <dd className="min-w-0 font-medium text-foreground">{groupName}</dd>
          </div>
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Host</dt>
            <dd className="min-w-0 font-medium text-foreground">{hostName}</dd>
          </div>
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="min-w-0 font-medium text-foreground">{lockedStatusLabel}</dd>
          </div>
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}
