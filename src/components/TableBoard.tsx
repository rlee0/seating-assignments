import { SortableContext } from "@dnd-kit/sortable";
import TableCard from "./TableCard";
import type { TableState } from "../types";
import type { Transform } from "@dnd-kit/utilities";
import { cn } from "../lib/utils";
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

export interface GuestSwapPreview {
  sourceTableNumber: number;
  sourceSeatIndex: number;
  sourceGuestId: string;
  targetGuestId: string;
}

interface Props {
  activeDragKind: "household" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
  autoSeatPreview: AutoSeatPreview | null;
  guestSwapPreview: GuestSwapPreview | null;
  onEditGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
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

export default function TableBoard({
  activeDragKind,
  activeDragGuestId,
  autoSeatPreview,
  guestSwapPreview,
  onEditGuest,
  onDeleteGuest,
}: Props) {
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
      <main className="flex min-h-0 flex-1 flex-col items-stretch gap-3 overflow-y-auto p-3">
        <section
          ref={setAutoSeatRef}
          className={cn(
            "flex min-h-16 flex-none flex-col items-center justify-center rounded-[10px] border border-dashed border-border bg-[linear-gradient(180deg,var(--card)_0%,var(--auto-seat-bg-end)_100%)] px-4 py-3.5 text-center transition-[border-color,background,color] duration-150",
            activeDragKind !== null && "border-(--auto-seat-active-border)",
            isAutoSeatOver && "border-(--table-drop-border) bg-(--table-drop-bg)"
          )}>
          <h3 className="m-0 text-xs font-semibold text-foreground">{autoSeatTitle}</h3>
          <p className="mt-1 mb-0 text-xs text-muted-foreground">{autoSeatCopy}</p>
        </section>

        <div className="grid grid-cols-5 content-start gap-2.5">
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
                guestSwapPreview={guestSwapPreview}
                onEditGuest={onEditGuest}
                onDeleteGuest={onDeleteGuest}
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
