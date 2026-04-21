import { cva, type VariantProps } from "class-variance-authority";

const guestChipVariants = cva(
  "inline-flex items-center gap-1 rounded-[4px] border px-1 py-0.5 text-[11px] leading-[1.2] font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      state: {
        default:
          "border-input bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/75",
        selected:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/85",
        relatedHousehold:
          "border-transparent bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-700",
        relatedGroup:
          "border-transparent bg-blue-100 text-blue-900 hover:bg-blue-200 active:bg-blue-200",
        relatedBoth:
          "border-transparent bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-700",
        highlighted:
          "border-[var(--guest-chip-highlight-border)] bg-[var(--guest-chip-highlight-bg)] text-slate-900 hover:bg-[var(--guest-chip-highlight-bg)] active:bg-[var(--guest-chip-highlight-bg)]",
        searchMatch:
          "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 active:bg-amber-100",
      },
      context: {
        sidebar: "w-auto",
        table: "w-full box-border",
      },
    },
    defaultVariants: {
      state: "default",
      context: "sidebar",
    },
  }
);

const chipToggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-full border text-[11px] font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
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
