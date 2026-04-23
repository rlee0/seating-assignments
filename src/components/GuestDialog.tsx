import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import CreatableComboboxField from "@/components/CreatableComboboxField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GuestFormValues {
  fullName: string;
  household: string;
  group: string;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialValues: GuestFormValues;
  householdOptions: string[];
  groupOptions: string[];
  onClose: () => void;
  onSubmit: (values: GuestFormValues) => void;
}

export default function GuestDialog({
  open,
  mode,
  initialValues,
  householdOptions,
  groupOptions,
  onClose,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<GuestFormValues>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const fullNameId = useId();

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setError(null);
  }, [initialValues, open]);

  const title = mode === "create" ? "Add Guest" : "Edit Guest";
  const description =
    mode === "create"
      ? "Full name is required. Household and group can be selected from existing values or entered as new ones."
      : "Update the guest details. Household and group can be selected from existing values or entered as new ones.";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id="guest-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();

            const nextValues = {
              fullName: values.fullName.trim(),
              household: values.household.trim(),
              group: values.group.trim(),
            };

            if (!nextValues.fullName) {
              setError("Full name is required.");
              return;
            }

            setError(null);
            onSubmit(nextValues);
          }}>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor={fullNameId}>Full Name</Label>
            <Input
              id={fullNameId}
              name="guest-full-name"
              autoFocus
              autoComplete="off"
              data-1p-ignore="true"
              value={values.fullName}
              onChange={(event) =>
                setValues((current) => ({ ...current, fullName: event.target.value }))
              }
              placeholder="e.g. Jordan Lee"
            />
          </div>

          <CreatableComboboxField
            label="Household"
            value={values.household}
            options={householdOptions}
            placeholder="Select existing or type a new household"
            onChange={(nextValue) => setValues((current) => ({ ...current, household: nextValue }))}
          />

          <CreatableComboboxField
            label="Group"
            value={values.group}
            options={groupOptions}
            placeholder="Select existing or type a new group"
            onChange={(nextValue) => setValues((current) => ({ ...current, group: nextValue }))}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{mode === "create" ? "Add Guest" : "Save Changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
