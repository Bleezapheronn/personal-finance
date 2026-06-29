export const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
