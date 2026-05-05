import { describe, expect, it } from "vitest";

import {
  assignTokenSlots,
  buildHighlightColor,
  createHighlightPalettes,
  getDomainFromToken,
} from "../src/lib/palette";

describe("dynamic palette generation", () => {
  it("builds deterministic palettes from the same domain counts", () => {
    const left = createHighlightPalettes({ circle: 12, party: 32, host: 6 });
    const right = createHighlightPalettes({ circle: 12, party: 32, host: 6 });

    expect(left).toEqual(right);
  });

  it("uses tonal overflow tiers when domain count exceeds distinct hue capacity", () => {
    const palettes = createHighlightPalettes({ circle: 45, party: 20, host: 8 });

    expect(palettes.circle.slots).toHaveLength(45);
    expect(palettes.circle.distinctHueCount).toBe(20);
    expect(palettes.circle.slots.some((slot) => slot.tier > 0)).toBe(true);
  });

  it("assigns token slots deterministically regardless of token input order", () => {
    const palettes = createHighlightPalettes({ circle: 8, party: 8, host: 8 });
    const tokens = ["circle:Alpha", "circle:Beta", "circle:Gamma", "circle:Delta"];

    const forward = assignTokenSlots(tokens, palettes.circle);
    const reversed = assignTokenSlots([...tokens].reverse(), palettes.circle);

    expect(forward).toEqual(reversed);
  });

  it("returns domain-aware highlight colors with tier variation", () => {
    const palettes = createHighlightPalettes({ circle: 30, party: 10, host: 5 });
    const assignments = assignTokenSlots(
      [...Array.from({ length: 30 }, (_, index) => `circle:G${index}`)],
      palettes.circle
    );

    const baseSlot = assignments.get("circle:G0");
    const overflowSlot = assignments.get("circle:G25");

    expect(baseSlot).toBeTruthy();
    expect(overflowSlot).toBeTruthy();

    const base = buildHighlightColor(baseSlot!);
    const overflow = buildHighlightColor(overflowSlot!);

    expect(base.background.startsWith("oklch(")).toBe(true);
    expect(overflow.background.startsWith("oklch(")).toBe(true);
    expect(base.background).not.toBe(overflow.background);
  });

  it("parses known token domains and falls back to default", () => {
    expect(getDomainFromToken("circle:Friends")).toBe("circle");
    expect(getDomainFromToken("party:p1")).toBe("party");
    expect(getDomainFromToken("host:Ryan")).toBe("host");
    expect(getDomainFromToken("unknown:value")).toBe("default");
    expect(getDomainFromToken("nocolon")).toBe("default");
  });
});
