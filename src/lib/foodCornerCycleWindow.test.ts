/**
 * The supplier's "Ta teden" line: order deadline and delivery of the cycle whose
 * orders are listed, not of the next order. Pure, no React, no network.
 *   npm run test:cycle-window
 *
 * 24. 11. 2026 a supplier saw this week's orders (for Thursday 26. 11.) under
 * "Naročaj do: pon., 30. nov." and "Dostavi do: četrtek, 3. dec." — the window a
 * NEW order gets once the Monday cutoff has passed.
 */
process.env.TZ = "Europe/Ljubljana";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FoodCornerNode } from "@/types/foodCorner";
import { foodCornerCycleWindow, foodCornerOrderingWindow } from "./foodCorner";

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date | null) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
const at = (text: string) => new Date(text); // local time (TZ above)

const point = (cutoffDay: string, cutoffTime: string, pickupDay: string, window: string) =>
  ({
    orderCutoffDay: cutoffDay,
    orderCutoffTime: cutoffTime,
    pickups: pickupDay || window ? [{ id: "p1", label: "", lat: "", lon: "", day: pickupDay, window }] : [],
  }) as unknown as FoodCornerNode;

// Monday 18:00 deadline, Thursday "18:00 - 20.00" pickup — as the point that reported it.
const MON_THU = point("monday", "18:00", "thursday", "18:00 - 20.00");

const win = (node: FoodCornerNode, offset: number, now: string) => {
  const w = foodCornerCycleWindow(node, offset, at(now));
  return { cutoff: local(w.cutoff), pickup: local(w.pickup), window: w.pickupWindow };
};

describe("foodCornerCycleWindow", () => {
  it("after the Monday cutoff keeps this cycle: deadline passed, delivery this Thursday", () => {
    const now = "2026-11-24T13:12:00";
    assert.deepEqual(win(MON_THU, 0, now), { cutoff: "2026-11-23 18:00", pickup: "2026-11-26 18:00", window: "18:00 - 20.00" });
    assert.ok(foodCornerCycleWindow(MON_THU, 0, at(now)).cutoff!.getTime() < at(now).getTime());
    // What the page showed before: the next order's window, one week later.
    const next = foodCornerOrderingWindow(MON_THU, at(now));
    assert.deepEqual([local(next.cutoff), local(next.pickup)], ["2026-11-30 18:00", "2026-12-03 18:00"]);
  });

  it("before the cutoff it is the same as the next order's window (nothing changes then)", () => {
    for (const now of ["2026-11-19T00:00:00", "2026-11-21T10:00:00", "2026-11-23T17:59:00"]) {
      const w = foodCornerCycleWindow(MON_THU, 0, at(now));
      const next = foodCornerOrderingWindow(MON_THU, at(now));
      assert.deepEqual([local(w.cutoff), local(w.pickup)], ["2026-11-23 18:00", "2026-11-26 18:00"], now);
      assert.deepEqual([local(w.cutoff), local(w.pickup)], [local(next.cutoff), local(next.pickup)], now);
    }
  });

  it("a minute after the cutoff the deadline stays where it was", () => {
    assert.deepEqual(win(MON_THU, 0, "2026-11-23T18:01:00"), { cutoff: "2026-11-23 18:00", pickup: "2026-11-26 18:00", window: "18:00 - 20.00" });
  });

  it("on the pickup day the listed cycle has already rolled to next Thursday (as the list does)", () => {
    assert.deepEqual(win(MON_THU, 0, "2026-11-26T10:00:00"), { cutoff: "2026-11-30 18:00", pickup: "2026-12-03 18:00", window: "18:00 - 20.00" });
  });

  it("offset 1 is the previous cycle", () => {
    assert.deepEqual(win(MON_THU, 1, "2026-11-24T13:12:00"), { cutoff: "2026-11-16 18:00", pickup: "2026-11-19 18:00", window: "18:00 - 20.00" });
  });

  it("keeps wall-clock times across the end of summer time (25. 10. 2026)", () => {
    assert.deepEqual(win(MON_THU, 0, "2026-10-27T12:00:00"), { cutoff: "2026-10-26 18:00", pickup: "2026-10-29 18:00", window: "18:00 - 20.00" });
  });

  it("a same-day cutoff (Thursday 09:00, pickup Thursday 18:00) falls on the pickup day", () => {
    const node = point("thursday", "09:00", "thursday", "18:00–20:00");
    assert.deepEqual(win(node, 0, "2026-11-20T12:00:00"), { cutoff: "2026-11-26 09:00", pickup: "2026-11-26 18:00", window: "18:00–20:00" });
  });

  it("a cutoff later in the week than the pickup (Friday cutoff, Monday pickup)", () => {
    const node = point("friday", "12:00", "monday", "16:00-18:00");
    // Saturday 21. 11.: Friday's cutoff has passed, the cycle's pickup is Monday 23. 11.
    assert.deepEqual(win(node, 0, "2026-11-21T09:00:00"), { cutoff: "2026-11-20 12:00", pickup: "2026-11-23 16:00", window: "16:00-18:00" });
  });

  it("no cutoff day: no deadline, the delivery still shows", () => {
    assert.deepEqual(win(point("", "", "thursday", "18:00-20:00"), 0, "2026-11-24T13:12:00"), {
      cutoff: null,
      pickup: "2026-11-26 18:00",
      window: "18:00-20:00",
    });
  });

  it("no or unknown pickup day: no dates (the page falls back to the day's name)", () => {
    assert.deepEqual(win(point("monday", "18:00", "", ""), 0, "2026-11-24T13:12:00"), { cutoff: null, pickup: null, window: "" });
    assert.deepEqual(win(point("monday", "18:00", "četrtek", "18:00"), 0, "2026-11-24T13:12:00"), { cutoff: null, pickup: null, window: "18:00" });
  });

  it("a pickup window without a time starts at midnight", () => {
    assert.deepEqual(win(point("monday", "18:00", "thursday", ""), 0, "2026-11-24T13:12:00"), { cutoff: "2026-11-23 18:00", pickup: "2026-11-26 00:00", window: "" });
  });
});
