export type ExchangeRateMode = "derived" | "manual";

export interface ExchangeRateState {
  mode: ExchangeRateMode;
  value: string;
}

const finiteNonZeroNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined;
};

export const deriveExchangeRate = (
  amount: string,
  originalAmount: string,
): string => {
  const numericAmount = finiteNonZeroNumber(amount);
  const numericOriginalAmount = finiteNonZeroNumber(originalAmount);

  if (numericAmount === undefined || numericOriginalAmount === undefined) {
    return "";
  }

  return Math.abs(numericAmount / numericOriginalAmount).toFixed(4);
};

export const exchangeRateModeForStoredRate = (
  exchangeRate: number | null | undefined,
): ExchangeRateMode =>
  exchangeRate === null || exchangeRate === undefined ? "derived" : "manual";

export const derivedExchangeRateState = (
  amount: string,
  originalAmount: string,
): ExchangeRateState => ({
  mode: "derived",
  value: deriveExchangeRate(amount, originalAmount),
});

export const exchangeRateStateForInput = (
  value: string,
  amount: string,
  originalAmount: string,
): ExchangeRateState =>
  value.trim() === ""
    ? derivedExchangeRateState(amount, originalAmount)
    : { mode: "manual", value };
