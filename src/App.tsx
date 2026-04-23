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
import { AlertTriangle, Download, Moon, RotateCcw, Sun, Upload } from "lucide-react";
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
import { X } from "lucide-react";

import Sidebar from "./components/Sidebar";
import TableBoard from "./components/TableBoard";
import { getGuestSourceSignature, parseGuestsFromRows, type ParsedData } from "./data/parseGuests";
import {
  clearPersistedAppState,
  applyTheme,
  isCompatibleState,
  isGuestInputRow,
  loadPersistedGuestRows,
  resolvePreferredTheme,
  reconcileStateToGuestIds,
  saveGuestDataSourceSignature,
  savePersistedGuestRows,
  savePersistedSeating,
  saveTheme,
  type AppTheme,
} from "./store/localStorage";
import { cn } from "./lib/utils";
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

function arePreviewTablesEqual(nextTables: TableState[], prevTables: TableState[]): boolean {
  if (nextTables.length !== prevTables.length) return false;

  for (let tableIndex = 0; tableIndex < nextTables.length; tableIndex += 1) {
    const nextTable = nextTables[tableIndex];
    const prevTable = prevTables[tableIndex];

    if (nextTable.tableNumber !== prevTable.tableNumber) return false;
    if (nextTable.guestIds.length !== prevTable.guestIds.length) return false;

    for (let seatIndex = 0; seatIndex < nextTable.guestIds.length; seatIndex += 1) {
      if (nextTable.guestIds[seatIndex] !== prevTable.guestIds[seatIndex]) return false;
    }
  }

  return true;
}

type DragOverlaySnapshot = {
  node: HTMLElement;
  width: number;
  height: number;
};

function findGuestChipById(
  guestId: string,
  predicate?: (el: HTMLElement) => boolean
): HTMLElement | null {
  const chips = document.querySelectorAll<HTMLElement>("[data-guest-chip][data-guest-id]");
  for (const chip of chips) {
    if (chip.dataset.guestId !== guestId) continue;
    if (!predicate || predicate(chip)) return chip;
  }
  return null;
}

function resolveDragOverlaySourceElement(intent: DragIntent): HTMLElement | null {
  if (intent.kind === "guest") {
    if (
      intent.source === "seated" &&
      typeof intent.tableNumber === "number" &&
      typeof intent.seatIndex === "number"
    ) {
      const seatId = `seat-${intent.tableNumber}-${intent.seatIndex}`;
      return findGuestChipById(
        intent.guestId,
        (chip) => chip.closest<HTMLElement>("[data-seat-slot]")?.dataset.seatId === seatId
      );
    }

    return findGuestChipById(intent.guestId, (chip) => !!chip.closest("[data-sidebar]"));
  }

  if (intent.kind === "household") {
    const cards = document.querySelectorAll<HTMLElement>("[data-household-card][data-party-id]");
    for (const card of cards) {
      if (card.dataset.partyId === intent.partyId) return card;
    }
    return null;
  }

  if (intent.kind === "group") {
    const cards = document.querySelectorAll<HTMLElement>("[data-group-card][data-group-name]");
    for (const card of cards) {
      if (card.dataset.groupName === intent.groupName) return card;
    }
    return null;
  }

  if (intent.kind === "table") {
    const roots = document.querySelectorAll<HTMLElement>(
      "[data-table-drag-root][data-table-number]"
    );
    for (const root of roots) {
      if (root.dataset.tableNumber !== String(intent.tableNumber)) continue;
      const card = root.querySelector<HTMLElement>("[data-table-card]");
      if (card) return card;
    }
  }

  return null;
}

function sanitizeOverlayClone(node: HTMLElement): void {
  node.classList.remove("opacity-0");
  node.style.opacity = "1";
  node.style.pointerEvents = "none";

  const hiddenNodes = node.querySelectorAll<HTMLElement>(".opacity-0");
  hiddenNodes.forEach((hiddenNode) => hiddenNode.classList.remove("opacity-0"));
}

function captureDragOverlaySnapshot(intent: DragIntent): DragOverlaySnapshot | null {
  const sourceNode = resolveDragOverlaySourceElement(intent);
  if (!sourceNode) return null;

  const rect = sourceNode.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;

  const clone = sourceNode.cloneNode(true);
  if (!(clone instanceof HTMLElement)) return null;
  sanitizeOverlayClone(clone);

  return {
    node: clone,
    width: rect.width,
    height: rect.height,
  };
}

function DragOverlayClone({ snapshot }: { snapshot: DragOverlaySnapshot }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    mountNode.replaceChildren(snapshot.node.cloneNode(true));
    const child = mountNode.firstElementChild;
    if (child instanceof HTMLElement) {
      sanitizeOverlayClone(child);
      child.style.width = `${snapshot.width}px`;
      child.style.height = `${snapshot.height}px`;
    }

    return () => {
      mountNode.replaceChildren();
    };
  }, [snapshot]);

  return <div ref={mountRef} className="pointer-events-none" />;
}

// ─── SeatingApp ───────────────────────────────────────────────────────────────

