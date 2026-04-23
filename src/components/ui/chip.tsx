import { cva, type VariantProps } from "class-variance-authority";

const guestChipVariants = cva(
  "flex items-center gap-1 rounded-sm border px-1 py-0.5 text-2xs leading-tight font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      state: {
        default:
          "border-primary/20 bg-primary/8 text-primary hover:bg-primary/12 active:bg-primary/10",
        dimmed: "border-border bg-muted text-muted-foreground hover:bg-muted/80 active:bg-muted/75",
        selected:
          "border-[var(--guest-chip-selected-color,var(--primary))] bg-[var(--guest-chip-selected-color,var(--primary))] text-primary-foreground hover:bg-[var(--guest-chip-selected-color,var(--primary))] active:bg-[var(--guest-chip-selected-color,var(--primary))]",
        relatedHousehold:
          "border-[var(--guest-chip-selected-color,var(--primary))] bg-[var(--guest-chip-bg,var(--secondary))] text-secondary-foreground hover:bg-[var(--guest-chip-bg,var(--secondary))] active:bg-[var(--guest-chip-bg,var(--secondary))]",
        relatedGroup:
          "border-[var(--guest-chip-selected-color,var(--primary))] bg-card text-[var(--guest-chip-selected-color,var(--primary))] hover:bg-card active:bg-card",
        relatedBoth:
          "border-[var(--guest-chip-selected-color,var(--primary))] bg-[var(--guest-chip-bg,var(--secondary))] text-secondary-foreground hover:bg-[var(--guest-chip-bg,var(--secondary))] active:bg-[var(--guest-chip-bg,var(--secondary))]",
        highlighted:
          "border-[var(--guest-chip-highlight-border)] bg-[var(--guest-chip-highlight-bg)] text-[var(--guest-chip-highlight-fg)] hover:bg-[var(--guest-chip-highlight-bg)] active:bg-[var(--guest-chip-highlight-bg)]",
        searchMatch:
          "border-[var(--search-match-border)] bg-[var(--search-match-bg)] text-[var(--search-match-fg)] hover:bg-[var(--search-match-bg)] active:bg-[var(--search-match-bg)]",
      },
      context: {
        sidebar: "w-auto",
        table: "w-full h-full box-border",
      },
    },
    defaultVariants: {
      state: "default",
      context: "sidebar",
    },
  }
);

const chipToggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full border text-2xs font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      state: {
        default:
          "border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent/90",
        pressed:
          "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15 active:bg-primary/20",
      },
      size: {
        sm: "h-6 px-2.5",
        list: "h-auto w-full justify-between rounded-md px-2.5 py-2 text-xs",
      },
    },
    defaultVariants: {
      state: "default",
      size: "sm",
    },
  }
);

type GuestChipVariantProps = VariantProps<typeof guestChipVariants>;
type ChipToggleVariantProps = VariantProps<typeof chipToggleVariants>;

export {
  chipToggleVariants,
  guestChipVariants,
  type ChipToggleVariantProps,
  type GuestChipVariantProps,
};
