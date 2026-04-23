import { Plus, Search } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import GroupCard from "./GroupCard";
import HouseholdCard from "./HouseholdCard";
import { Input } from "@/components/ui/input";
import { cn } from "../lib/utils";
import { useDroppable } from "@dnd-kit/core";
import { useSearch } from "../store/SearchContext";
import { useSeating } from "../store/SeatingContext";

function normalizeForSearch(str: string): string {
  return str
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const sidebarSortCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function comparePartiesForSidebar(
  a: { host: string; group: string; household: string },
  b: { host: string; group: string; household: string }
): number {
  const byHost = sidebarSortCollator.compare(a.host, b.host);
  if (byHost !== 0) return byHost;

  const byGroup = sidebarSortCollator.compare(a.group || "No Group", b.group || "No Group");
  if (byGroup !== 0) return byGroup;

  return sidebarSortCollator.compare(a.household, b.household);
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
    setGroupHighlightOn,
    isHouseholdHighlightOn,
    setHouseholdHighlightOn,
    isHostHighlightOn,
    setHostHighlightOn,
    householdPulseNonce,
  } = useSearch();
  const unassignedSet = useMemo(() => new Set(state.unassigned), [state.unassigned]);
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery.trim()), [searchQuery]);

  const { setNodeRef, isOver } = useDroppable({ id: "unassigned" });
  const dropzoneRef = useRef<HTMLDivElement | null>(null);

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

  const activeHighlightMode = isHouseholdHighlightOn
    ? "household"
    : isHostHighlightOn
      ? "host"
      : "group";
  const highlightToggleItemClass =
    "rounded-none border-l border-input bg-background first:rounded-l-md first:border-l-0 last:rounded-r-md";
  const emptyStateMessage =
    normalizedQuery.length > 0
      ? `No unassigned matches for "${searchQuery.trim()}"`
      : "No unassigned guests available";
  const unassignedSummary =
    guests.size === 0 ? "No guests" : `${state.unassigned.length} of ${guests.size}`;

  // Show parties that still have at least one unassigned member
  const partiesWithUnassigned = useMemo(
    () =>
      [...parties.values()].filter((party) => {
        const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
        if (unassignedGuestIds.length === 0) return false;
        if (!normalizedQuery) return true;

        if (normalizeForSearch(party.household).includes(normalizedQuery)) return true;
        if (normalizeForSearch(party.group || "No Group").includes(normalizedQuery)) return true;

        return unassignedGuestIds.some((id) => {
          const guest = guests.get(id);
          return guest && normalizeForSearch(guest.fullName).includes(normalizedQuery);
        });
      }),
    [parties, unassignedSet, normalizedQuery, guests]
  );

  const sortedPartiesWithUnassigned = useMemo(
    () => [...partiesWithUnassigned].sort(comparePartiesForSidebar),
    [partiesWithUnassigned]
  );

  const { groupedParties, groupedGuestIds } = useMemo(() => {
    const groupedParties = new Map<string, typeof partiesWithUnassigned>();
    const groupedGuestIds = new Map<string, string[]>();

    for (const party of sortedPartiesWithUnassigned) {
      const groupName = party.group || "No Group";
      const groupParties = groupedParties.get(groupName) ?? [];
      groupParties.push(party);
      groupedParties.set(groupName, groupParties);

      const existingGuestIds = groupedGuestIds.get(groupName) ?? [];
      const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
      groupedGuestIds.set(groupName, [...existingGuestIds, ...unassignedGuestIds]);
    }

    return { groupedParties, groupedGuestIds };
  }, [sortedPartiesWithUnassigned, unassignedSet]);

  const sortedGroups = useMemo(() => [...groupedParties.keys()], [groupedParties]);

  return (
    <aside
      data-sidebar
      className="flex w-65 shrink-0 flex-col overflow-hidden overflow-x-clip border-r border-sidebar-border bg-sidebar overscroll-x-none *:min-w-0">
      <div className="relative shrink-0 border-b border-sidebar-border bg-sidebar p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Guests
          </p>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={onAddGuest}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add Guest</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <Search
              className="pointer-events-none absolute left-2.25 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              className="h-8 pl-8 text-xs"
              data-app-search="true"
              placeholder="Search guests, households, groups"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search unassigned guests, households, and groups"
            />
          </div>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          value={activeHighlightMode}
          onValueChange={(value) => {
            if (value === "group") {
              setGroupHighlightOn(true);
              return;
            }

            if (value === "household") {
              setHouseholdHighlightOn(true);
              return;
            }

            if (value === "host") {
              setHostHighlightOn(true);
            }
          }}
          className="mt-2 w-fit justify-start gap-0 rounded-md border border-input"
          aria-label="Highlight views">
          <ToggleGroupItem
            value="group"
            className={highlightToggleItemClass}
            title="Highlight guests in the same group">
            Group
          </ToggleGroupItem>
          <ToggleGroupItem
            key={`household-toggle-${householdPulseNonce}`}
            value="household"
            className={cn(
              highlightToggleItemClass,
              householdPulseNonce > 0 && "animate-[pulse_280ms_ease-out_2]"
            )}
            title="Highlight guests in the same household">
            Household
          </ToggleGroupItem>
          <ToggleGroupItem
            value="host"
            className={highlightToggleItemClass}
            title="Highlight seated guests by host">
            Host
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <span>Unassigned</span>
        <span className="font-medium normal-case tracking-normal">{unassignedSummary}</span>
      </div>
      <div
        ref={setDropzoneRef}
        className={cn(
          "flex-1 overflow-y-auto overflow-x-clip p-3 overscroll-x-none [touch-action:pan-y]",
          isOver && "bg-(--sidebar-drop-bg)"
        )}>
        {state.unassigned.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            All guests are seated ✓
          </div>
        ) : partiesWithUnassigned.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {emptyStateMessage}
          </div>
        ) : (
          sortedGroups.map((groupName) => (
            <div key={groupName} className="grid gap-1 mb-4 last:mb-0">
              <GroupCard groupName={groupName} guestIds={groupedGuestIds.get(groupName) ?? []} />
              <div className="relative ml-0 grid gap-1.5 pl-5 pt-1 pb-1 before:absolute before:left-2 before:top-1 before:bottom-1 before:w-px before:bg-border">
                {groupedParties.get(groupName)?.map((party) => (
                  <HouseholdCard
                    key={party.id}
                    party={party}
                    onEditGuest={onEditGuest}
                    onDeleteGuest={onDeleteGuest}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
