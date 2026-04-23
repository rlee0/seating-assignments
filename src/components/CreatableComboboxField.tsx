import { Check, ChevronDown, Plus } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}

function normalizeOption(option: string): string {
  return option.trim().toLocaleLowerCase();
}

export default function CreatableComboboxField({
  label,
  value,
  options,
  placeholder,
  onChange,
}: Props) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizeOption(query);
    if (!normalizedQuery) return options;

    return options.filter((option) => normalizeOption(option).includes(normalizedQuery));
  }, [options, query]);

  const canCreate = useMemo(() => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return false;
    return !options.some((option) => normalizeOption(option) === normalizeOption(trimmedValue));
  }, [options, value]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) {
            setQuery("");
          }
        }}>
        <PopoverAnchor asChild>
          <div ref={anchorRef} className="relative">
            <Input
              id={inputId}
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              autoComplete="off"
              data-1p-ignore="true"
              aria-label={label}
              aria-expanded={open}
              aria-autocomplete="list"
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange(nextValue);
                setQuery(nextValue);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  return;
                }

                if (event.key === "Enter" && canCreate) {
                  event.preventDefault();
                  onChange(value.trim());
                  setOpen(false);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
              onClick={() => {
                setOpen((current) => {
                  const nextOpen = !current;
                  if (nextOpen) {
                    setQuery("");
                  }
                  return nextOpen;
                });
                inputRef.current?.focus();
              }}
              aria-label={`Toggle ${label.toLowerCase()} suggestions`}>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as Node | null;
            if (target && anchorRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}>
          <Command shouldFilter={false}>
            <CommandList>
              <CommandEmpty>No matches found.</CommandEmpty>
              {canCreate ? (
                <CommandGroup heading="Create">
                  <CommandItem
                    value={`create-${value}`}
                    onSelect={() => {
                      onChange(value.trim());
                      setQuery("");
                      setOpen(false);
                    }}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create "{value.trim()}"
                  </CommandItem>
                </CommandGroup>
              ) : null}
              {filteredOptions.length > 0 ? (
                <CommandGroup heading="Suggestions">
                  {filteredOptions.map((option) => {
                    const isSelected = normalizeOption(option) === normalizeOption(value);

                    return (
                      <CommandItem
                        key={option}
                        value={option}
                        onSelect={() => {
                          onChange(option);
                          setQuery("");
                          setOpen(false);
                        }}>
                        <Check
                          className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")}
                        />
                        {option}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
