import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Recipient, SmsImportTemplate } from "../db";
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

const recipient = (
  id: number,
  name: string,
  aliases?: string,
): Recipient => ({
  id,
  name,
  aliases,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
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

  it("matches extracted Recipient names across whitespace and case differences", async () => {
    const recipients = [recipient(42, "EVANS ONG'ENI")];
    const smsTemplate = template(5, {
      recipientNamePattern: "to\\s+([A-Z'\\s]+?)\\s+Ksh",
    });
    const { result } = renderHook(() =>
      useSmsParser([smsTemplate], undefined, recipients),
    );

    await expect(
      result.current.parseSms("received to EVANS  ONG'ENI Ksh 10"),
    ).resolves.toMatchObject({
      recipientId: 42,
      recipientName: "Evans  Ong'eni",
      templateId: 5,
    });
  });

  it("matches individual aliases without changing parser extraction", async () => {
    const recipients = [recipient(43, "Different Recipient", "EVANS  ONG'ENI; Other")];
    const smsTemplate = template(6, {
      recipientNamePattern: "to\\s+([A-Z'\\s]+?)\\s+Ksh",
    });
    const { result } = renderHook(() =>
      useSmsParser([smsTemplate], undefined, recipients),
    );

    await expect(
      result.current.parseSms("received to EVANS ONG'ENI Ksh 10"),
    ).resolves.toMatchObject({
      recipientId: 43,
      recipientName: "Evans Ong'eni",
      templateId: 6,
    });
  });
});
