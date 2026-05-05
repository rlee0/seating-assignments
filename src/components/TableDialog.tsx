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
  type RectangularSeatCounts,
  type TableSeatConfig,
  type TableShape,
} from "../types";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TableFormValues {
  name: string;
  shape: TableShape;
  roundSeatCount: number;
  sideCounts: RectangularSeatCounts;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialValues: TableFormValues;
  onClose: () => void;
  onSubmit: (values: TableFormValues) => void;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseSideCount(raw: string): number {
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : clampInt(n, 0, 16);
}

export default function TableDialog({ open, mode, initialValues, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<TableFormValues>(initialValues);
  const nameId = useId();
  const roundCountId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
  }, [initialValues, open]);

  const seatConfig: TableSeatConfig =
    values.shape === "round"
      ? { shape: "round", seatCount: values.roundSeatCount }
      : { shape: "rectangular", sideCounts: values.sideCounts };

  const totalSeats =
    seatConfig.shape === "round"
      ? seatConfig.seatCount
      : seatConfig.sideCounts.top +
        seatConfig.sideCounts.right +
        seatConfig.sideCounts.bottom +
        seatConfig.sideCounts.left;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({
      ...values,
      name: values.name.trim(),
    });
  };

  const setSide = (side: keyof RectangularSeatCounts, raw: string) => {
    setValues((v) => ({
      ...v,
      sideCounts: { ...v.sideCounts, [side]: parseSideCount(raw) },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Table" : "Edit Table"}</DialogTitle>
        </DialogHeader>
        <form id="table-form" className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              className="h-8 text-xs"
              autoFocus
              autoComplete="off"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Table 1"
            />
          </div>

          <div className="grid gap-2">
            <Label>Shape</Label>
            <div className="flex gap-2">
              {(["round", "rectangular"] as TableShape[]).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setValues((v) => ({ ...v, shape }))}
                  className={
                    values.shape === shape
                      ? "flex-1 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
                      : "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                  }>
                  {shape.charAt(0).toUpperCase() + shape.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {values.shape === "round" ? (
            <div className="grid gap-2">
              <Label htmlFor={roundCountId}>
                Seat count{" "}
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
                value={values.roundSeatCount}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    roundSeatCount: clampInt(
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
              <Label>
                Seats per side{" "}
                <span className="font-normal text-muted-foreground">({totalSeats} total)</span>
              </Label>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                {/* Top row */}
                <div />
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Top</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.sideCounts.top}
                    onChange={(e) => setSide("top", e.target.value)}
                  />
                </div>
                <div />
                {/* Middle row */}
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Left</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.sideCounts.left}
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
                    value={values.sideCounts.right}
                    onChange={(e) => setSide("right", e.target.value)}
                  />
                </div>
                {/* Bottom row */}
                <div />
                <div className="grid gap-1">
                  <span className="text-2xs text-muted-foreground">Bottom</span>
                  <Input
                    type="number"
                    className="h-8 text-center text-xs"
                    min={0}
                    max={16}
                    value={values.sideCounts.bottom}
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
            <Button type="submit">{mode === "create" ? "Add Table" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
