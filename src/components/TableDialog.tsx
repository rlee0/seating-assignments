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
import { TABLE_PRESETS, getTablePresetById, type TablePresetId } from "../types";

export interface TableFormValues {
  name: string;
  presetId: TablePresetId;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialValues: TableFormValues;
  onClose: () => void;
  onSubmit: (values: TableFormValues) => void;
}

function formatShapeLabel(shape: "round" | "rectangular"): string {
  return shape === "round" ? "Round" : "Rectangular";
}

function formatPresetOptionLabel(preset: (typeof TABLE_PRESETS)[number]): string {
  return `${preset.label} · ${formatShapeLabel(preset.shape)} · ${preset.maximumSeating} seats`;
}

export default function TableDialog({ open, mode, initialValues, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<TableFormValues>(initialValues);
  const nameId = useId();
  const presetFieldId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
  }, [initialValues, open]);

  const selectedPreset = getTablePresetById(values.presetId);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({
      ...values,
      name: values.name.trim(),
    });
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
              autoFocus
              autoComplete="off"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="e.g. Table 1"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={presetFieldId}>Table size</Label>
            <Select
              value={values.presetId}
              onValueChange={(nextPresetId: TablePresetId) =>
                setValues((current) => ({ ...current, presetId: nextPresetId }))
              }>
              <SelectTrigger id={presetFieldId} aria-label="Table size">
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
            <Button type="submit">{mode === "create" ? "Add Table" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
