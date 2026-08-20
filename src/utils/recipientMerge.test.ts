import { describe, expect, it } from "vitest";
import type { Recipient } from "../db";
import { findAllDuplicatePairs } from "./recipientMerge";

const recipient = (id: number, name: string): Recipient => ({
  id,
  name,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});

describe("Recipient duplicate matching", () => {
  it("uses canonical whitespace semantics before existing fuzzy matching", () => {
    const canonical = recipient(1, "EVANS ONG'ENI");
    const irregular = recipient(2, " evans\t  ong'eni ");

    expect(findAllDuplicatePairs([canonical, irregular])).toEqual([
      [canonical, irregular],
    ]);
  });
});
