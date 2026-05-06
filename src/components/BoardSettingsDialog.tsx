import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TABLE_PRESETS, getTablePresetById, type BoardState, type TablePresetId } from "../types";

export interface BoardSettingsFormValues {
  rows: number;
  columns: number;
  labelPrefix: string;
  presetId: TablePresetId;
}

interface Props {
  open: boolean;
  currentBoard: BoardState;
  onClose: () => void;
  onSubmit: (values: BoardSettingsFormValues) => void;
}

function formatShapeLabel(shape: "round" | "rectangular"): string {
  return shape === "round" ? "Round" : "Rectangular";
}

function formatPresetOptionLabel(preset: (typeof TABLE_PRESETS)[number]): string {
  return `${preset.label} · ${formatShapeLabel(preset.shape)} · ${preset.maximumSeating} seats`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function boardToFormValues(board: BoardState): BoardSettingsFormValues {
  return {
    rows: board.rows,
    columns: board.columns,
    labelPrefix: board.newTableDefaults.labelPrefix,
    presetId: board.newTableDefaults.presetId,
  };
}

export default function BoardSettingsDialog({ open, currentBoard, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<BoardSettingsFormValues>(() =>
    boardToFormValues(currentBoard)
  );
  const rowsId = useId();
  const columnsId = useId();
  const prefixId = useId();
  const presetFieldId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(boardToFormValues(currentBoard));
  }, [currentBoard, open]);

  const selectedPreset = getTablePresetById(values.presetId);

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
              autoComplete="off"
              value={values.labelPrefix}
              onChange={(e) => setValues((v) => ({ ...v, labelPrefix: e.target.value }))}
              placeholder="Table"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={presetFieldId}>Default table size</Label>
            <Select
              value={values.presetId}
              onValueChange={(nextPresetId: TablePresetId) =>
                setValues((current) => ({ ...current, presetId: nextPresetId }))
              }>
              <SelectTrigger id={presetFieldId} aria-label="Default table size">
                <SelectValue>{selectedPreset.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TABLE_PRESETS.map((preset) => (
                  <SelectItem key={preset.presetId} value={preset.presetId}>
                    {formatPresetOptionLabel(preset)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">
              {selectedPreset.maximumSeating} seats max. {selectedPreset.typicalUseCase}
            </p>
          </div>

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
