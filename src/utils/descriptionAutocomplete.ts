export interface DescriptionSuggestion {
  text: string;
  count: number;
  latest?: number | string;
}

export const fuzzyMatchDescription = (query: string, candidate: string): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return false;
  const normalizedCandidate = candidate.trim().toLocaleLowerCase();
  let queryIndex = 0;
  for (const character of normalizedCandidate) {
    if (character === normalizedQuery[queryIndex]) queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return true;
  }
  return false;
};

export const rankDescriptionSuggestions = (
  suggestions: DescriptionSuggestion[],
): DescriptionSuggestion[] =>
  suggestions
    .filter((item) => item.text.trim().length > 0)
    .sort(
      (left, right) =>
        right.count - left.count ||
        new Date(String(right.latest ?? 0)).getTime() -
          new Date(String(left.latest ?? 0)).getTime() ||
        left.text.localeCompare(right.text),
    );

export const visibleDescriptionSuggestions = (
  query: string,
  suggestions: DescriptionSuggestion[],
  limit = 5,
): DescriptionSuggestion[] =>
  rankDescriptionSuggestions(suggestions)
    .filter((item) => fuzzyMatchDescription(query, item.text))
    .slice(0, limit);
