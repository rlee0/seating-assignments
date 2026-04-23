import "./App.css";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AlertTriangle, Download, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeatingProvider, useSeating } from "./store/SeatingContext";
import { SearchProvider } from "./store/SearchContext";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
} from "react";

import Sidebar from "./components/Sidebar";
import TableBoard from "./components/TableBoard";
import { getGuestSourceSignature, parseGuestsFromRows, type ParsedData } from "./data/parseGuests";
import {
  clearPersistedAppState,
  isCompatibleState,
  isGuestInputRow,
  loadPersistedGuestRows,
  reconcileStateToGuestIds,
  saveGuestDataSourceSignature,
  savePersistedGuestRows,
  savePersistedSeating,
} from "./store/localStorage";
import {
  EXPORT_FORMAT_VERSION,
  TABLE_CAPACITY,
  TABLE_COUNT,
  type GuestInputRow,
  type PersistedSeatingData,
  type SeatingExportData,
  type TableState,
} from "./types";
import { seatingReducer, type GuestProfile } from "./store/reducer";
import { dndCollisionDetection } from "./dnd/collision";
import { parseDragIntent, resolveDropTarget } from "./dnd/parsers";
import { routeDrop } from "./dnd/router";
import type { DragIntent, DragKind } from "./dnd/types";

// ─── Utility functions ────────────────────────────────────────────────────────

function buildGuestProfiles(
  guests: ParsedData["guests"],
  parties: ParsedData["parties"]
): Record<string, GuestProfile> {
  const profiles: Record<string, GuestProfile> = {};

  for (const [guestId, guest] of guests) {
    const party = parties.get(guest.partyId);

    profiles[guestId] = {
      partyId: guest.partyId,
      group: guest.group || "",
      host: guest.host,
      household: party?.household ?? "",
    };
  }

  return profiles;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  return (
    target.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

function getInitialGuestRows(): GuestInputRow[] {
  const sourceSignature = getGuestSourceSignature();
  return loadPersistedGuestRows(sourceSignature) ?? [];
}

function isTableStateForImport(value: unknown): value is TableState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    tableNumber?: unknown;
    name?: unknown;
    guestIds?: unknown;
  };

  return (
    typeof candidate.tableNumber === "number" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.guestIds) &&
    candidate.guestIds.length === TABLE_CAPACITY &&
    candidate.guestIds.every((guestId) => guestId === null || typeof guestId === "string")
  );
}

function parseImportPayload(value: unknown): {
  guests: GuestInputRow[];
  tables: TableState[];
} | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    version?: unknown;
    guests?: unknown;
    tables?: unknown;
  };

  if (candidate.version !== EXPORT_FORMAT_VERSION) return null;

  if (!Array.isArray(candidate.guests) || !candidate.guests.every((row) => isGuestInputRow(row))) {
    return null;
  }

  if (
    !Array.isArray(candidate.tables) ||
    candidate.tables.length !== TABLE_COUNT ||
    !candidate.tables.every((table) => isTableStateForImport(table))
  ) {
    return null;
  }

  return {
    guests: candidate.guests.map((row) => ({ ...row })),
    tables: candidate.tables.map((table) => ({
      ...table,
      guestIds: [...table.guestIds],
    })),
  };
}

function buildExportPayload(
  guests: GuestInputRow[],
  seating: PersistedSeatingData
): SeatingExportData {
  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    guests: guests.map((row) => ({ ...row })),
    tables: seating.state.tables.map((table) => ({
      ...table,
      guestIds: [...table.guestIds],
    })),
  };
}

function buildExportFilename(): string {
  return `seating-export-${new Date().toISOString().slice(0, 10)}.json`;
}

function getFirstJsonFile(files: FileList | null): File | null {
  if (!files || files.length === 0) return null;

  for (const file of Array.from(files)) {
    if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) {
      return file;
    }
  }

  return null;
}

