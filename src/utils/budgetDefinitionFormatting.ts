export const formatBudgetDefinitionOrdinal = (value: number): string => {
  const absolute = Math.abs(value);
  const remainder = absolute % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  const suffix = (["th", "st", "nd", "rd"] as const)[absolute % 10] ?? "th";
  return `${value}${suffix}`;
};
