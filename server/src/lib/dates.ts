export const normalizeToLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const parseLocalDay = (dateText: string): Date => {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date must be parseable.");
  }
  return normalizeToLocalDay(date);
};

export const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
