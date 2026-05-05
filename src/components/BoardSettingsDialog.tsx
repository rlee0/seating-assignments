import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAX_ROUND_TABLE_CAPACITY,
  MIN_ROUND_TABLE_CAPACITY,
  type BoardState,
  type RectangularSeatCounts,
  type TableShape,
} from "../types";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface BoardSettingsFormValues {
  rows: number;
  columns: number;
  labelPrefix: string;
  defaultShape: TableShape;
  defaultRoundSeatCount: number;
  defaultSideCounts: RectangularSeatCounts;
}

interface Props {
  open: boolean;
  currentBoard: BoardState;
  onClose: () => void;
  onSubmit: (values: BoardSettingsFormValues) => void;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseSideCount(raw: string): number {
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : clampInt(n, 0, 16);
}

function boardToFormValues(board: BoardState): BoardSettingsFormValues {
  return {
    rows: board.rows,
    columns: board.columns,
    labelPrefix: board.newTableDefaults.labelPrefix,
    defaultShape: board.newTableDefaults.shape,
    defaultRoundSeatCount: board.newTableDefaults.roundSeatCount,
    defaultSideCounts: { ...board.newTableDefaults.rectangularSideCounts },
  };
}

export default function BoardSettingsDialog({ open, currentBoard, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<BoardSettingsFormValues>(() =>
    boardToFormValues(currentBoard)
  );
  const rowsId = useId();
  const columnsId = useId();
  const prefixId = useId();
  const roundCountId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(boardToFormValues(currentBoard));
  }, [currentBoard, open]);

  const setSide = (side: keyof RectangularSeatCounts, raw: string) => {
    setValues((v) => ({
      ...v,
      defaultSideCounts: { ...v.defaultSideCounts, [side]: parseSideCount(raw) },
    }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({ ...values, labelPrefix: values.labelPrefix.trim() || "Table" });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Board Settings</DialogTitle>
        </DialogHeader>
        <form id="board-settings-form" className="space-y-5" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor={rowsId}>Rows</Label>
              <Input
                id={rowsId}
                type="number"
                className="h-8 text-xs"
                min={1}
                max={20}
                value={values.rows}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    rows: clampInt(parseInt(e.target.value, 10) || 1, 1, 20),
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={columnsId}>Columns</Label>
              <Input
                id={columnsId}
                type="number"
                className="h-8 text-xs"
                min={1}
                max={20}
                value={values.columns}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    columns: clampInt(parseInt(e.target.value, 10) || 1, 1, 20),
                  }))
                }
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={prefixId}>Default label prefix</Label>
            <Input
              id={prefixId}
              className="h-8 text-xs"
              autoComplete="off"
              value={values.labelPrefix}
              onChange={(e) => setValues((v) => ({ ...v, labelPrefix: e.target.value }))}
              placeholder="Table"
            />
          </div>

          <div className="grid gap-2">
            <Label>Default shape for new tables</Label>
            <div className="flex gap-2">
              {(["round", "rectangular"] as TableShape[]).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, defaultShape: shape }))}
                  className={
                    values.defaultShape === shape
                      ? "flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
                      : "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                  }>
                  {shape.charAt(0).toUpperCase() + shape.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {values.defaultShape === "round" ? (
            <div className="grid gap-2">
              <Label htmlFor={roundCountId}>
                Default seat count{" "}
                <span className="font-normal text-muted-foreground">
                  ({MIN_ROUND_TABLE_CAPACITY}–{MAX_ROUND_TABLE_CAPACITY})
                </span>
              </Label>
              <Input
                id={roundCountId}
                type="number"
                className="h-8 w-24 text-xs"
                min={MIN_ROUND_TABLE_CAPACITY}
                max={MAX_ROUND_TABLE_CAPACITY}
                value={values.defaultRoundSeatCount}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    defaultRoundSeatCount: clampInt(
                      parseInt(e.target.value, 10) || MIN_ROUND_TABLE_CAPACITY,
                      MIN_ROUND_TABLE_CAPACITY,
                      MAX_ROUND_TABLE_CAPACITY
                    ),
                  }))
                }
              />
            </div>
          ) : (
            <div className="grid gap-3">
              <Label>Default seats per side</Label>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div />
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Top</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.defaultSideCounts.top}
                    onChange={(e) => setSide("top", e.target.value)}
                  />
                </div>
                <div />
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Left</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.defaultSideCounts.left}
                    onChange={(e) => setSide("left", e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-center rounded-md border border-dashed border-border">
                  <span className="text-2xs text-muted-foreground">Table</span>
                </div>
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Right</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.defaultSideCounts.right}
                    onChange={(e) => setSide("right", e.target.value)}
                  />
                </div>
                <div />
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Bottom</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.defaultSideCounts.bottom}
                    onChange={(e) => setSide("bottom", e.target.value)}
                  />
                </div>
                <div />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save Settings</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
