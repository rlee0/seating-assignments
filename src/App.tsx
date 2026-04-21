import "./App.css";

import {
  closestCenter,
  type CollisionDetection,
  DndContext,
  DragEndEvent,
  DragMoveEvent,
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
import { Button } from "@/components/ui/button";
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
import { type GuestProfile, seatingReducer } from "./store/reducer";

type ActiveDragData =
  | { kind: "party"; partyId: string; origin: "sidebar" }
  | { kind: "guest"; guestId: string; origin: "sidebar" | "table" }
  | { kind: "group"; groupName: string; origin: "sidebar" }
  | { kind: "table"; tableNumber: number; name: string; origin: "table" };

interface AutoSeatPreview {
  tables: TableState[];
}

function isActiveDragData(value: unknown): value is ActiveDragData {
  if (!value || typeof value !== "object") return false;

  const maybeData = value as Record<string, unknown>;
  if (maybeData.origin !== "sidebar" && maybeData.origin !== "table") return false;

  if (maybeData.kind === "guest") return typeof maybeData.guestId === "string";
  if (maybeData.kind === "party") {
    return maybeData.origin === "sidebar" && typeof maybeData.partyId === "string";
  }
  if (maybeData.kind === "group") {
    return maybeData.origin === "sidebar" && typeof maybeData.groupName === "string";
  }

  return (
    maybeData.kind === "table" &&
    maybeData.origin === "table" &&
    typeof maybeData.tableNumber === "number" &&
    typeof maybeData.name === "string"
  );
}

function getPointerCoordinatesFromEvent(
  event: Event | null | undefined
): { x: number; y: number } | null {
  if (!event) return null;

  const maybeMouseEvent = event as MouseEvent;
  if (typeof maybeMouseEvent.clientX === "number" && typeof maybeMouseEvent.clientY === "number") {
    return { x: maybeMouseEvent.clientX, y: maybeMouseEvent.clientY };
  }

  const maybeTouchEvent = event as TouchEvent;
  const touch = maybeTouchEvent.touches?.[0] ?? maybeTouchEvent.changedTouches?.[0];
  if (touch) {
    return { x: touch.clientX, y: touch.clientY };
  }

  return null;
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

function getSeatedGuestIdsForTable(
  tableNumber: number,
  tables: Array<{ tableNumber: number; guestIds: Array<string | null> }>
): string[] {
  const table = tables.find((entry) => entry.tableNumber === tableNumber);
  if (!table) return [];
  return table.guestIds.filter((guestId): guestId is string => guestId !== null);
}

function hasSeatLayoutChanges(leftTables: TableState[], rightTables: TableState[]): boolean {
  if (leftTables.length !== rightTables.length) return true;

  for (let index = 0; index < leftTables.length; index += 1) {
    const left = leftTables[index];
    const right = rightTables[index];

    if (left.tableNumber !== right.tableNumber) return true;
    if (left.guestIds.length !== right.guestIds.length) return true;

    for (let seatIndex = 0; seatIndex < left.guestIds.length; seatIndex += 1) {
      if (left.guestIds[seatIndex] !== right.guestIds[seatIndex]) return true;
    }
  }

  return false;
}

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
    warnings,
    selectedGuestId,
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
  const [isAutoSeatHovering, setIsAutoSeatHovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const latestPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const activeDragOriginRef = useRef<"sidebar" | "table" | null>(null);
  const activeSidebarScrollContainerRef = useRef<HTMLElement | null>(null);
  const isDragOverSidebarDropzoneRef = useRef(false);
  const guestProfiles = useMemo(() => buildGuestProfiles(guests, parties), [guests, parties]);

  const updateRemoveHint = useCallback((isVisible: boolean) => {
    removeHintActiveRef.current = isVisible;
    setShowRemoveHint(isVisible);
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".guest-chip, .sidebar-selected-guest")) {
        clearSelectedGuest();
      }
    }
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [clearSelectedGuest]);

  useEffect(() => {
    if (!activeDrag) return;

    const handlePointerMove = (event: PointerEvent) => {
      latestPointerPositionRef.current = {
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return;

      latestPointerPositionRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, [activeDrag]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      const isDeleteKey = event.key === "Backspace" || event.key === "Delete";
      const isFindShortcut =
        isModifierPressed && !event.shiftKey && event.key.toLowerCase() === "f";
      const isZKey = event.key.toLowerCase() === "z";
      const isUndoShortcut = isModifierPressed && !event.shiftKey && isZKey;
      const isRedoShortcut = isModifierPressed && event.shiftKey && isZKey;

      if (isFindShortcut) {
        const searchInput = document.querySelector<HTMLInputElement>("[data-app-search='true']");
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

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
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  const autoScrollOptions = useMemo(
    () => ({
      canScroll: (element: Element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const sidebarScrollContainer = activeSidebarScrollContainerRef.current;
        const isSidebarScrollableElement =
          sidebarScrollContainer !== null &&
          (element === sidebarScrollContainer || sidebarScrollContainer.contains(element));

        if (isSidebarScrollableElement) {
          if (activeDragOriginRef.current !== "sidebar") {
            return false;
          }

          return isDragOverSidebarDropzoneRef.current;
        }

        return true;
      },
    }),
    []
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
        droppableContainers: args.droppableContainers.filter((container) => {
          const id = String(container.id);
          return id.startsWith("sortable-table-") || id === "auto-seat" || id === "unassigned";
        }),
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
      const pointer = getPointerCoordinatesFromEvent(event.activatorEvent);
      latestPointerPositionRef.current = pointer;
      activeDragOriginRef.current = data?.origin ?? null;
      if (data?.origin === "sidebar") {
        const targetAtPointer = pointer
          ? document
              .elementFromPoint(pointer.x, pointer.y)
              ?.closest<HTMLElement>(".sidebar-dropzone")
          : null;

        activeSidebarScrollContainerRef.current =
          targetAtPointer ?? document.querySelector<HTMLElement>(".sidebar-dropzone");
        isDragOverSidebarDropzoneRef.current = true;
      } else {
        activeSidebarScrollContainerRef.current = null;
        isDragOverSidebarDropzoneRef.current = false;
      }

      setActiveDrag(data);
      setIsAutoSeatHovering(false);
      setDragOverlayWidth(event.active.rect.current.initial?.width ?? null);
      updateRemoveHint(false);
      if (data?.kind === "guest") {
        isDraggedGuestSeatedRef.current = !state.unassigned.includes(data.guestId);
      } else {
        isDraggedGuestSeatedRef.current = false;
      }
    },
    [state.unassigned, updateRemoveHint]
  );

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const pointer = getPointerCoordinatesFromEvent(event.activatorEvent);
    if (!pointer) return;

    latestPointerPositionRef.current = pointer;
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      setIsAutoSeatHovering(event.over ? String(event.over.id) === "auto-seat" : false);
      isDragOverSidebarDropzoneRef.current =
        event.over !== null && String(event.over.id) === "unassigned";
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
    },
    [updateRemoveHint]
  );

  const handleDragCancel = useCallback(() => {
    if (removeHintTimerRef.current !== null) {
      clearTimeout(removeHintTimerRef.current);
      removeHintTimerRef.current = null;
    }
    isDraggedGuestSeatedRef.current = false;
    setIsAutoSeatHovering(false);
    setActiveDrag(null);
    setDragOverlayWidth(null);
    latestPointerPositionRef.current = null;
    activeDragOriginRef.current = null;
    activeSidebarScrollContainerRef.current = null;
    isDragOverSidebarDropzoneRef.current = false;
    updateRemoveHint(false);
  }, [updateRemoveHint]);

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
      setIsAutoSeatHovering(false);
      setDragOverlayWidth(null);
      latestPointerPositionRef.current = null;
      activeDragOriginRef.current = null;
      activeSidebarScrollContainerRef.current = null;
      isDragOverSidebarDropzoneRef.current = false;
      updateRemoveHint(false);

      if (willRemove && data?.kind === "guest") {
        dispatch({ type: "REMOVE_GUESTS", guestIds: [data.guestId] });
        return;
      }

      if (!data || !over) return;
      const targetId = String(over.id);

      if (data.kind === "table") {
        if (targetId === "unassigned") {
          dispatch({ type: "CLEAR_TABLE", tableNumber: data.tableNumber });
          return;
        }

        if (targetId === "auto-seat") {
          const guestIds = getSeatedGuestIdsForTable(data.tableNumber, state.tables);
          if (guestIds.length > 0) {
            dispatch({ type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles });
          }
          return;
        }

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

      if (targetId === "auto-seat") {
        dispatch({ type: "AUTO_ASSIGN_GUESTS", guestIds, guestProfiles });
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
    [dispatch, guestProfiles, guests, parties, state.tables, state.unassigned, updateRemoveHint]
  );

  const autoSeatPreview = useMemo<AutoSeatPreview | null>(() => {
    if (!activeDrag || !isAutoSeatHovering) return null;

    const previewGuestIds =
      activeDrag.kind === "table"
        ? getSeatedGuestIdsForTable(activeDrag.tableNumber, state.tables)
        : resolveDragGuestIds(activeDrag, parties, state.unassigned);

    if (previewGuestIds.length === 0) return null;
    if (activeDrag.kind === "guest" && !guests.has(activeDrag.guestId)) return null;

    const previewState = seatingReducer(state, {
      type: "AUTO_ASSIGN_GUESTS",
      guestIds: previewGuestIds,
      guestProfiles,
    });

    if (!hasSeatLayoutChanges(state.tables, previewState.tables)) return null;

    return { tables: previewState.tables };
  }, [activeDrag, guestProfiles, guests, isAutoSeatHovering, parties, state]);

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
            lockedGuestIds: [],
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
  const overlayOccupancy = overlayTable
    ? overlayTable.guestIds.filter((id) => id !== null).length
    : 0;
  const overlayGuestIds = activeDrag
    ? resolveDragGuestIds(activeDrag, parties, state.unassigned)
    : [];

  return (
    <DndContext
      sensors={sensors}
      autoScroll={autoScrollOptions}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
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

        <DragOverlay dropAnimation={null}>
          {overlayGuest && (
            <div className="drag-overlay-guest-wrap">
              <span
                className={[
                  "guest-chip",
                  activeDrag?.kind === "guest" && activeDrag.origin === "table"
                    ? "guest-chip--table"
                    : "guest-chip--sidebar",
                  "drag-overlay-guest-chip",
                  showRemoveHint ? "drag-overlay-guest-chip--remove" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={
                  activeDrag?.kind === "guest" && activeDrag.origin === "table" && dragOverlayWidth
                    ? { width: `${dragOverlayWidth}px` }
                    : undefined
                }>
                <span className="guest-name">{overlayGuest.fullName}</span>
              </span>
            </div>
          )}
          {overlayTable && activeDrag?.kind === "table" && (
            <div className="table-card-shell drag-overlay-table-shell">
              <div
                className={["table-card", overlayOccupancy >= TABLE_CAPACITY ? "is-full" : null]
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
                          <span className="guest-name">{guests.get(guestId)?.fullName}</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="table-label">
                  <div className="table-label-main">
                    <span className="table-name">{overlayTable.name}</span>
                    <span
                      className={`table-occupancy${overlayOccupancy >= TABLE_CAPACITY ? " full" : ""}`}>
                      {overlayOccupancy}/{TABLE_CAPACITY}
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
                          <span className="guest-name">{guests.get(guestId)?.fullName}</span>
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
                      <span className="guest-name">{guest.fullName}</span>
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
