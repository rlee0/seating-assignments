import { describe, expect, it } from "vitest";

import {
  assignTokenSlots,
  buildHighlightColor,
  createHighlightPalettes,
  getDomainFromToken,
} from "../src/lib/palette";

describe("dynamic palette generation", () => {
  it("builds deterministic palettes from the same domain counts", () => {
    const left = createHighlightPalettes({ group: 12, household: 32, host: 6 });
    const right = createHighlightPalettes({ group: 12, household: 32, host: 6 });

    expect(left).toEqual(right);
  });

  it("uses tonal overflow tiers when domain count exceeds distinct hue capacity", () => {
    const palettes = createHighlightPalettes({ group: 45, household: 20, host: 8 });

    expect(palettes.group.slots).toHaveLength(45);
    expect(palettes.group.distinctHueCount).toBe(20);
    expect(palettes.group.slots.some((slot) => slot.tier > 0)).toBe(true);
  });

  it("assigns token slots deterministically regardless of token input order", () => {
    const palettes = createHighlightPalettes({ group: 8, household: 8, host: 8 });
    const tokens = ["group:Alpha", "group:Beta", "group:Gamma", "group:Delta"];

    const forward = assignTokenSlots(tokens, palettes.group);
    const reversed = assignTokenSlots([...tokens].reverse(), palettes.group);

    expect(forward).toEqual(reversed);
  });

  it("returns domain-aware highlight colors with tier variation", () => {
    const palettes = createHighlightPalettes({ group: 30, household: 10, host: 5 });
    const assignments = assignTokenSlots(
      [...Array.from({ length: 30 }, (_, index) => `group:G${index}`)],
      palettes.group
    );

    const baseSlot = assignments.get("group:G0");
    const overflowSlot = assignments.get("group:G25");

    expect(baseSlot).toBeTruthy();
    expect(overflowSlot).toBeTruthy();

    const base = buildHighlightColor(baseSlot!);
    const overflow = buildHighlightColor(overflowSlot!);

    expect(base.background.startsWith("oklch(")).toBe(true);
    expect(overflow.background.startsWith("oklch(")).toBe(true);
    expect(base.background).not.toBe(overflow.background);
  });

  it("parses known token domains and falls back to default", () => {
    expect(getDomainFromToken("group:Friends")).toBe("group");
    expect(getDomainFromToken("household:p1")).toBe("household");
    expect(getDomainFromToken("host:Ryan")).toBe("host");
    expect(getDomainFromToken("unknown:value")).toBe("default");
    expect(getDomainFromToken("nocolon")).toBe("default");
  });
});