function SeatingApp({
  guestRows,
  onImportSnapshot,
  onReset,
  theme,
  onThemeToggle,
}: {
  guestRows: GuestInputRow[];
  onImportSnapshot: (nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) => void;
  onReset: () => void;
  theme: AppTheme;
  onThemeToggle: () => void;
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
  const [dragOverlaySnapshot, setDragOverlaySnapshot] = useState<DragOverlaySnapshot | null>(null);
  /** Tracks the latest pointer position for seat-level probe during drag-end. */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const previewTargetKeyRef = useRef<string | null>(null);
  const previewLastComputedAtRef = useRef(0);

  // Derived drag state passed down to child components.
  const activeDragKind: DragKind | null = activeDragIntent?.kind ?? null;
  const activeDragGuestId: string | null =
    activeDragIntent?.kind === "guest" ? activeDragIntent.guestId : null;

  // ── Other state ─────────────────────────────────────────────────────────────
  const [showWarnings, setShowWarnings] = useState(false);
  const [autoAssignWarning, setAutoAssignWarning] = useState<string | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);
  const autoAssignWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!autoAssignWarning) return;
    if (autoAssignWarningTimerRef.current) clearTimeout(autoAssignWarningTimerRef.current);
    autoAssignWarningTimerRef.current = setTimeout(() => setAutoAssignWarning(null), 6000);
    return () => {
      if (autoAssignWarningTimerRef.current) clearTimeout(autoAssignWarningTimerRef.current);
    };
  }, [autoAssignWarning]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const updateHeaderOffset = () => {
      setHeaderOffset(header.getBoundingClientRect().height + 8);
    };

    updateHeaderOffset();

    const resizeObserver = new ResizeObserver(() => {
      updateHeaderOffset();
    });

    resizeObserver.observe(header);
    window.addEventListener("resize", updateHeaderOffset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeaderOffset);
    };
  }, []);

  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "tables">("sidebar");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);

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
      if (!target.closest("[data-guest-chip]")) {
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
    previewTargetKeyRef.current = null;
    previewLastComputedAtRef.current = 0;
    setDragOverlaySnapshot(captureDragOverlaySnapshot(intent));
    setActiveDragIntent(intent);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragIntent(null);
    setAutoSeatPreview(null);
    setDragOverlaySnapshot(null);
    pointerRef.current = null;
    previewTargetKeyRef.current = null;
    previewLastComputedAtRef.current = 0;
  }, []);

  const handleDragOver = useCallback(
    ({ active, over }: DragOverEvent) => {
      const clearPreview = () => {
        previewTargetKeyRef.current = null;
        setAutoSeatPreview((prev) => (prev === null ? prev : null));
      };

      if (!over) {
        clearPreview();
        return;
      }
      const intent = parseDragIntent(active.data.current);
      if (!intent) {
        clearPreview();
        return;
      }

      // Guest seat drops need stable local feedback; table-level preview introduces
      // seat-vs-table flicker as the pointer crosses slot boundaries.
      if (intent.kind === "guest") {
        clearPreview();
        return;
      }

      // Only preview table-level and autoseat drops — seat drops are single-slot.
      const target = resolveDropTarget(over, null);
      if (!target || target.type === "seat" || target.type === "unassigned") {
        clearPreview();
        return;
      }

      const targetKey =
        target.type === "table"
          ? `${intent.kind}:table:${target.tableNumber}`
          : `${intent.kind}:auto-seat`;
      const now = performance.now();
      const elapsed = now - previewLastComputedAtRef.current;
      const isSameTarget = previewTargetKeyRef.current === targetKey;

      // While hovering the same drop target, recompute preview at most every 60ms.
      if (isSameTarget && elapsed < 60) {
        return;
      }

      const action = routeDrop(intent, target, { state, guestProfiles, parties });
      if (!action) {
        clearPreview();
        return;
      }

      previewTargetKeyRef.current = targetKey;
      previewLastComputedAtRef.current = now;
      const previewState = seatingReducer(state, action);
      setAutoSeatPreview((prev) => {
        if (prev && arePreviewTablesEqual(previewState.tables, prev.tables)) return prev;
        return { tables: previewState.tables };
      });
    },
    [guestProfiles, parties, state]
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveDragIntent(null);
      setAutoSeatPreview(null);
      setDragOverlaySnapshot(null);
      const ptr = pointerRef.current;
      pointerRef.current = null;
      previewTargetKeyRef.current = null;
      previewLastComputedAtRef.current = 0;

      const intent = parseDragIntent(active.data.current);
      if (!intent) return;

      const target = resolveDropTarget(over, ptr);
      if (!target) return;

      const action = routeDrop(intent, target, { state, guestProfiles, parties });
      if (action) {
        if (action.type === "AUTO_ASSIGN_GUESTS" && action.guestIds.length > 0) {
          const nextState = seatingReducer(state, action);
          const nextUnassigned = new Set(nextState.unassigned);
          const failedIds = action.guestIds.filter((id) => nextUnassigned.has(id));
          if (failedIds.length > 0) {
            const MAX_NAMES = 3;
            const names = failedIds.slice(0, MAX_NAMES).map((id) => guests.get(id)?.fullName ?? id);
            const overflow = failedIds.length - MAX_NAMES;
            const nameStr =
              overflow > 0 ? `${names.join(", ")} and ${overflow} more` : names.join(", ");
            // For manual drag drops with allowPartialPlacementBypass, only warn about seat capacity limits.
            // For other auto-assign actions, mention the additional constraints.
            const constraintHint = action.allowPartialPlacementBypass
              ? "Try a different table or row."
              : "Try a different table, or check group row and side constraints.";
            setAutoAssignWarning(`${nameStr} couldn't be seated. ${constraintHint}`);
          } else {
            setAutoAssignWarning(null);
          }
        } else {
          setAutoAssignWarning(null);
        }
        dispatch(action);
      }
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
  }

  async function handleFileDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;

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
  const overlayContent = dragOverlaySnapshot ? (
    <DragOverlayClone snapshot={dragOverlaySnapshot} />
  ) : null;

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
        className={cn(
          "relative flex h-screen flex-col overflow-hidden",
          activeDragKind === "guest" && "**:cursor-grabbing!"
        )}
        data-drag-kind={activeDragKind ?? undefined}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}>
        <header
          ref={headerRef}
          className="z-10 flex shrink-0 flex-wrap items-center gap-4 border-b border-border bg-card px-4 py-2.5">
          <h1 className="whitespace-nowrap text-lg font-semibold text-foreground">
            Seating Assignments
          </h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onThemeToggle}>
              {theme === "dark" ? (
                <Sun size={14} aria-hidden="true" />
              ) : (
                <Moon size={14} aria-hidden="true" />
              )}
              <span className="max-sm:hidden">{theme === "dark" ? "Light" : "Dark"}</span>
            </Button>
            {warnings.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-warning/30 bg-warning/10 text-warning-foreground hover:border-warning/45 hover:bg-warning/15"
                onClick={() => setShowWarnings((v) => !v)}>
                <AlertTriangle size={14} aria-hidden="true" />
                {warnings.length} data {warnings.length === 1 ? "issue" : "issues"}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw size={14} aria-hidden="true" />
              <span className="max-sm:hidden">Reset</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" />
              <span className="max-sm:hidden">Import</span>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleExport}>
              <Download size={14} aria-hidden="true" />
              <span className="max-sm:hidden">Export</span>
            </Button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept="application/json,.json"
              aria-label="Import seating JSON file"
              onChange={handleImportChange}
            />
          </div>
        </header>

        {autoAssignWarning && (
          <div
            className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
            style={{ top: headerOffset }}>
            <div
              role="alert"
              className="auto-assign-warning pointer-events-auto grid w-full max-w-3xl grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border border-warning/35 bg-[color-mix(in_oklab,var(--card)_84%,var(--warning)_16%)] px-4 py-3 text-warning-foreground shadow-lg backdrop-blur supports-backdrop-filter:bg-[color-mix(in_oklab,var(--card)_72%,var(--warning)_28%)]">
              <AlertTriangle
                className="auto-assign-warning__icon h-4 w-4 shrink-0 text-warning"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="auto-assign-warning__title">Auto-seat blocked</p>
                <p className="auto-assign-warning__message">{autoAssignWarning}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="auto-assign-warning__dismiss"
                onClick={() => setAutoAssignWarning(null)}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

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

        <div className="flex flex-1 overflow-hidden">
          <div className={cn("contents", mobilePanel === "tables" && "max-sm:hidden")}>
            <Sidebar />
          </div>
          <div className={cn("contents", mobilePanel === "sidebar" && "max-sm:hidden")}>
            <TableBoard
              activeDragKind={activeDragKind}
              activeDragGuestId={activeDragGuestId}
              autoSeatPreview={autoSeatPreview}
            />
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-100 hidden h-13 border-t border-border bg-card max-sm:flex">
          <button
            type="button"
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center border-none bg-transparent px-0 text-sm font-medium text-muted-foreground transition-[color,background] duration-120 active:bg-accent",
              mobilePanel === "sidebar" && "border-t-2 border-primary text-foreground"
            )}
            onClick={() => setMobilePanel("sidebar")}>
            Unassigned{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
          </button>
          <button
            type="button"
            className={cn(
              "flex flex-1 cursor-pointer items-center justify-center border-none bg-transparent px-0 text-sm font-medium text-muted-foreground transition-[color,background] duration-120 active:bg-accent",
              mobilePanel === "tables" && "border-t-2 border-primary text-foreground"
            )}
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
  const [theme, setTheme] = useState<AppTheme>(() => resolvePreferredTheme());
  const parsedData = useMemo(() => parseGuestsFromRows(guestRows), [guestRows]);
  const sourceSignature = getGuestSourceSignature();

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

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
          theme={theme}
          onThemeToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        />
      </SeatingProvider>
    </SearchProvider>
  );
}
