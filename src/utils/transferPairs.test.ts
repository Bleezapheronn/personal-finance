import { describe, expect, it } from "vitest";
import { resolveTransferPairEditLinks } from "./transferPairs";

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
});
