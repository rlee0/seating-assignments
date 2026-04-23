import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Filter, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GroupCard from "./GroupCard";
import HouseholdCard from "./HouseholdCard";
import { Input } from "@/components/ui/input";
import { cn } from "../lib/utils";
import { chipToggleVariants } from "@/components/ui/chip";
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

export default function Sidebar() {
  const { state, parties, guests } = useSeating();
  const {
    searchQuery,
    setSearchQuery,
    hostFilters,
    toggleHostFilter,
    clearHostFilters,
    isGroupHighlightOn,
    setGroupHighlightOn,
    isHouseholdHighlightOn,
    setHouseholdHighlightOn,
    isHostHighlightOn,
    setHostHighlightOn,
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

  const availableHosts = useMemo(() => {
    const hosts = new Set<string>();

    for (const guest of guests.values()) {
      if (guest.host.trim()) {
        hosts.add(guest.host);
      }
    }

    return [...hosts].sort((left, right) => sidebarSortCollator.compare(left, right));
  }, [guests]);

  const selectedHosts = useMemo(() => new Set(hostFilters), [hostFilters]);
  const activeHostFilterCount = hostFilters.length;
  const emptyStateMessage =
    normalizedQuery.length > 0
      ? `No unassigned matches for "${searchQuery.trim()}"`
      : activeHostFilterCount > 0
        ? "No unassigned guests match the current host filters"
        : "No unassigned guests available";

  // Show parties that still have at least one unassigned member
  const partiesWithUnassigned = useMemo(
    () =>
      [...parties.values()].filter((party) => {
        const unassignedGuestIds = party.guestIds.filter((id) => unassignedSet.has(id));
        const unassignedHosts = new Set(
          unassignedGuestIds
            .map((id) => guests.get(id)?.host ?? "")
            .filter((host): host is string => host.length > 0)
        );

        if (unassignedGuestIds.length === 0) return false;
        if (
          selectedHosts.size > 0 &&
          ![...unassignedHosts].some((host) => selectedHosts.has(host))
        ) {
          return false;
        }
        if (!normalizedQuery) return true;

        if (normalizeForSearch(party.household).includes(normalizedQuery)) return true;
        if (normalizeForSearch(party.group || "No Group").includes(normalizedQuery)) return true;

        return unassignedGuestIds.some((id) => {
          const guest = guests.get(id);
          return guest && normalizeForSearch(guest.fullName).includes(normalizedQuery);
        });
      }),
    [parties, unassignedSet, normalizedQuery, guests, selectedHosts]
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 [&_svg]:h-3.5 [&_svg]:w-3.5">
                <Filter aria-hidden="true" />
                <span>Filter</span>
                {activeHostFilterCount > 0 ? (
                  <Badge
                    className="h-5 min-w-5 rounded-full px-1.5 text-2xs leading-5"
                    variant="default">
                    {activeHostFilterCount}
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-72"
              aria-label="Filter unassigned guests by host">
              <DropdownMenuLabel className="text-xs font-bold uppercase tracking-wider text-foreground">
                Hosts
              </DropdownMenuLabel>
              {availableHosts.length === 0 ? (
                <DropdownMenuItem disabled className="m-0 text-xs text-muted-foreground">
                  No hosts found
                </DropdownMenuItem>
              ) : (
                availableHosts.map((host) => (
                  <DropdownMenuCheckboxItem
                    key={host}
                    checked={selectedHosts.has(host)}
                    className="text-xs"
                    onCheckedChange={() => toggleHostFilter(host)}>
                    <span className="text-xs font-semibold text-foreground">{host}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
              {activeHostFilterCount > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                    onSelect={() => clearHostFilters()}>
                    Clear
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-2 flex gap-1.5" aria-label="Highlight views">
          <button
            type="button"
            className={[
              "text-2xs",
              chipToggleVariants({ state: isGroupHighlightOn ? "pressed" : "default", size: "sm" }),
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={isGroupHighlightOn}
            title="Highlight guests in the same group"
            onClick={() => setGroupHighlightOn(!isGroupHighlightOn)}>
            Group
          </button>
          <button
            type="button"
            className={[
              "text-2xs",
              chipToggleVariants({
                state: isHouseholdHighlightOn ? "pressed" : "default",
                size: "sm",
              }),
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={isHouseholdHighlightOn}
            title="Highlight guests in the same household"
            onClick={() => setHouseholdHighlightOn(!isHouseholdHighlightOn)}>
            Household
          </button>
          <button
            type="button"
            className={[
              "text-2xs",
              chipToggleVariants({ state: isHostHighlightOn ? "pressed" : "default", size: "sm" }),
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={isHostHighlightOn}
            title="Highlight seated guests by host"
            onClick={() => setHostHighlightOn(!isHostHighlightOn)}>
            Host
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <span>Unassigned</span>
        <Badge variant="secondary" className="h-auto rounded-full px-1.5 py-0 text-2xs">
          {state.unassigned.length}
        </Badge>
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
                  <HouseholdCard key={party.id} party={party} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
