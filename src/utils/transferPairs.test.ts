import { describe, expect, it } from "vitest";
import {
  assertValidTransferPairPatches,
  assertValidTransferPairRows,
  resolveTransferPairEditLinks,
} from "./transferPairs";

describe("resolveTransferPairEditLinks", () => {
  it("keeps reciprocal links when editing the outgoing side", () => {
    const links = resolveTransferPairEditLinks(
      { id: 180, amount: -30, transferPairId: 181 },
      { id: 181, amount: 30, transferPairId: 180 },
    );

    expect(links).toEqual({
      outgoingTransactionId: 180,
      incomingTransactionId: 181,
      outgoingTransferPairId: 181,
      incomingTransferPairId: 180,
    });

    expect(() =>
      assertValidTransferPairPatches(
        links.outgoingTransactionId,
        { amount: -30, transferPairId: links.incomingTransactionId },
        links.incomingTransactionId,
        { amount: 30, transferPairId: links.outgoingTransactionId },
      ),
    ).not.toThrow();
  });

  it("keeps reciprocal links when editing the incoming side", () => {
    const links = resolveTransferPairEditLinks(
      { id: 181, amount: 30, transferPairId: 180 },
      { id: 180, amount: -30, transferPairId: 181 },
    );

    expect(links).toEqual({
      outgoingTransactionId: 180,
      incomingTransactionId: 181,
      outgoingTransferPairId: 181,
      incomingTransferPairId: 180,
    });

    expect(links.outgoingTransferPairId).not.toBe(links.outgoingTransactionId);
    expect(links.incomingTransferPairId).not.toBe(links.incomingTransactionId);
    expect(() =>
      assertValidTransferPairPatches(
        links.outgoingTransactionId,
        { amount: -30, transferPairId: links.incomingTransactionId },
        links.incomingTransactionId,
        { amount: 30, transferPairId: links.outgoingTransactionId },
      ),
    ).not.toThrow();
  });

  it("blocks self-referenced edited transactions", () => {
    expect(() =>
      resolveTransferPairEditLinks(
        { id: 181, amount: 30, transferPairId: 181 },
        { id: 180, amount: -30, transferPairId: 181 },
      ),
    ).toThrow("points to itself");
  });

  it("blocks non-reciprocal transfer pairs", () => {
    expect(() =>
      resolveTransferPairEditLinks(
        { id: 181, amount: 30, transferPairId: 180 },
        { id: 180, amount: -30, transferPairId: 999 },
      ),
    ).toThrow("not reciprocal");
  });

  it("rejects self-referenced transfer patches", () => {
    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: -30, transferPairId: 180 },
        181,
        { amount: 30, transferPairId: 180 },
      ),
    ).toThrow("outgoing transaction would point to itself");

    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: -30, transferPairId: 181 },
        181,
        { amount: 30, transferPairId: 181 },
      ),
    ).toThrow("incoming transaction would point to itself");
  });

  it("rejects non-reciprocal transfer patches", () => {
    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: -30, transferPairId: 999 },
        181,
        { amount: 30, transferPairId: 180 },
      ),
    ).toThrow("outgoing transaction would not point");

    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: -30, transferPairId: 181 },
        181,
        { amount: 30, transferPairId: 999 },
      ),
    ).toThrow("incoming transaction would not point");
  });

  it("rejects invalid transfer patch amount signs", () => {
    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: 30, transferPairId: 181 },
        181,
        { amount: 30, transferPairId: 180 },
      ),
    ).toThrow("outgoing transaction amount must be negative");

    expect(() =>
      assertValidTransferPairPatches(
        180,
        { amount: -30, transferPairId: 181 },
        181,
        { amount: -30, transferPairId: 180 },
      ),
    ).toThrow("incoming transaction amount must be positive");
  });

  it("post-write verification rejects self-referenced rows", () => {
    expect(() =>
      assertValidTransferPairRows(
        180,
        { id: 180, amount: -30, transferPairId: 180 },
        181,
        { id: 181, amount: 30, transferPairId: 181 },
      ),
    ).toThrow("outgoing transaction would point to itself");
  });
});
