import "./App.css";

import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AlertTriangle, Download, Redo2, RotateCcw, Undo2, Upload } from "lucide-react";
import { SeatingProvider, useSeating } from "./store/SeatingContext";
import { SearchProvider } from "./store/SearchContext";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import Sidebar from "./components/Sidebar";
import TableBoard from "./components/TableBoard";
import {
  getDefaultGuestRows,
  getGuestSourceSignature,
  parseGuestsFromRows,
  type ParsedData,
} from "./data/parseGuests";
import {
  clearPersistedAppState,
  loadPersistedGuestRows,
  parsePersistedSeatingData,
  saveGuestDataSourceSignature,
  savePersistedGuestRows,
  savePersistedSeating,
} from "./store/localStorage";
import {
  EXPORT_FORMAT_VERSION,
  TABLE_COUNT,
  type GuestInputRow,
  type PersistedSeatingData,
  type SeatingExportData,
} from "./types";

type ActiveDragData =
  | { kind: "party"; partyId: string }
  | { kind: "guest"; guestId: string }
  | { kind: "group"; groupName: string }
  | { kind: "table"; tableNumber: number; name: string };

function isActiveDragData(value: unknown): value is ActiveDragData {
  if (!value || typeof value !== "object") return false;

  const maybeData = value as Record<string, unknown>;
  if (maybeData.kind === "guest") return typeof maybeData.guestId === "string";
  if (maybeData.kind === "party") return typeof maybeData.partyId === "string";
  if (maybeData.kind === "group") return typeof maybeData.groupName === "string";

  return (
    maybeData.kind === "table" &&
    typeof maybeData.tableNumber === "number" &&
    typeof maybeData.name === "string"
  );
}

function getUnassignedGuestIdsForParty(
  partyId: string,
  parties: ParsedData["parties"],
  unassignedSet: Set<string>
): string[] {
  const party = parties.get(partyId);
  if (!party) return [];

  return party.guestIds.filter((guestId) => unassignedSet.has(guestId));
}

function getUnassignedGuestIdsForGroup(
  groupName: string,
  parties: ParsedData["parties"],
  unassignedSet: Set<string>
): string[] {
  const guestIds: string[] = [];

  for (const party of parties.values()) {
    if ((party.group || "No Group") !== groupName) continue;

    guestIds.push(...party.guestIds.filter((guestId) => unassignedSet.has(guestId)));
  }

  return guestIds;
}

function resolveDragGuestIds(
  data: ActiveDragData,
  parties: ParsedData["parties"],
  unassignedGuestIds: string[]
): string[] {
  const unassignedSet = new Set(unassignedGuestIds);

  switch (data.kind) {
    case "guest":
      return [data.guestId];
    case "party":
      return getUnassignedGuestIdsForParty(data.partyId, parties, unassignedSet);
    case "group":
      return getUnassignedGuestIdsForGroup(data.groupName, parties, unassignedSet);
    case "table":
      return [];
  }
}

function parseSeatTarget(targetId: string): { tableNumber: number; seatIndex: number } | null {
  if (!targetId.startsWith("seat-")) return null;

  const [, tableToken, seatToken] = targetId.split("-");
  const tableNumber = Number.parseInt(tableToken, 10);
  const seatIndex = Number.parseInt(seatToken, 10);

  if (Number.isNaN(tableNumber) || Number.isNaN(seatIndex)) return null;
  return { tableNumber, seatIndex };
}

function parseTableNumber(targetId: string): number | null {
  if (targetId.startsWith("sortable-table-")) {
    return parseInt(targetId.slice("sortable-table-".length), 10);
  }

  if (targetId.startsWith("table-")) {
    return parseInt(targetId.slice(6), 10);
  }

  return null;
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

  return loadPersistedGuestRows(sourceSignature) ?? getDefaultGuestRows();
}

function isGuestInputRow(value: unknown): value is GuestInputRow {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    rsvp?: unknown;
    household?: unknown;
    group?: unknown;
    fullName?: unknown;
  };

  return (
    (candidate.rsvp === "r" || candidate.rsvp === "s") &&
    typeof candidate.household === "string" &&
    typeof candidate.group === "string" &&
    typeof candidate.fullName === "string"
  );
}

