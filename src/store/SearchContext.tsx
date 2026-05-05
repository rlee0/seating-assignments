import { createContext, useContext, useMemo, useState } from "react";

import type { ReactNode } from "react";
import { normalizeForSearch } from "../lib/utils";

interface SearchContextValue {
  searchQuery: string;
  normalizedQuery: string;
  setSearchQuery: (query: string) => void;
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

const SearchContext = createContext<SearchContextValue | null>(null);

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

  function getActiveHighlightMode(): "circle" | "party" | "host" {
    if (isPartyHighlightOn) return "party";
    if (isHostHighlightOn) return "host";
    return "circle";
  }

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

  function activatePartyFocusFromGuestSelection() {
    setPreviousHighlightMode((current) => current ?? getActiveHighlightMode());
    setPartyPulseNonce((current) => current + 1);
    setPartyHighlightOn(true);
    setCircleHighlightOn(false);
    setHostHighlightOn(false);
  }

  function restoreHighlightModeAfterGuestDeselection() {
    if (!previousHighlightMode) return;

    setCircleHighlightOn(previousHighlightMode === "circle");
    setPartyHighlightOn(previousHighlightMode === "party");
    setHostHighlightOn(previousHighlightMode === "host");
    setPreviousHighlightMode(null);
  }

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        normalizedQuery,
        setSearchQuery,
        isCircleHighlightOn,
        setCircleHighlightOn: handleSetCircleHighlightOn,
        isPartyHighlightOn,
        setPartyHighlightOn: handleSetPartyHighlightOn,
        isHostHighlightOn,
        setHostHighlightOn: handleSetHostHighlightOn,
        partyPulseNonce,
        activatePartyFocusFromGuestSelection,
        restoreHighlightModeAfterGuestDeselection,
      }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}
