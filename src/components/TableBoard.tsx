import { SortableContext } from "@dnd-kit/sortable";
import type { Transform } from "@dnd-kit/utilities";

import TableCard from "./TableCard";
import type { TableState } from "../types";
import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import { useSeating } from "../store/SeatingContext";

// Tables no longer reorder on drop — disable all sortable position animations.
function swapSortingStrategy(): Transform | null {
  return null;
}

export interface AutoSeatPreview {
  tables: TableState[];
}

interface Props {
  activeDragKind: "household" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  autoSeatPreview: AutoSeatPreview | null;
}

function computePreviewSeatKinds(
  realGuestIds: Array<string | null>,
  previewGuestIds: Array<string | null>
): Array<"added" | "changed" | "deleted" | null> {
  return realGuestIds.map((realId, i) => {
    const previewId = previewGuestIds[i] ?? null;
    if (realId === previewId) return null;
    if (realId === null) return "added";
    if (previewId === null) return "deleted";
    return "changed";
  });
}

export default function TableBoard({ activeDragKind, activeDragGuestId, autoSeatPreview }: Props) {
  const { state } = useSeating();

  const { setNodeRef: setAutoSeatRef, isOver: isAutoSeatOver } = useDroppable({
    id: "auto-seat",
    disabled: activeDragKind === null,
  });

  const tableIds = state.tables.map((table) => `sortable-table-${table.tableNumber}`);
  const showPreview = autoSeatPreview !== null;
  const isAutoSeatEnabled = activeDragKind !== null;

  const autoSeatTitle = isAutoSeatOver ? "Release to auto-seat" : "Auto-seat guests";
  const autoSeatCopy = !isAutoSeatEnabled
    ? "Drag a guest, group, party, or table here to auto-seat them."
    : isAutoSeatOver
      ? "We will find the best available seats across tables."
      : "Drop here to assign guests across tables automatically.";

  const previewTablesByNumber = useMemo(() => {
    if (!autoSeatPreview) return null;
    const map = new Map<number, TableState>();
    for (const t of autoSeatPreview.tables) map.set(t.tableNumber, t);
    return map;
  }, [autoSeatPreview]);

  return (
    <SortableContext items={tableIds} strategy={swapSortingStrategy}>
      <main className="table-board">
        <section
          ref={setAutoSeatRef}
          className={[
            "auto-seat-dropzone",
            activeDragKind !== null ? "is-enabled" : null,
            isAutoSeatOver ? "is-over" : null,
          ]
            .filter(Boolean)
            .join(" ")}>
          <h3 className="auto-seat-title">{autoSeatTitle}</h3>
          <p className="auto-seat-copy">{autoSeatCopy}</p>
        </section>

        <div className="table-grid">
          {state.tables.map((table) => {
            const previewTable = previewTablesByNumber?.get(table.tableNumber) ?? null;
            const displayGuestIds = previewTable ? previewTable.guestIds : table.guestIds;
            const previewSeatKinds = previewTable
              ? computePreviewSeatKinds(table.guestIds, previewTable.guestIds)
              : table.guestIds.map(() => null);
            const hasTablePreviewChanges =
              previewTable !== null && previewSeatKinds.some((k) => k !== null);

            return (
              <TableCard
                key={table.tableNumber}
                table={table}
                activeDragKind={activeDragKind}
                activeDragGuestId={activeDragGuestId}
                displayGuestIds={displayGuestIds}
                previewSeatKinds={previewSeatKinds}
                isPreviewMode={showPreview}
                hasTablePreviewChanges={hasTablePreviewChanges}
              />
            );
          })}
        </div>
      </main>
    </SortableContext>
  );
}
