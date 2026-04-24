import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Crown, House, Layers3, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { cn, normalizeForSearch } from "../lib/utils";
import { guestChipVariants } from "@/components/ui/chip";
import { useDraggable } from "@dnd-kit/core";
import {
  buildHighlightColor,
  getDomainFromToken,
  type HighlightDomain,
  type PaletteSlot,
} from "@/lib/palette";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

const HOVERCARD_OPEN_DELAY_MS = 1200;
const HOVERCARD_CLOSE_DELAY_MS = 80;
const CHIP_SINGLE_CLICK_DELAY_MS = 220;

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

function getHighlightColor(
  token: string,
  slotAssignments: Record<HighlightDomain, Map<string, PaletteSlot>>
): {
  background: string;
  border: string;
  solid: string;
} {
  const domain = getDomainFromToken(token);
  const slot = slotAssignments[domain].get(token) ?? slotAssignments.default.get(token);
  return buildHighlightColor(slot ?? { hue: 0, tier: 0 });
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
  onEditGuest?: (guestId: string) => void;
  onDeleteGuest?: (guestId: string) => void;
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
  onEditGuest,
  onDeleteGuest,
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
    slotAssignments,
  } = useSeating();
  const {
    searchQuery,
    normalizedQuery,
    isGroupHighlightOn,
    isHouseholdHighlightOn,
    isHostHighlightOn,
    activateHouseholdFocusFromGuestSelection,
    restoreHighlightModeAfterGuestDeselection,
  } = useSearch();
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
  const selectTimerRef = useRef<number | null>(null);

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

  const guestName = guest?.fullName ?? fallbackName ?? "";
  const normalizedGuestName = useMemo(() => normalizeForSearch(guestName), [guestName]);

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

  function clearSelectTimer() {
    if (selectTimerRef.current !== null) {
      window.clearTimeout(selectTimerRef.current);
      selectTimerRef.current = null;
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
      clearSelectTimer();

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
    () => (highlightToken ? getHighlightColor(highlightToken, slotAssignments) : null),
    [highlightToken, slotAssignments]
  );

  const selectedHighlightColors = useMemo(
    () =>
      selectedHighlightToken ? getHighlightColor(selectedHighlightToken, slotAssignments) : null,
    [selectedHighlightToken, slotAssignments]
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
    searchQuery.trim().length > 0 &&
    normalizedGuestName.includes(normalizedQuery);

  if (visualState === "default" && isSearchMatch) visualState = "searchMatch";

  function applyGuestSelection() {
    if (isDragging || suppressInteraction || !guest) return;
    if (selectedGuestId === guestId) {
      restoreHighlightModeAfterGuestDeselection();
      clearSelectedGuest();
    } else {
      selectGuest(guestId);
      activateHouseholdFocusFromGuestSelection();
    }
  }

  function handleSelectGuest() {
    clearSelectTimer();
    // Delay single-click action so a following double-click can cancel selection.
    selectTimerRef.current = window.setTimeout(() => {
      applyGuestSelection();
      selectTimerRef.current = null;
    }, CHIP_SINGLE_CLICK_DELAY_MS);
  }

  function handleDoubleClick() {
    clearSelectTimer();
    if (suppressInteraction || !onEditGuest) return;
    onEditGuest(guestId);
  }

  if (!guest && !fallbackName) return null;

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
      onDoubleClick={suppressInteraction ? undefined : handleDoubleClick}
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

  if (context === "sidebar" && guest && !suppressInteraction && (onEditGuest || onDeleteGuest)) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
        <ContextMenuContent>
          {onEditGuest ? (
            <ContextMenuItem onSelect={() => onEditGuest(guestId)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit guest
            </ContextMenuItem>
          ) : null}
          {onEditGuest && onDeleteGuest ? <ContextMenuSeparator /> : null}
          {onDeleteGuest ? (
            <ContextMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={() => onDeleteGuest(guestId)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete guest
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    );
  }

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
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <House className="h-3 w-3" aria-hidden="true" />
              <span>Household</span>
            </dt>
            <dd className="min-w-0 font-medium text-foreground">{householdName}</dd>
          </div>
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Layers3 className="h-3 w-3" aria-hidden="true" />
              <span>Group</span>
            </dt>
            <dd className="min-w-0 font-medium text-foreground">{groupName}</dd>
          </div>
          <div className="grid grid-cols-[72px_1fr] items-start gap-x-2 gap-y-0.5">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Crown className="h-3 w-3" aria-hidden="true" />
              <span>Host</span>
            </dt>
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
