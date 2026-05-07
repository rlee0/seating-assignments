import { Crown, House, Layers3, Search, UserPlus, Users } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn, normalizeForSearch } from "../lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import CircleCard from "./CircleCard";
import { Input } from "@/components/ui/input";
import PartyCard from "./PartyCard";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useDroppable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

const sidebarSortCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function comparePartiesForSidebar(
  a: { host: string; circle: string; party: string },
  b: { host: string; circle: string; party: string }
): number {
  const byHost = sidebarSortCollator.compare(a.host, b.host);
  if (byHost !== 0) return byHost;

  const byCircle = sidebarSortCollator.compare(a.circle || "No Circle", b.circle || "No Circle");
  if (byCircle !== 0) return byCircle;

  return sidebarSortCollator.compare(a.party, b.party);
}

export default function Sidebar({
  onAddGuest,
  onEditGuest,
  onDeleteGuest,
}: {
  onAddGuest: () => void;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
}) {
  const { state, parties, guests } = useSeating();
  const {
    searchQuery,
    setSearchQuery,
    setCircleHighlightOn,
    isPartyHighlightOn,
    setPartyHighlightOn,
    isHostHighlightOn,
    setHostHighlightOn,
    partyPulseNonce,
  } = useSearch();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery.trim()), [searchQuery]);

  const normalizedPartyNames = useMemo(() => {
    const map = new Map<string, { party: string; circle: string }>();
    for (const [id, party] of parties) {
      map.set(id, {
        party: normalizeForSearch(party.party),
        circle: normalizeForSearch(party.circle || "No Circle"),
      });
    }
    return map;
  }, [parties]);

  const normalizedGuestNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, guest] of guests) {
      map.set(id, normalizeForSearch(guest.fullName));
    }
    return map;
  }, [guests]);

  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  const dropzoneRef = useRef<HTMLDivElement | null>(null);
  const [collapsedCircles, setCollapsedCircles] = useState<Set<string>>(new Set());
  const [collapsedParties, setCollapsedParties] = useState<Set<string>>(new Set());

  const setDropzoneRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      dropzoneRef.current = node;
    },
    [setNodeRef]
  );

  useEffect(() => {
    const element = dropzoneRef.current;
    if (!element) return;

    const lockHorizontalScroll = () => {
      if (element.scrollLeft !== 0) {
        element.scrollLeft = 0;
      }
    };

    lockHorizontalScroll();
    element.addEventListener("scroll", lockHorizontalScroll, { passive: true });

    return () => {
      element.removeEventListener("scroll", lockHorizontalScroll);
    };
  }, []);

  const activeHighlightMode = isPartyHighlightOn ? "party" : isHostHighlightOn ? "host" : "circle";
  const highlightToggleItemClass =
    "h-8 flex-1 rounded-none border-l border-input bg-background px-2 text-xs font-medium text-muted-foreground first:rounded-l-md first:border-l-0 last:rounded-r-md data-[state=on]:bg-primary/12 data-[state=on]:text-primary";
  const emptyStateMessage =
    normalizedQuery.length > 0
      ? `No unassigned matches for "${searchQuery.trim()}"`
      : "No unassigned guests available";
  const unassignedSummary =
    guests.size === 0 ? "No guests" : `${state.unassigned.length} of ${guests.size}`;

  const partiesWithUnassigned = useMemo(
    () =>
      [...parties.values()].filter((party) => {
        const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
        if (unassignedGuestIds.length === 0) return false;
        if (!normalizedQuery) return true;

        const names = normalizedPartyNames.get(party.id);
        if (names?.party.includes(normalizedQuery)) return true;
        if (names?.circle.includes(normalizedQuery)) return true;

        return unassignedGuestIds.some((id) => {
          const normalizedName = normalizedGuestNames.get(id);
          return normalizedName !== undefined && normalizedName.includes(normalizedQuery);
        });
      }),
    [parties, unassignedSet, normalizedQuery, normalizedPartyNames, normalizedGuestNames]
  );

  const sortedPartiesWithUnassigned = useMemo(
    () => [...partiesWithUnassigned].sort(comparePartiesForSidebar),
    [partiesWithUnassigned]
  );

  const { circledParties, circledGuestIds } = useMemo(() => {
    const circledParties = new Map<string, typeof partiesWithUnassigned>();
    const circledGuestIds = new Map<string, string[]>();

    for (const party of sortedPartiesWithUnassigned) {
      const circleName = party.circle || "No Circle";
      const circleParties = circledParties.get(circleName) ?? [];
      circleParties.push(party);
      circledParties.set(circleName, circleParties);

      const existingGuestIds = circledGuestIds.get(circleName) ?? [];
      const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
      circledGuestIds.set(circleName, [...existingGuestIds, ...unassignedGuestIds]);
    }

    return { circledParties, circledGuestIds };
  }, [sortedPartiesWithUnassigned, unassignedSet]);

  const sortedCircles = useMemo(() => [...circledParties.keys()], [circledParties]);

  const toggleCircleExpanded = useCallback((circleName: string) => {
    setCollapsedCircles((current) => {
      const next = new Set(current);
      if (next.has(circleName)) {
        next.delete(circleName);
      } else {
        next.add(circleName);
      }
      return next;
    });
  }, []);

  const togglePartyExpanded = useCallback((partyId: string) => {
    setCollapsedParties((current) => {
      const next = new Set(current);
      if (next.has(partyId)) {
        next.delete(partyId);
      } else {
        next.add(partyId);
      }
      return next;
    });
  }, []);

  return (
    <ShadcnSidebar
      side="left"
      variant="sidebar"
      collapsible="offcanvas"
      className="border-r border-sidebar-border">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Guests</span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-xs"
            onClick={onAddGuest}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Guest</span>
          </Button>
        </div>
        <div className="relative flex min-w-0 items-center">
          <Search
            className="pointer-events-none absolute left-2.25 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            className="h-9 pl-8"
            data-app-search="true"
            placeholder="Search guests, parties, circles"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search unassigned guests, parties, and circles"
          />
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={activeHighlightMode}
          onValueChange={(value) => {
            if (value === "circle") {
              setCircleHighlightOn(true);
              return;
            }

            if (value === "party") {
              setPartyHighlightOn(true);
              return;
            }

            if (value === "host") {
              setHostHighlightOn(true);
            }
          }}
          className="w-full justify-start gap-0 rounded-md border border-input"
          aria-label="Highlight views">
          <ToggleGroupItem
            value="circle"
            className={highlightToggleItemClass}
            title="Highlight guests in the same circle">
            <Layers3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Circle</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            key={`party-toggle-${partyPulseNonce}`}
            value="party"
            className={cn(
              highlightToggleItemClass,
              partyPulseNonce > 0 && "animate-[pulse_280ms_ease-out_2]"
            )}
            title="Highlight guests in the same party">
            <House className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Party</span>
          </ToggleGroupItem>
          <ToggleGroupItem
            value="host"
            className={highlightToggleItemClass}
            title="Highlight seated guests by host">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Host</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </SidebarHeader>
      <SidebarContent
        ref={setDropzoneRef}
        className={cn(
          "overflow-y-auto overflow-x-clip px-3 pt-3 pb-4 overscroll-x-none [touch-action:pan-y]",
          isOver && "bg-(--sidebar-drop-bg)"
        )}>
        <div className="mb-3 flex items-center justify-between px-0.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Unassigned</span>
          </span>
          <span className="font-medium normal-case tracking-normal">{unassignedSummary}</span>
        </div>
        {state.unassigned.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            All guests are seated ✓
          </div>
        ) : partiesWithUnassigned.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyStateMessage}
          </div>
        ) : (
          sortedCircles.map((circleName) => (
            <div key={circleName} className="mb-3.5 grid grid-cols-1 gap-2 last:mb-0">
              <CircleCard
                circleName={circleName}
                guestIds={circledGuestIds.get(circleName) ?? []}
                isExpanded={!collapsedCircles.has(circleName)}
                onToggleExpanded={() => toggleCircleExpanded(circleName)}
              />
              {!collapsedCircles.has(circleName) ? (
                <div className="relative ml-0 grid grid-cols-1 gap-2 pl-5 pt-0.5 pb-0.5 before:absolute before:bottom-0.5 before:left-2 before:top-0.5 before:w-px before:bg-border">
                  {circledParties.get(circleName)?.map((party) => (
                    <PartyCard
                      key={party.id}
                      party={party}
                      unassignedSet={unassignedSet}
                      onEditGuest={onEditGuest}
                      onDeleteGuest={onDeleteGuest}
                      isExpanded={!collapsedParties.has(party.id)}
                      onToggleExpanded={() => togglePartyExpanded(party.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </SidebarContent>
      <SidebarRail />
    </ShadcnSidebar>
  );
}
