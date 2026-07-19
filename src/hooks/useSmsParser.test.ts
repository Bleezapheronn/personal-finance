import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SmsImportTemplate } from "../db";
import { useSmsParser } from "./useSmsParser";

const template = (
  id: number,
  overrides: Partial<SmsImportTemplate> = {},
): SmsImportTemplate => ({
  id,
  name: `Synthetic template ${id}`,
  amountPattern: "Ksh\\s*([\\d,]+(?:\\.\\d{1,2})?)",
  incomePattern: "received",
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

describe("useSmsParser template regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves existing case-insensitive extraction and amount normalization", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { result } = renderHook(() => useSmsParser([template(1)]));

    await expect(result.current.parseSms("RECEIVED Ksh 1,234.50")).resolves.toMatchObject({
      amount: "1234.50",
      isIncome: true,
      templateId: 1,
    });
  });

  it("preserves first-template precedence when scores tie", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useSmsParser([template(16), template(17)]),
    );

    await expect(result.current.parseSms("received Ksh 10")).resolves.toMatchObject({
      templateId: 16,
    });
  });

  it("fails safely for malformed patterns without creating parsed output", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useSmsParser([template(2, { amountPattern: "(" })]),
    );

    await expect(result.current.parseSms("received Ksh 10")).resolves.toBeNull();
  });

  it("preserves caller-controlled active-template filtering", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const templates = [
      template(3, { isActive: false }),
      template(4, { isActive: true }),
    ].filter((candidate) => candidate.isActive !== false);
    const { result } = renderHook(() => useSmsParser(templates));

    await expect(result.current.parseSms("received Ksh 10")).resolves.toMatchObject({
      templateId: 4,
    });
  });
});
