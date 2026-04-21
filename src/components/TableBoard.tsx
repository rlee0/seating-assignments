import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";

import TableCard from "./TableCard";
import { useSeating } from "../store/SeatingContext";

interface Props {
  activeDragKind: "party" | "guest" | "group" | "table" | null;
  activeDragGuestId: string | null;
}

export default function TableBoard({ activeDragKind, activeDragGuestId }: Props) {
  const { state } = useSeating();
  const tableIds = state.tables.map((table) => `sortable-table-${table.tableNumber}`);

  return (
    <SortableContext items={tableIds} strategy={rectSortingStrategy}>
      <main className="table-board">
        <div className="table-grid">
          {state.tables.map((table) => {
            return (
              <TableCard
                key={table.tableNumber}
                table={table}
                activeDragKind={activeDragKind}
                activeDragGuestId={activeDragGuestId}
                displayGuestIds={table.guestIds}
                previewSeatKinds={table.guestIds.map(() => null)}
                isPreviewMode={false}
                hasTablePreviewChanges={false}
              />
            );
          })}
        </div>
      </main>
    </SortableContext>
  );
}