// ─── SeatingApp ───────────────────────────────────────────────────────────────

function SeatingApp({
  guestRows,
  onImportSnapshot,
  onReset,
}: {
  guestRows: GuestInputRow[];
  onImportSnapshot: (nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) => void;
  onReset: () => void;
}) {
  const {
    state,
    snapshot,
    dispatch,
    undo,
    redo,
    canUndo,
    canRedo,
    guests,
    parties,
    warnings,
    selectedGuestId,
    clearSelectedGuest,
  } = useSeating();

  // ── Drag state ──────────────────────────────────────────────────────────────
  const [activeDragIntent, setActiveDragIntent] = useState<DragIntent | null>(null);
  const [autoSeatPreview, setAutoSeatPreview] = useState<{
    tables: import("./types").TableState[];
  } | null>(null);
  /** Tracks the latest pointer position for seat-level probe during drag-end. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  // Derived drag state passed down to child components.
  const activeDragKind: DragKind | null = activeDragIntent?.kind ?? null;
  const activeDragGuestId: string | null =
    activeDragIntent?.kind === "guest" ? activeDragIntent.guestId : null;

  // ── Other state ─────────────────────────────────────────────────────────────
  const [showWarnings, setShowWarnings] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "tables">("sidebar");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const guestProfiles = useMemo(() => buildGuestProfiles(guests, parties), [guests, parties]);

  // ── Pointer tracking for seat-level probe ────────────────────────────────────
  useEffect(() => {
    if (!activeDragIntent) return;

    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (touch) pointerRef.current = { x: touch.clientX, y: touch.clientY };
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [activeDragIntent]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      const isFindShortcut =
        isModifierPressed && !event.shiftKey && event.key.toLowerCase() === "f";
      const isZKey = event.key.toLowerCase() === "z";
      const isUndoShortcut = isModifierPressed && !event.shiftKey && isZKey;
      const isRedoShortcut = isModifierPressed && event.shiftKey && isZKey;
      const isDeleteKey = event.key === "Backspace" || event.key === "Delete";

      if (isFindShortcut) {
        const searchInput = document.querySelector<HTMLInputElement>("[data-app-search='true']");
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (event.altKey || isEditableTarget(event.target)) return;

      if (isUndoShortcut && canUndo) {
        event.preventDefault();
        undo();
      }

      if (isRedoShortcut && canRedo) {
        event.preventDefault();
        redo();
      }

      if (event.key === "Escape") {
        clearSelectedGuest();
        (document.activeElement as HTMLElement | null)?.blur();
      }

      if (isDeleteKey && selectedGuestId) {
        const isAssigned = !state.unassigned.includes(selectedGuestId);
        if (isAssigned) {
          event.preventDefault();
          dispatch({ type: "REMOVE_GUESTS", guestIds: [selectedGuestId] });
          clearSelectedGuest();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canRedo,
    canUndo,
    clearSelectedGuest,
    dispatch,
    redo,
    selectedGuestId,
    state.unassigned,
    undo,
  ]);

  // ── Click-to-deselect guest ───────────────────────────────────────────────────
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".guest-chip, .sidebar-selected-guest")) {
        clearSelectedGuest();
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [clearSelectedGuest]);

  // ── dnd-kit sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // ── Drag handlers ─────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const intent = parseDragIntent(event.active.data.current);
    if (!intent) return;
    setActiveDragIntent(intent);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragIntent(null);
    setAutoSeatPreview(null);
    pointerRef.current = null;
  }, []);

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      if (!over) {
        setAutoSeatPreview(null);
        return;
      }
      const intent = parseDragIntent(active.data.current);
      if (!intent) {
        setAutoSeatPreview(null);
        return;
      }
      // Only preview table-level and autoseat drops — seat drops are single-slot.
      const target = resolveDropTarget(over, null);
      if (!target || target.type === "seat" || target.type === "unassigned") {
        setAutoSeatPreview(null);
        return;
      }
      const action = routeDrop(intent, target, { state, guestProfiles, parties });
      if (!action) {
        setAutoSeatPreview(null);
        return;
      }
      const previewState = seatingReducer(state, action);
      setAutoSeatPreview({ tables: previewState.tables });
    },
    [guestProfiles, parties, state]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveDragIntent(null);
      setAutoSeatPreview(null);
      const ptr = pointerRef.current;
      pointerRef.current = null;

      const intent = parseDragIntent(active.data.current);
      if (!intent) return;

      const target = resolveDropTarget(over, ptr);
      if (!target) return;

      const action = routeDrop(intent, target, { state, guestProfiles, parties });
      if (action) dispatch(action);
    },
    [dispatch, guestProfiles, parties, state]
  );

  // ── File import/export ────────────────────────────────────────────────────────
  const importFromFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const parsed = parseImportPayload(JSON.parse(text) as unknown);

        if (!parsed) {
          window.alert("Import failed. Use v2 JSON with version, guests, and tables.");
          return;
        }

        const { allGuestIds: importedGuestIds } = parseGuestsFromRows(parsed.guests);
        const reconciledState = reconcileStateToGuestIds(
          { tables: parsed.tables, unassigned: [], lockedGuestIds: [] },
          importedGuestIds
        );

        if (!reconciledState || !isCompatibleState(reconciledState, importedGuestIds)) {
          window.alert("Import failed. The tables payload is invalid for the provided guests.");
          return;
        }

        const snapshotToImport: PersistedSeatingData = {
          state: reconciledState,
          history: [],
          future: [],
        };

        onImportSnapshot(parsed.guests, snapshotToImport);
      } catch {
        window.alert("Import failed. The selected file is not valid JSON.");
      }
    },
    [onImportSnapshot]
  );

  const handleImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = getFirstJsonFile(event.target.files);
      event.target.value = "";

      if (!file) {
        window.alert("Import failed. Select a .json file.");
        return;
      }

      await importFromFile(file);
    },
    [importFromFile]
  );

  function handleFileDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsFileDragOver(true);
  }

  function handleFileDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleFileDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setIsFileDragOver(false);
  }

  async function handleFileDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setIsFileDragOver(false);

    const file = getFirstJsonFile(event.dataTransfer.files);
    if (!file) return;

    await importFromFile(file);
  }

  function handleReset() {
    if (window.confirm("Reset all seating assignments? This will clear all table placements.")) {
      onReset();
    }
  }

  function handleExport() {
    const payload = buildExportPayload(guestRows, snapshot);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExportFilename();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const unassignedCount = state.unassigned.length;

  // ── Overlay content ───────────────────────────────────────────────────────
  const overlayContent = useMemo(() => {
    if (!activeDragIntent) return null;

    if (activeDragIntent.kind === "guest") {
      const guest = guests.get(activeDragIntent.guestId);
      if (!guest) return null;
      return (
        <span className="guest-chip guest-chip--sidebar drag-overlay-guest-chip">
          <span className="guest-name">{guest.fullName}</span>
        </span>
      );
    }

    if (activeDragIntent.kind === "household") {
      const party = parties.get(activeDragIntent.partyId);
      if (!party) return null;
      const memberCount = party.guestIds.length;
      return (
        <div className="drag-overlay-party">
          <div className="drag-overlay-party-name">{party.household}</div>
          <div className="drag-overlay-party-count">{memberCount} guests</div>
        </div>
      );
    }

    if (activeDragIntent.kind === "group") {
      const memberCount = Array.from(guests.values()).filter(
        (g) => g.group === activeDragIntent.groupName
      ).length;
      return (
        <div className="drag-overlay-group">
          <div className="drag-overlay-group-name">{activeDragIntent.groupName}</div>
          <div className="drag-overlay-group-count">{memberCount} guests</div>
        </div>
      );
    }

    if (activeDragIntent.kind === "table") {
      const table = state.tables.find((t) => t.tableNumber === activeDragIntent.tableNumber);
      const occupiedCount = table ? table.guestIds.filter(Boolean).length : 0;
      return (
        <div className="drag-overlay-table">
          {activeDragIntent.name} &mdash; {occupiedCount} guests
        </div>
      );
    }

    return null;
  }, [activeDragIntent, guests, parties, state.tables]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dndCollisionDetection}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}>
      <div
        className={[
          "app",
          activeDragKind ? "app--dragging" : null,
          activeDragKind === "guest" ? "app--guest-dragging" : null,
          isFileDragOver ? "app--file-drop-target" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}>
        <header className="app-header">
          <h1>Seating Assignments</h1>
          <div className="app-actions">
            {warnings.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-yellow-300 bg-yellow-50 text-yellow-900 hover:bg-yellow-100 hover:border-yellow-400"
                onClick={() => setShowWarnings((v) => !v)}>
                <AlertTriangle size={14} aria-hidden="true" />
                {warnings.length} data {warnings.length === 1 ? "issue" : "issues"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw size={14} aria-hidden="true" />
              <span className="btn-label">Reset</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" />
              <span className="btn-label">Import</span>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              <Download size={14} aria-hidden="true" />
              <span className="btn-label">Export</span>
            </Button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              aria-label="Import seating JSON file"
              onChange={handleImportChange}
            />
          </div>
        </header>

        {showWarnings && (
          <div className="px-4 pb-2">
            <Alert className="max-h-32 overflow-y-auto" variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Data issues</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        )}

        <div className={`app-body app-body--${mobilePanel}`}>
          <Sidebar />
          <TableBoard
            activeDragKind={activeDragKind}
            activeDragGuestId={activeDragGuestId}
            autoSeatPreview={autoSeatPreview}
          />
        </div>

        <div className="mobile-tabs">
          <button
            type="button"
            className={`mobile-tab${mobilePanel === "sidebar" ? " mobile-tab--active" : ""}`}
            onClick={() => setMobilePanel("sidebar")}>
            Unassigned{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
          </button>
          <button
            type="button"
            className={`mobile-tab${mobilePanel === "tables" ? " mobile-tab--active" : ""}`}
            onClick={() => setMobilePanel("tables")}>
            Tables
          </button>
        </div>

        <DragOverlay dropAnimation={null}>{overlayContent}</DragOverlay>
      </div>
    </DndContext>
  );
}

// ─── App (root) ───────────────────────────────────────────────────────────────

export default function App() {
  const [guestRows, setGuestRows] = useState<GuestInputRow[]>(() => getInitialGuestRows());
  const [providerVersion, setProviderVersion] = useState(0);
  const parsedData = useMemo(() => parseGuestsFromRows(guestRows), [guestRows]);
  const sourceSignature = getGuestSourceSignature();

  useEffect(() => {
    saveGuestDataSourceSignature(sourceSignature);
    savePersistedGuestRows(guestRows);
  }, [guestRows, sourceSignature]);

  const handleImportSnapshot = useCallback(
    (nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) => {
      saveGuestDataSourceSignature(sourceSignature);
      savePersistedGuestRows(nextGuestRows);
      savePersistedSeating(snapshot.state, snapshot.history, snapshot.future);
      setGuestRows(nextGuestRows);
      setProviderVersion((value) => value + 1);
    },
    [sourceSignature]
  );

  const handleResetApp = useCallback(() => {
    clearPersistedAppState();
    setGuestRows([]);
    setProviderVersion((value) => value + 1);
  }, []);

  return (
    <SearchProvider>
      <SeatingProvider key={providerVersion} parsedData={parsedData}>
        <SeatingApp
          guestRows={guestRows}
          onImportSnapshot={handleImportSnapshot}
          onReset={handleResetApp}
        />
      </SeatingProvider>
    </SearchProvider>
  );
}
