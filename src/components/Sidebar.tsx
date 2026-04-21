import { Filter, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import GroupCard from "./GroupCard";
import HouseholdCard from "./HouseholdCard";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
  const { state, parties, guests, selectedGuestId, dispatch } = useSeating();
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
  const selectedGuest = selectedGuestId ? (guests.get(selectedGuestId) ?? null) : null;
  const selectedGuestParty = selectedGuest ? (parties.get(selectedGuest.partyId) ?? null) : null;
  const isSelectedGuestAnchored =
    selectedGuestId != null && (state.lockedGuestIds ?? []).includes(selectedGuestId);

  return (
    <aside className="sidebar">
      <div className="sidebar-search-row">
        <div className="sidebar-search-controls">
          <div className="sidebar-search-wrap">
            <Search className="sidebar-search-icon" aria-hidden="true" />
            <Input
              type="search"
              className="h-8 pl-8 text-[13px]"
              data-app-search="true"
              placeholder="Search guests, households, groups"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search unassigned guests, households, and groups"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="sidebar-filter-trigger">
                <Filter aria-hidden="true" />
                <span>Filter</span>
                {activeHostFilterCount > 0 ? (
                  <span className="sidebar-filter-count">{activeHostFilterCount}</span>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="sidebar-filter-menu"
              aria-label="Filter unassigned guests by host">
              <DropdownMenuLabel className="sidebar-filter-menu-title">Hosts</DropdownMenuLabel>
              {availableHosts.length === 0 ? (
                <DropdownMenuItem disabled className="sidebar-filter-empty">
                  No hosts found
                </DropdownMenuItem>
              ) : (
                availableHosts.map((host) => (
                  <DropdownMenuCheckboxItem
                    key={host}
                    checked={selectedHosts.has(host)}
                    className="sidebar-filter-item"
                    onCheckedChange={() => toggleHostFilter(host)}>
                    <span className="sidebar-filter-host-name">{host}</span>
                  </DropdownMenuCheckboxItem>
                ))
              )}
              {activeHostFilterCount > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="sidebar-filter-clear"
                    onSelect={() => clearHostFilters()}>
                    Clear
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="sidebar-highlight-controls" aria-label="Highlight views">
          <button
            type="button"
            className={[
              "sidebar-highlight-toggle sidebar-highlight-toggle--group",
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
              "sidebar-highlight-toggle sidebar-highlight-toggle--household",
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
              "sidebar-highlight-toggle sidebar-highlight-toggle--host",
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
      <div
        ref={setDropzoneRef}
        className={["sidebar-dropzone", isOver ? "is-over" : null].filter(Boolean).join(" ")}>
        {state.unassigned.length === 0 ? (
          <div className="sidebar-empty">All guests are seated ✓</div>
        ) : partiesWithUnassigned.length === 0 ? (
          <div className="sidebar-empty">{emptyStateMessage}</div>
        ) : (
          sortedGroups.map((groupName) => (
            <div key={groupName} className="group-section">
              <GroupCard groupName={groupName} guestIds={groupedGuestIds.get(groupName) ?? []} />
              <div className="group-party-list">
                {groupedParties.get(groupName)?.map((party) => (
                  <HouseholdCard key={party.id} party={party} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {selectedGuest && (
        <section
          className="sidebar-selected-guest"
          aria-live="polite"
          aria-label="Selected guest details">
          <p className="sidebar-selected-guest-name">{selectedGuest.fullName}</p>
          <dl className="sidebar-selected-guest-meta">
            <div>
              <dt>Household</dt>
              <dd>{selectedGuestParty?.household ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{selectedGuest.group || "No Group"}</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd>{selectedGuest.host}</dd>
            </div>
          </dl>
          <div className="sidebar-selected-guest-actions">
            <button
              type="button"
              className={[
                "sidebar-selected-guest-anchor-toggle",
                chipToggleVariants({ state: isSelectedGuestAnchored ? "pressed" : "default", size: "sm" }),
              ]
                .filter(Boolean)
                .join(" ")}
              aria-pressed={isSelectedGuestAnchored}
              aria-label="Anchor selected guest"
              onClick={() => {
                dispatch({
                  type: "SET_GUEST_ANCHORED",
                  guestId: selectedGuest.id,
                  anchored: !isSelectedGuestAnchored,
                });
              }}>
              Anchored
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
