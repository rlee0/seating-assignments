import { createContext, useContext, useMemo, useState } from "react";

import type { ReactNode } from "react";
import { normalizeForSearch } from "../lib/utils";

interface SearchContextValue {
  searchQuery: string;
  normalizedQuery: string;
  setSearchQuery: (query: string) => void;
  isGroupHighlightOn: boolean;
  setGroupHighlightOn: (isOn: boolean) => void;
  isHouseholdHighlightOn: boolean;
  setHouseholdHighlightOn: (isOn: boolean) => void;
  isHostHighlightOn: boolean;
  setHostHighlightOn: (isOn: boolean) => void;
  householdPulseNonce: number;
  activateHouseholdFocusFromGuestSelection: () => void;
  restoreHighlightModeAfterGuestDeselection: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = useMemo(() => normalizeForSearch(searchQuery.trim()), [searchQuery]);
  const [isGroupHighlightOn, setGroupHighlightOn] = useState(true);
  const [isHouseholdHighlightOn, setHouseholdHighlightOn] = useState(false);
  const [isHostHighlightOn, setHostHighlightOn] = useState(false);
  const [householdPulseNonce, setHouseholdPulseNonce] = useState(0);
  const [previousHighlightMode, setPreviousHighlightMode] = useState<
    "group" | "household" | "host" | null
  >(null);

  function getActiveHighlightMode(): "group" | "household" | "host" {
    if (isHouseholdHighlightOn) return "household";
    if (isHostHighlightOn) return "host";
    return "group";
  }

  function handleSetGroupHighlightOn(isOn: boolean) {
    if (isOn) {
      setGroupHighlightOn(true);
      setHouseholdHighlightOn(false);
      setHostHighlightOn(false);
      return;
    }

    if (!isHouseholdHighlightOn && !isHostHighlightOn) return;

    setGroupHighlightOn(false);
  }

  function handleSetHouseholdHighlightOn(isOn: boolean) {
    if (isOn) {
      setHouseholdHighlightOn(true);
      setGroupHighlightOn(false);
      setHostHighlightOn(false);
      return;
    }

    if (!isGroupHighlightOn && !isHostHighlightOn) return;

    setHouseholdHighlightOn(false);
  }

  function handleSetHostHighlightOn(isOn: boolean) {
    if (isOn) {
      setHostHighlightOn(true);
      setGroupHighlightOn(false);
      setHouseholdHighlightOn(false);
      return;
    }

    if (!isGroupHighlightOn && !isHouseholdHighlightOn) return;

    setHostHighlightOn(false);
  }

  function activateHouseholdFocusFromGuestSelection() {
    setPreviousHighlightMode((current) => current ?? getActiveHighlightMode());
    setHouseholdPulseNonce((current) => current + 1);
    setHouseholdHighlightOn(true);
    setGroupHighlightOn(false);
    setHostHighlightOn(false);
  }

  function restoreHighlightModeAfterGuestDeselection() {
    if (!previousHighlightMode) return;

    setGroupHighlightOn(previousHighlightMode === "group");
    setHouseholdHighlightOn(previousHighlightMode === "household");
    setHostHighlightOn(previousHighlightMode === "host");
    setPreviousHighlightMode(null);
  }

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        normalizedQuery,
        setSearchQuery,
        isGroupHighlightOn,
        setGroupHighlightOn: handleSetGroupHighlightOn,
        isHouseholdHighlightOn,
        setHouseholdHighlightOn: handleSetHouseholdHighlightOn,
        isHostHighlightOn,
        setHostHighlightOn: handleSetHostHighlightOn,
        householdPulseNonce,
        activateHouseholdFocusFromGuestSelection,
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
