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
import { AlertTriangle, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { SeatingProvider, useSeating } from "./store/SeatingContext";
import { useCallback, useEffect, useState } from "react";

import Sidebar from "./components/Sidebar";
import TableBoard from "./components/TableBoard";
import { createInitialState } from "./store/reducer";
import { parseGuests } from "./data/parseGuests";

// Parse once at module load — data is static
const parsedData = parseGuests();

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
  parties: ReturnType<typeof parseGuests>["parties"],
  unassignedSet: Set<string>
): string[] {
  const party = parties.get(partyId);
  if (!party) return [];

  return party.guestIds.filter((guestId) => unassignedSet.has(guestId));
}

function getUnassignedGuestIdsForGroup(
  groupName: string,
  parties: ReturnType<typeof parseGuests>["parties"],
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
  parties: ReturnType<typeof parseGuests>["parties"],
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

function SeatingApp() {
  const { state, dispatch, undo, redo, canUndo, canRedo, guests, parties, allGuestIds, warnings } =
    useSeating();
  const [activeDrag, setActiveDrag] = useState<ActiveDragData | null>(null);
  const [overTargetId, setOverTargetId] = useState<string | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);

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

      return closestCenter({
        ...args,
        droppableContainers: baseContainers.filter(
          (container) => !String(container.id).startsWith("seat-")
        ),
      });
    }

    return closestCenter({
      ...args,
      droppableContainers: baseContainers.filter(
        (container) => !String(container.id).startsWith("seat-")
      ),
    });
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = isActiveDragData(event.active.data.current) ? event.active.data.current : null;
    setActiveDrag(data);
    setOverTargetId(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverTargetId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    setActiveDrag(null);
    setOverTargetId(null);
  }, []);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      const data = isActiveDragData(active.data.current) ? active.data.current : null;
      setActiveDrag(null);
      setOverTargetId(null);
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
      dispatch({
        type: "RESET",
        initialState: createInitialState(allGuestIds),
      });
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
              Undo
            </button>
            <button className="btn-undo" onClick={redo} disabled={!canRedo}>
              <Redo2 size={14} aria-hidden="true" />
              Redo
            </button>
            <button className="btn-reset" onClick={handleReset}>
              <RotateCcw size={14} aria-hidden="true" />
              Reset
            </button>
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

        <div className="app-body">
          <Sidebar />
          <TableBoard activeDragKind={activeDrag?.kind ?? null} overTargetId={overTargetId} />
        </div>

        <DragOverlay dropAnimation={null}>
          {overlayGuest && (
            <div className="drag-overlay-chip">
              <span className={`rsvp-dot rsvp-${overlayGuest.rsvp}`} />
              {overlayGuest.fullName}
            </div>
          )}
          {activeDrag?.kind === "table" && (
            <div className="drag-overlay-table">{activeDrag.name}</div>
          )}
          {overlayParty && activeDrag?.kind === "party" && (
            <div className="drag-overlay-party">
              <div className="drag-overlay-party-name">{overlayParty.displayName}</div>
              <div className="drag-overlay-party-count">
                {overlayGuestIds.length} guest
                {overlayGuestIds.length !== 1 ? "s" : ""}
              </div>
            </div>
          )}
          {activeDrag?.kind === "group" && (
            <div className="drag-overlay-group">
              <div className="drag-overlay-group-name">{activeDrag.groupName || "No Group"}</div>
              <div className="drag-overlay-group-count">
                {overlayGuestIds.length} guest
                {overlayGuestIds.length !== 1 ? "s" : ""}
              </div>
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  );
}

export default function App() {
  return (
    <SeatingProvider parsedData={parsedData}>
      <SeatingApp />
    </SeatingProvider>
  );
}
