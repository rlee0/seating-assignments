import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useEffect, useMemo, useRef, useState } from "react";

import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { cn } from "../lib/utils";
import { guestChipVariants } from "@/components/ui/chip";
import { useDraggable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

const HOVERCARD_OPEN_DELAY_MS = 1200;
const HOVERCARD_CLOSE_DELAY_MS = 80;

let activeGuestHovercardId: string | null = null;
const guestHovercardSubscribers = new Set<(hovercardId: string | null) => void>();

function subscribeToGuestHovercardChanges(listener: (hovercardId: string | null) => void) {
  guestHovercardSubscribers.add(listener);

  return () => {
    guestHovercardSubscribers.delete(listener);
  };
}

function setActiveGuestHovercard(hovercardId: string | null) {
  activeGuestHovercardId = hovercardId;
  guestHovercardSubscribers.forEach((listener) => listener(hovercardId));
}

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
    background: `oklch(0.88 0.1 ${hue})`,
    border: `oklch(0.72 0.15 ${hue})`,
    solid: `oklch(0.62 0.17 ${hue})`,
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
  suppressInteraction?: boolean;
  draggableDisabled?: boolean;
  fallbackName?: string;
}

export default function GuestChip({
  guestId,
  context,
  tableNumber,
  seatIndex,
  className,
  suppressStateStyles = false,
  suppressInteraction = false,
  draggableDisabled = false,
  fallbackName,
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
  const hovercardId =
    context === "table" && typeof tableNumber === "number" && typeof seatIndex === "number"
      ? `table-${tableNumber}-seat-${seatIndex}-guest-${guestId}`
      : `guest-${guestId}`;
  const [isHovercardOpen, setIsHovercardOpen] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const draggableId =
    draggableDisabled &&
    context === "table" &&
    typeof tableNumber === "number" &&
    typeof seatIndex === "number"
      ? `guest-preview-${guestId}-${tableNumber}-${seatIndex}`
      : `guest-${guestId}`;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    disabled: draggableDisabled,
    data:
      context === "table" && typeof tableNumber === "number" && typeof seatIndex === "number"
        ? { kind: "guest", guestId, origin: context, tableNumber, seatIndex }
        : { kind: "guest", guestId, origin: context },
  });

  if (!guest && !fallbackName) return null;

  const guestName = guest?.fullName ?? fallbackName ?? "";

  const householdName = guest
    ? parties.get(guest.partyId)?.household?.trim() || "Unknown household"
    : "";
  const groupName = guest ? guest.group.trim() || "No group" : "";
  const hostName = guest ? guest.host.trim() || "Unknown host" : "";
  const lockedStatusLabel = isAnchored ? "Locked" : "Not locked";
  const shouldShowHovercard = context === "table" && !isDragging;

  function clearHovercardTimers() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function closeHovercard() {
    clearHovercardTimers();
    setIsHovercardOpen(false);

    if (activeGuestHovercardId === hovercardId) {
      setActiveGuestHovercard(null);
    }
  }

  function scheduleHovercardOpen() {
    if (!shouldShowHovercard || !guest) return;

    clearHovercardTimers();
    setActiveGuestHovercard(hovercardId);
    openTimerRef.current = window.setTimeout(() => {
      if (activeGuestHovercardId !== hovercardId) return;
      setIsHovercardOpen(true);
      openTimerRef.current = null;
    }, HOVERCARD_OPEN_DELAY_MS);
  }

  function scheduleHovercardClose() {
    clearHovercardTimers();
    closeTimerRef.current = window.setTimeout(() => {
      closeHovercard();
      closeTimerRef.current = null;
    }, HOVERCARD_CLOSE_DELAY_MS);
  }

  function handleHovercardPointerEnter() {
    scheduleHovercardOpen();
  }

  function handleHovercardPointerLeave() {
    scheduleHovercardClose();
  }

  function handleHovercardBlur() {
    closeHovercard();
  }

  useEffect(() => {
    if (!shouldShowHovercard) {
      closeHovercard();
      return;
    }

    return subscribeToGuestHovercardChanges((nextHovercardId) => {
      if (nextHovercardId === hovercardId) return;

      clearHovercardTimers();
      setIsHovercardOpen(false);
    });
  }, [hovercardId, shouldShowHovercard]);

  useEffect(() => {
    return () => {
      clearHovercardTimers();

      if (activeGuestHovercardId === hovercardId) {
        setActiveGuestHovercard(null);
      }
    };
  }, [hovercardId]);

  // When DragOverlay is active it owns the visual movement; don't also move the original element.
  const style: CSSProperties & Record<string, string> = {};
  if (!isDragging && transform) {
    style.transform = CSS.Translate.toString(transform);
  }

  const highlightToken = useMemo(() => {
    if (!guest) return null;
    return getHighlightTokenForGuest(guest, {
      isHostHighlightOn,
      isHouseholdHighlightOn,
      isGroupHighlightOn,
    });
  }, [guest, isHostHighlightOn, isHouseholdHighlightOn, isGroupHighlightOn]);

  const selectedHighlightToken = useMemo(() => {
    if (!selectedGuest) return null;
    return getHighlightTokenForGuest(selectedGuest, {
      isHostHighlightOn,
      isHouseholdHighlightOn,
      isGroupHighlightOn,
    });
  }, [selectedGuest, isHostHighlightOn, isHouseholdHighlightOn, isGroupHighlightOn]);

  const isSelected = selectedGuestId === guestId;
  const isRelatedHousehold = relatedHouseholdGuestIds.has(guestId);
  const isRelatedGroup = relatedGroupGuestIds.has(guestId);

  const highlightColors = useMemo(
    () => (highlightToken ? getHighlightColor(highlightToken) : null),
    [highlightToken]
  );

  const selectedHighlightColors = useMemo(
    () => (selectedHighlightToken ? getHighlightColor(selectedHighlightToken) : null),
    [selectedHighlightToken]
  );

  let isHighlighted = false;
  if (highlightColors) {
    style["--guest-chip-highlight-bg"] = highlightColors.background;
    style["--guest-chip-highlight-border"] = highlightColors.border;
    isHighlighted = true;
  }

  if (!suppressStateStyles && selectedGuestId) {
    if (selectedHighlightColors) {
      style["--guest-chip-selected-color"] = selectedHighlightColors.solid;
    } else {
      style["--guest-chip-selected-color"] = "var(--primary)";
    }
  }

  if (isAnchored) {
    style.borderColor = "var(--destructive)";
  }

  const hasInlineStyle = Object.keys(style).length > 0;

  let visualState:
    | "selected"
    | "relatedBoth"
    | "relatedHousehold"
    | "relatedGroup"
    | "dimmed"
    | "highlighted"
    | "searchMatch"
    | "default" = "default";
  if (!suppressStateStyles) {
    if (isSelected || isRelatedHousehold) {
      visualState = "selected";
    } else if (selectedGuestId && !isRelatedGroup) {
      visualState = "dimmed";
    }
  }
  if (visualState === "default" && isHighlighted) visualState = "highlighted";

  const isSearchMatch =
    !suppressStateStyles &&
    !!guest &&
    searchQuery.trim() &&
    normalizeForSearch(guestName).includes(normalizeForSearch(searchQuery.trim()));

  if (visualState === "default" && isSearchMatch) visualState = "searchMatch";

  function handleSelectGuest() {
    if (isDragging || suppressInteraction || !guest) return;
    if (selectedGuestId === guestId) {
      clearSelectedGuest();
    } else {
      selectGuest(guestId);
    }
  }

  const chip = (
    <div
      ref={setNodeRef}
      data-guest-chip
      data-guest-id={guestId}
      style={hasInlineStyle ? style : undefined}
      className={cn(
        guestChipVariants({ state: visualState, context }),
        isDragging && "opacity-0",
        className
      )}
      title={shouldShowHovercard ? undefined : guestName}
      onClick={suppressInteraction ? undefined : handleSelectGuest}
      onPointerEnter={shouldShowHovercard ? handleHovercardPointerEnter : undefined}
      onPointerLeave={shouldShowHovercard ? handleHovercardPointerLeave : undefined}
      onBlur={shouldShowHovercard ? handleHovercardBlur : undefined}
      {...(suppressInteraction ? undefined : listeners)}
      {...(suppressInteraction ? undefined : attributes)}>
      <span
        data-guest-name
        className="relative block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {guestName}
      </span>
    </div>
  );

  if (!shouldShowHovercard || !guest) {
    return chip;
  }

  return (
    <HoverCard open={isHovercardOpen} onOpenChange={(open) => !open && closeHovercard()}>
      <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
      <HoverCardContent
        className="w-64 space-y-3"
        onPointerEnter={handleHovercardPointerEnter}
        onPointerLeave={handleHovercardPointerLeave}>
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