function isCompatibleState(snapshot: PersistedSeatingData, guestRows: GuestInputRow[]): boolean {
  const allGuestIds = guestRows.map((_, index) => `g${index}`);
  const savedIds = [
    ...snapshot.state.unassigned,
    ...snapshot.state.tables.flatMap((table) =>
      table.guestIds.filter((guestId): guestId is string => guestId !== null)
    ),
  ];
  const uniqueSavedIds = new Set(savedIds);
  const currentIds = new Set(allGuestIds);

  if (snapshot.state.tables.length === 0 || snapshot.state.tables.length !== TABLE_COUNT) {
    return false;
  }

  return (
    savedIds.length === currentIds.size &&
    uniqueSavedIds.size === currentIds.size &&
    [...currentIds].every((id) => uniqueSavedIds.has(id))
  );
}

function parseImportPayload(value: unknown): {
  guestRows: GuestInputRow[];
  seating: PersistedSeatingData;
} | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as {
    version?: unknown;
    guestRows?: unknown;
    seating?: unknown;
  };

  if (candidate.version !== EXPORT_FORMAT_VERSION) return null;
  if (
    !Array.isArray(candidate.guestRows) ||
    !candidate.guestRows.every((row) => isGuestInputRow(row))
  ) {
    return null;
  }

  const seating = parsePersistedSeatingData(candidate.seating);
  if (!seating) return null;

  return {
    guestRows: candidate.guestRows.map((row) => ({ ...row })),
    seating,
  };
}

function buildExportPayload(
  guestRows: GuestInputRow[],
  seating: PersistedSeatingData
): SeatingExportData {
  return {
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    guestRows: guestRows.map((row) => ({ ...row })),
    seating,
  };
}

