import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { ReactNode } from "react";
import { normalizeForSearch } from "../lib/utils";

interface SearchQueryValue {
  searchQuery: string;
  normalizedQuery: string;
  setSearchQuery: (query: string) => void;
}

interface HighlightValue {
  isCircleHighlightOn: boolean;
  setCircleHighlightOn: (isOn: boolean) => void;
  isPartyHighlightOn: boolean;
  setPartyHighlightOn: (isOn: boolean) => void;
  isHostHighlightOn: boolean;
  setHostHighlightOn: (isOn: boolean) => void;
  partyPulseNonce: number;
  activatePartyFocusFromGuestSelection: () => void;
  restoreHighlightModeAfterGuestDeselection: () => void;
}

// Merged type kept for backward-compat (useSearch() consumers).
type SearchContextValue = SearchQueryValue & HighlightValue;

const SearchQueryContext = createContext<SearchQueryValue | null>(null);
const HighlightContext = createContext<HighlightValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery.trim()), [searchQuery]);
  const [isCircleHighlightOn, setCircleHighlightOn] = useState(true);
  const [isPartyHighlightOn, setPartyHighlightOn] = useState(false);
  const [isHostHighlightOn, setHostHighlightOn] = useState(false);
  const [partyPulseNonce, setPartyPulseNonce] = useState(0);
  const [previousHighlightMode, setPreviousHighlightMode] = useState<
    "circle" | "party" | "host" | null
  >(null);

  // Refs so stable callbacks can read the latest values without stale closures.
  const isPartyHighlightOnRef = useRef(isPartyHighlightOn);
  const isHostHighlightOnRef = useRef(isHostHighlightOn);
  const previousHighlightModeRef = useRef(previousHighlightMode);
  isPartyHighlightOnRef.current = isPartyHighlightOn;
  isHostHighlightOnRef.current = isHostHighlightOn;
  previousHighlightModeRef.current = previousHighlightMode;

  function handleSetCircleHighlightOn(isOn: boolean) {
    if (isOn) {
      setCircleHighlightOn(true);
      setPartyHighlightOn(false);
      setHostHighlightOn(false);
      return;
    }

    if (!isPartyHighlightOn && !isHostHighlightOn) return;

    setCircleHighlightOn(false);
  }

  function handleSetPartyHighlightOn(isOn: boolean) {
    if (isOn) {
      setPartyHighlightOn(true);
      setCircleHighlightOn(false);
      setHostHighlightOn(false);
      return;
    }

    if (!isCircleHighlightOn && !isHostHighlightOn) return;

    setPartyHighlightOn(false);
  }

  function handleSetHostHighlightOn(isOn: boolean) {
    if (isOn) {
      setHostHighlightOn(true);
      setCircleHighlightOn(false);
      setPartyHighlightOn(false);
      return;
    }

    if (!isCircleHighlightOn && !isPartyHighlightOn) return;

    setHostHighlightOn(false);
  }

  const stableActivatePartyFocus = useCallback(() => {
    const currentMode = isPartyHighlightOnRef.current
      ? "party"
      : isHostHighlightOnRef.current
        ? "host"
        : "circle";
    setPreviousHighlightMode((prev) => prev ?? currentMode);
    setPartyPulseNonce((n) => n + 1);
    setPartyHighlightOn(true);
    setCircleHighlightOn(false);
    setHostHighlightOn(false);
  }, []);

  const stableRestoreHighlightMode = useCallback(() => {
    const prev = previousHighlightModeRef.current;
    if (!prev) return;
    setCircleHighlightOn(prev === "circle");
    setPartyHighlightOn(prev === "party");
    setHostHighlightOn(prev === "host");
    setPreviousHighlightMode(null);
  }, []);

  const searchQueryValue = useMemo<SearchQueryValue>(
    () => ({ searchQuery, normalizedQuery, setSearchQuery }),
    [searchQuery, normalizedQuery]
  );

  const highlightValue = useMemo<HighlightValue>(
    () => ({
      isCircleHighlightOn,
      setCircleHighlightOn: handleSetCircleHighlightOn,
      isPartyHighlightOn,
      setPartyHighlightOn: handleSetPartyHighlightOn,
      isHostHighlightOn,
      setHostHighlightOn: handleSetHostHighlightOn,
      partyPulseNonce,
      activatePartyFocusFromGuestSelection: stableActivatePartyFocus,
      restoreHighlightModeAfterGuestDeselection: stableRestoreHighlightMode,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      isCircleHighlightOn,
      isPartyHighlightOn,
      isHostHighlightOn,
      partyPulseNonce,
      stableActivatePartyFocus,
      stableRestoreHighlightMode,
    ]
  );

  return (
    <SearchQueryContext.Provider value={searchQueryValue}>
      <HighlightContext.Provider value={highlightValue}>{children}</HighlightContext.Provider>
    </SearchQueryContext.Provider>
  );
}

export function useSearchQuery(): SearchQueryValue {
  const ctx = useContext(SearchQueryContext);
  if (!ctx) throw new Error("useSearchQuery must be used within SearchProvider");
  return ctx;
}

export function useHighlight(): HighlightValue {
  const ctx = useContext(HighlightContext);
  if (!ctx) throw new Error("useHighlight must be used within SearchProvider");
  return ctx;
}

/** Merged hook — subscribes to both contexts. Use for components that need both. */
export function useSearch(): SearchContextValue {
  const query = useSearchQuery();
  const highlight = useHighlight();
  return { ...query, ...highlight };
}
