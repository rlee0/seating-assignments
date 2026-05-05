import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { User, UserPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import CreatableComboboxField from "@/components/CreatableComboboxField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface GuestFormValues {
  fullName: string;
  host: string;
  party: string;
  circle: string;
}

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialValues: GuestFormValues;
  hostOptions: string[];
  partyOptions: string[];
  circleOptions: string[];
  onClose: () => void;
  onSubmit: (values: GuestFormValues) => void;
}

export default function GuestDialog({
  open,
  mode,
  initialValues,
  hostOptions,
  partyOptions,
  circleOptions,
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
  const TitleIcon = mode === "create" ? UserPlus : User;
  const description =
    mode === "create"
      ? "Full name is required. Host, party, and circle can be selected from existing values or entered as new ones."
      : "Update the guest details. Host, party, and circle can be selected from existing values or entered as new ones.";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <TitleIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id="guest-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();

            const nextValues = {
              fullName: values.fullName.trim(),
              host: values.host.trim(),
              party: values.party.trim(),
              circle: values.circle.trim(),
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

          <div className="grid gap-2">
            <Label htmlFor={fullNameId}>Full Name</Label>
            <Input
              id={fullNameId}
              name="guest-full-name"
              className="h-8 text-xs"
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
            label="Host"
            value={values.host}
            options={hostOptions}
            placeholder="Select existing or type a new host"
            onChange={(nextValue) => setValues((current) => ({ ...current, host: nextValue }))}
          />

          <CreatableComboboxField
            label="Party"
            value={values.party}
            options={partyOptions}
            placeholder="Select existing or type a new party"
            onChange={(nextValue) => setValues((current) => ({ ...current, party: nextValue }))}
          />

          <CreatableComboboxField
            label="Circle"
            value={values.circle}
            options={circleOptions}
            placeholder="Select existing or type a new circle"
            onChange={(nextValue) => setValues((current) => ({ ...current, circle: nextValue }))}
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