function buildExportFilename(): string {
  return `seating-export-${new Date().toISOString().slice(0, 10)}.json`;
}

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
    allGuestIds,
    warnings,
  } = useSeating();
  const [activeDrag, setActiveDrag] = useState<ActiveDragData | null>(null);
  const [showRemoveHint, setShowRemoveHint] = useState(false);
  const removeHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggedGuestSeatedRef = useRef(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "tables">("sidebar");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      const isZKey = event.key.toLowerCase() === "z";
      const isUndoShortcut = isModifierPressed && !event.shiftKey && isZKey;
      const isRedoShortcut = isModifierPressed && event.shiftKey && isZKey;

      if (event.altKey || isEditableTarget(event.target)) {
        return;
      }

      if (isUndoShortcut && canUndo) {
        event.preventDefault();
        undo();
      }

      if (isRedoShortcut && canRedo) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canRedo, canUndo, redo, undo]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  // For table drags: consider only sortable-table targets so reordering cannot collide with seats.
  // For guest drags: prefer the exact seat under the pointer before falling back to table-level
  // targets, while still excluding sortable-table-N containers so the board does not reorder.
  // For party/group drags: allow only table-level and sidebar targets.
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const data = isActiveDragData(args.active.data.current) ? args.active.data.current : null;
    const kind = data?.kind;
    if (kind === "table") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) =>
          String(container.id).startsWith("sortable-table-")
        ),
      });
    }

    const baseContainers = args.droppableContainers.filter((container) => {
      const id = String(container.id);

      if (id.startsWith("sortable-table-")) return false;
      return true;
    });

    if (kind === "guest") {
      const seatContainers = baseContainers.filter((container) =>
        String(container.id).startsWith("seat-")
      );
      const seatCollisions = pointerWithin({
        ...args,
        droppableContainers: seatContainers,
      });

      if (seatCollisions.length > 0) {
        return seatCollisions;
      }

      return pointerWithin({
        ...args,
        droppableContainers: baseContainers.filter(
          (container) => !String(container.id).startsWith("seat-")
        ),
      });
    }

    return pointerWithin({
      ...args,
      droppableContainers: baseContainers.filter(
        (container) => !String(container.id).startsWith("seat-")
      ),
    });
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = isActiveDragData(event.active.data.current) ? event.active.data.current : null;
      setActiveDrag(data);
      if (data?.kind === "guest") {
        isDraggedGuestSeatedRef.current = !state.unassigned.includes(data.guestId);
      } else {
        isDraggedGuestSeatedRef.current = false;
      }
    },
    [state.unassigned]
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!isDraggedGuestSeatedRef.current) return;
    if (removeHintTimerRef.current !== null) {
      clearTimeout(removeHintTimerRef.current);
      removeHintTimerRef.current = null;
    }
    if (event.over) {
      setShowRemoveHint(false);
    } else {
      removeHintTimerRef.current = setTimeout(() => {
        setShowRemoveHint(true);
        removeHintTimerRef.current = null;
      }, 500);
    }
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    if (removeHintTimerRef.current !== null) {
      clearTimeout(removeHintTimerRef.current);
      removeHintTimerRef.current = null;
    }
    isDraggedGuestSeatedRef.current = false;
    setActiveDrag(null);
    setShowRemoveHint(false);
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (removeHintTimerRef.current !== null) {
        clearTimeout(removeHintTimerRef.current);
        removeHintTimerRef.current = null;
      }
      const willRemove = !over && isDraggedGuestSeatedRef.current;
      isDraggedGuestSeatedRef.current = false;
      const data = isActiveDragData(active.data.current) ? active.data.current : null;
      setActiveDrag(null);
      setShowRemoveHint(false);

      if (willRemove && data?.kind === "guest") {
        dispatch({ type: "REMOVE_GUESTS", guestIds: [data.guestId] });
        return;
      }

      if (!data || !over) return;
      const targetId = String(over.id);

      if (data.kind === "table") {
        const overTableNumber = parseTableNumber(targetId);
        if (overTableNumber == null) return;

        dispatch({
          type: "MOVE_TABLE",
          activeTableNumber: data.tableNumber,
          overTableNumber,
        });
        return;
      }

      const guestIds = resolveDragGuestIds(data, parties, state.unassigned);
      if (data.kind === "guest" && !guests.has(data.guestId)) return;
      if (data.kind !== "guest" && guestIds.length === 0) return;

      if (targetId === "unassigned") {
        // Move guest(s) back to unassigned pool
        if (data.kind === "guest") {
          dispatch({ type: "REMOVE_GUESTS", guestIds: [data.guestId] });
        } else if (data.kind === "party" || data.kind === "group") {
          dispatch({ type: "REMOVE_GUESTS", guestIds });
        }
        return;
      }

      const seatTarget = parseSeatTarget(targetId);
      if (seatTarget && data.kind === "guest") {
        dispatch({
          type: "ASSIGN_GUESTS",
          tableNumber: seatTarget.tableNumber,
          seatIndex: seatTarget.seatIndex,
          guestIds: [data.guestId],
          assignmentMode: "single-table",
        });
        return;
      }

      const tableNumber = parseTableNumber(targetId);
      if (tableNumber != null) {
        dispatch({
          type: "ASSIGN_GUESTS",
          tableNumber,
          guestIds,
          assignmentMode: data.kind === "group" ? "group-overflow" : "single-table",
        });
      }
    },
    [dispatch, guests, parties, state.unassigned]
  );

  const totalGuests = allGuestIds.length;
  const assignedCount = state.tables.reduce(
    (acc, table) =>
      acc + table.guestIds.filter((guestId): guestId is string => guestId !== null).length,
    0
  );
  const unassignedCount = state.unassigned.length;

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

    URL.revokeObjectURL(url);
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseImportPayload(JSON.parse(text) as unknown);

      if (!parsed) {
        window.alert("Import failed. Choose a seating export JSON from this app.");
        return;
      }

      if (!isCompatibleState(parsed.seating, parsed.guestRows)) {
        window.alert(
          "Import failed. The seating snapshot does not match the guest list in the file."
        );
        return;
      }

      onImportSnapshot(parsed.guestRows, parsed.seating);
    } catch {
      window.alert("Import failed. The selected file is not valid JSON.");
    }
  }

  // Overlay content while dragging
  const overlayGuest = activeDrag?.kind === "guest" ? guests.get(activeDrag.guestId) : null;
  const overlayParty = activeDrag?.kind === "party" ? parties.get(activeDrag.partyId) : null;
  const overlayGuestIds = activeDrag
    ? resolveDragGuestIds(activeDrag, parties, state.unassigned)
    : [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}>
      <div className="app">
        <header className="app-header">
          <h1>Wedding Seating Chart</h1>
          <div className="app-stats">
            <span className="stat">
              {assignedCount}/{totalGuests} seated
            </span>
            {unassignedCount > 0 && (
              <span className="stat stat-warn">{unassignedCount} unassigned</span>
            )}
          </div>
          <div className="app-actions">
            {warnings.length > 0 && (
              <button className="btn-warnings" onClick={() => setShowWarnings((v) => !v)}>
                <AlertTriangle size={14} aria-hidden="true" />
                {warnings.length} data {warnings.length === 1 ? "issue" : "issues"}
              </button>
            )}
            <button className="btn-undo" onClick={undo} disabled={!canUndo}>
              <Undo2 size={14} aria-hidden="true" />
              <span className="btn-label">Undo</span>
            </button>
            <button className="btn-undo" onClick={redo} disabled={!canRedo}>
              <Redo2 size={14} aria-hidden="true" />
              <span className="btn-label">Redo</span>
            </button>
            <button className="btn-reset" onClick={handleReset}>
              <RotateCcw size={14} aria-hidden="true" />
              <span className="btn-label">Reset</span>
            </button>
            <button className="btn-undo" onClick={handleExport}>
              <Download size={14} aria-hidden="true" />
              <span className="btn-label">Export</span>
            </button>
            <button className="btn-undo" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} aria-hidden="true" />
              <span className="btn-label">Import</span>
            </button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={handleImportChange}
            />
          </div>
        </header>

        {showWarnings && (
          <div className="warnings-panel">
            {warnings.map((w, i) => (
              <div key={i} className="warning-item">
                {w}
              </div>
            ))}
          </div>
        )}

        <div className={`app-body app-body--${mobilePanel}`}>
          <Sidebar />
          <TableBoard activeDragKind={activeDrag?.kind ?? null} />
        </div>

        <div className="mobile-tabs">
          <button
            className={`mobile-tab${mobilePanel === "sidebar" ? " mobile-tab--active" : ""}`}
            onClick={() => setMobilePanel("sidebar")}>
            Unassigned{unassignedCount > 0 ? ` (${unassignedCount})` : ""}
          </button>
          <button
            className={`mobile-tab${mobilePanel === "tables" ? " mobile-tab--active" : ""}`}
            onClick={() => setMobilePanel("tables")}>
            Tables
          </button>
        </div>

        <DragOverlay dropAnimation={null}>
          {overlayGuest && (
            <div
              className={`drag-overlay-chip${showRemoveHint ? " drag-overlay-chip--remove" : ""}`}>
              <span className="drag-overlay-chip-content">
                <span className={`rsvp-dot rsvp-${overlayGuest.rsvp}`} />
                {overlayGuest.fullName}
              </span>
              {showRemoveHint && <span className="drag-overlay-remove-badge">× Remove</span>}
            </div>
          )}
          {activeDrag?.kind === "table" && (
            <div className="drag-overlay-table">{activeDrag.name}</div>
          )}
          {overlayParty && activeDrag?.kind === "party" && (
            <div className="party-card drag-overlay-party-card">
              <div className="party-card-header">
                <span className="party-name">{overlayParty.household}</span>
                <span className="group-count">{overlayGuestIds.length}</span>
              </div>
            </div>
          )}
          {activeDrag?.kind === "group" && (
            <div className="group-card drag-overlay-group-card">
              <div className="group-card-header">
                <span className="group-name">{activeDrag.groupName || "No Group"}</span>
                <span className="group-count">{overlayGuestIds.length}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
}

export default function App() {
  const [guestRows, setGuestRows] = useState<GuestInputRow[]>(() => getInitialGuestRows());
  const [providerVersion, setProviderVersion] = useState(0);
  const parsedData = parseGuestsFromRows(guestRows);
  const sourceSignature = getGuestSourceSignature();

  useEffect(() => {
    saveGuestDataSourceSignature(sourceSignature);
    savePersistedGuestRows(guestRows);
  }, [guestRows, sourceSignature]);

  function handleImportSnapshot(nextGuestRows: GuestInputRow[], snapshot: PersistedSeatingData) {
    saveGuestDataSourceSignature(sourceSignature);
    savePersistedGuestRows(nextGuestRows);
    savePersistedSeating(snapshot.state, snapshot.history, snapshot.future);
    setGuestRows(nextGuestRows);
    setProviderVersion((value) => value + 1);
  }

  function handleResetApp() {
    clearPersistedAppState();
    setGuestRows(getDefaultGuestRows());
    setProviderVersion((value) => value + 1);
  }

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
