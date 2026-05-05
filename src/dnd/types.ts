/** What is being dragged and from where. */
export type DragKind = "guest" | "party" | "circle" | "table";

export type DragIntent =
  | {
      kind: "guest";
      guestId: string;
      /** "unassigned" when origin was the sidebar; "seated" when origin was a table seat. */
      source: "unassigned" | "seated";
      /** Provided when source === "seated". */
      tableNumber?: number;
      seatIndex?: number;
    }
  | { kind: "party"; partyId: string }
  | { kind: "circle"; circleName: string }
  | { kind: "table"; tableNumber: number; name: string };

/** Where the dragged item was dropped. */
export type DropTarget =
  | { type: "seat"; tableNumber: number; seatIndex: number }
  | { type: "table"; tableNumber: number }
  | { type: "cell"; row: number; column: number }
  | { type: "unassigned" }
  | { type: "autoseat" };
