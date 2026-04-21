import "./App.css";

import {
  closestCenter,
  type CollisionDetection,
  DndContext,
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
import { AlertTriangle, Download, RotateCcw, Upload } from "lucide-react";
import { SeatingProvider, useSeating } from "./store/SeatingContext";
import { SearchProvider } from "./store/SearchContext";
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

  if (candidate.version !== EXPORT_FORMAT_VERSION) {
    return null;
  }

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
    clearSelectedGuest,
  } = useSeating();
  const [activeDrag, setActiveDrag] = useState<ActiveDragData | null>(null);
  const [showRemoveHint, setShowRemoveHint] = useState(false);
  const [dragOverlayWidth, setDragOverlayWidth] = useState<number | null>(null);
  const removeHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeHintActiveRef = useRef(false);
  const isDraggedGuestSeatedRef = useRef(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sidebar" | "tables">("sidebar");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  function updateRemoveHint(isVisible: boolean) {
    removeHintActiveRef.current = isVisible;
    setShowRemoveHint(isVisible);
  }

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".guest-chip")) {
        clearSelectedGuest();
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [clearSelectedGuest]);

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
      setDragOverlayWidth(event.active.rect.current.initial?.width ?? null);
      updateRemoveHint(false);
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
      updateRemoveHint(false);
    } else {
      removeHintTimerRef.current = setTimeout(() => {
        updateRemoveHint(true);
        removeHintTimerRef.current = null;
      }, 500);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    if (removeHintTimerRef.current !== null) {
      clearTimeout(removeHintTimerRef.current);
      removeHintTimerRef.current = null;
    }
    isDraggedGuestSeatedRef.current = false;
    setActiveDrag(null);
    setDragOverlayWidth(null);
    updateRemoveHint(false);
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (removeHintTimerRef.current !== null) {
        clearTimeout(removeHintTimerRef.current);
        removeHintTimerRef.current = null;
      }
      const willRemove = !over && isDraggedGuestSeatedRef.current && removeHintActiveRef.current;
      isDraggedGuestSeatedRef.current = false;
      const data = isActiveDragData(active.data.current) ? active.data.current : null;
      setActiveDrag(null);
      setDragOverlayWidth(null);
      updateRemoveHint(false);

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

    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

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
          {
            tables: parsed.tables,
            unassigned: [],
          },
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

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = getFirstJsonFile(event.target.files);
    event.target.value = "";

    if (!file) {
      window.alert("Import failed. Select a .json file.");
      return;
    }

    await importFromFile(file);
  }

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
    if (fileDragDepthRef.current === 0) {
      setIsFileDragOver(false);
    }
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

  // Overlay content while dragging
  const overlayGuest = activeDrag?.kind === "guest" ? guests.get(activeDrag.guestId) : null;
  const overlayParty = activeDrag?.kind === "party" ? parties.get(activeDrag.partyId) : null;
  const overlayTable =
    activeDrag?.kind === "table"
      ? (state.tables.find((table) => table.tableNumber === activeDrag.tableNumber) ?? null)
      : null;
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
      <div
        className={[
          "app",
          activeDrag?.kind === "guest" ? "app--guest-dragging" : null,
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
            <button className="btn-reset" onClick={handleReset}>
              <RotateCcw size={14} aria-hidden="true" />
              <span className="btn-label">Reset</span>
            </button>
            <button className="btn-action" onClick={handleExport}>
              <Download size={14} aria-hidden="true" />
              <span className="btn-label">Export</span>
            </button>
            <button className="btn-action" onClick={() => fileInputRef.current?.click()}>
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
          <TableBoard
            activeDragKind={activeDrag?.kind ?? null}
            activeDragGuestId={activeDrag?.kind === "guest" ? activeDrag.guestId : null}
          />
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
            <div className="drag-overlay-guest-wrap">
              <span
                className={[
                  "guest-chip",
                  "guest-chip--sidebar",
                  "drag-overlay-guest-chip",
                  showRemoveHint ? "drag-overlay-guest-chip--remove" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}>
                <span className={`guest-name guest-name--host-${overlayGuest.host.toLowerCase()}`}>
                  {overlayGuest.fullName}
                </span>
              </span>
            </div>
          )}
          {overlayTable && activeDrag?.kind === "table" && (
            <div className="table-card-shell drag-overlay-table-shell">
              <div
                className={[
                  "table-card",
                  overlayTable.guestIds.filter((guestId) => guestId !== null).length >=
                  TABLE_CAPACITY
                    ? "is-full"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={dragOverlayWidth ? { width: `${dragOverlayWidth}px` } : undefined}>
                <div className="table-seats table-seats-top">
                  {overlayTable.guestIds.slice(0, 4).map((guestId, i) => (
                    <div
                      key={`overlay-top-${i}`}
                      className={["seat-slot", guestId ? "seat-occupied" : "seat-empty"].join(" ")}>
                      {guestId ? (
                        <div className="guest-chip guest-chip--table">
                          <span
                            className={`guest-name guest-name--host-${(guests.get(guestId)?.host ?? "").toLowerCase()}`}>
                            {guests.get(guestId)?.fullName}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="table-label">
                  <div className="table-label-main">
                    <span className="table-name">{overlayTable.name}</span>
                    <span
                      className={`table-occupancy${overlayTable.guestIds.filter((guestId) => guestId !== null).length >= TABLE_CAPACITY ? " full" : ""}`}>
                      {overlayTable.guestIds.filter((guestId) => guestId !== null).length}/
                      {TABLE_CAPACITY}
                    </span>
                  </div>
                </div>

                <div className="table-seats table-seats-bottom">
                  {overlayTable.guestIds.slice(4, 8).map((guestId, i) => (
                    <div
                      key={`overlay-bottom-${i}`}
                      className={["seat-slot", guestId ? "seat-occupied" : "seat-empty"].join(" ")}>
                      {guestId ? (
                        <div className="guest-chip guest-chip--table">
                          <span
                            className={`guest-name guest-name--host-${(guests.get(guestId)?.host ?? "").toLowerCase()}`}>
                            {guests.get(guestId)?.fullName}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {overlayParty && activeDrag?.kind === "party" && (
            <div
              className="party-card drag-overlay-party-card"
              style={dragOverlayWidth ? { width: `${dragOverlayWidth}px` } : undefined}>
              <div className="party-card-header">
                <span className="party-name">{overlayParty.household}</span>
              </div>
              <div className="party-members">
                {overlayGuestIds.map((id) => {
                  const guest = guests.get(id);
                  if (!guest) return null;

                  return (
                    <span key={id} className="guest-chip guest-chip--sidebar">
                      <span className={`guest-name guest-name--host-${guest.host.toLowerCase()}`}>
                        {guest.fullName}
                      </span>
                    </span>
                  );
                })}
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
  const parsedData = useMemo(() => parseGuestsFromRows(guestRows), [guestRows]);
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
    setGuestRows([]);
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
