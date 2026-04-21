import { createContext, useContext, useState } from "react";

import type { ReactNode } from "react";

interface SearchContextValue {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  hostFilters: string[];
  toggleHostFilter: (host: string) => void;
  clearHostFilters: () => void;
  isGroupHighlightOn: boolean;
  setGroupHighlightOn: (isOn: boolean) => void;
  isHouseholdHighlightOn: boolean;
  setHouseholdHighlightOn: (isOn: boolean) => void;
  isHostHighlightOn: boolean;
  setHostHighlightOn: (isOn: boolean) => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [hostFilters, setHostFilters] = useState<string[]>([]);
  const [isGroupHighlightOn, setGroupHighlightOn] = useState(true);
  const [isHouseholdHighlightOn, setHouseholdHighlightOn] = useState(false);
  const [isHostHighlightOn, setHostHighlightOn] = useState(false);

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

  function toggleHostFilter(host: string) {
    setHostFilters((current) => {
      if (current.includes(host)) {
        return current.filter((entry) => entry !== host);
      }

      return [...current, host];
    });
  }

  function clearHostFilters() {
    setHostFilters([]);
  }

  return (
    <SearchContext.Provider
      value={{
        searchQuery,
        setSearchQuery,
        hostFilters,
        toggleHostFilter,
        clearHostFilters,
        isGroupHighlightOn,
        setGroupHighlightOn: handleSetGroupHighlightOn,
        isHouseholdHighlightOn,
        setHouseholdHighlightOn: handleSetHouseholdHighlightOn,
        isHostHighlightOn,
        setHostHighlightOn: handleSetHostHighlightOn,
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
