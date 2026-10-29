export interface PagedReadResponse {
  rows: unknown[];
  count?: number;
}

export type PagedReadResult = unknown[] | PagedReadResponse;

export type PagedReadList = (options: {
  limit: number;
  offset: number;
}) => Promise<unknown>;

export interface LoadAllPagesOptions {
  pageSize?: number;
  maximum?: number;
}

const rowsFromResult = (result: unknown): unknown[] => {
  if (Array.isArray(result)) {
    return result;
  }

  if (
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as PagedReadResponse).rows)
  ) {
    return (result as PagedReadResponse).rows;
  }

  throw new Error("paged_read_response_invalid");
};

const countFromResult = (
  result: unknown,
): number | undefined =>
  Array.isArray(result) ||
  typeof result !== "object" ||
  result === null ||
  typeof (result as PagedReadResponse).count !== "number"
    ? undefined
    : (result as PagedReadResponse).count;

/**
 * Reads every page advertised by a selected-read repository. A hard maximum
 * fails closed instead of silently omitting lookup rows.
 */
export const loadAllPages = async <Row,>(
  list: PagedReadList,
  { pageSize = 200, maximum = 5_000 }: LoadAllPagesOptions = {},
): Promise<Row[]> => {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error("paged_read_page_size_invalid");
  }

  if (!Number.isInteger(maximum) || maximum <= 0) {
    throw new Error("paged_read_maximum_invalid");
  }

  const all: Row[] = [];
  let expectedCount: number | undefined;

  while (all.length < maximum) {
    const limit = Math.min(pageSize, maximum - all.length);
    const result = await list({ limit, offset: all.length });
    const page = rowsFromResult(result);
    const count = countFromResult(result);

    if (count !== undefined) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error("paged_read_count_invalid");
      }
      expectedCount ??= count;
      if (expectedCount !== count) {
        throw new Error("paged_read_count_changed");
      }
      if (expectedCount > maximum) {
        throw new Error("paged_read_maximum_exceeded");
      }
    }

    all.push(...(page as Row[]));

    if (expectedCount !== undefined && all.length >= expectedCount) {
      return all;
    }

    if (page.length === 0) {
      if (expectedCount !== undefined) {
        throw new Error("paged_read_incomplete");
      }
      return all;
    }

    if (page.length < limit && expectedCount === undefined) {
      return all;
    }
  }

  throw new Error("paged_read_maximum_exceeded");
};

/**
 * Keeps an edit form usable if its selected lookup row falls outside a list
 * response (for example during a transient paging or filtering failure).
 */
export const appendMissingRowsById = async <Row extends { id?: number },>(
  rows: Row[],
  ids: Array<number | undefined>,
  getById: (id: number) => Promise<Row | undefined>,
): Promise<Row[]> => {
  const knownIds = new Set(
    rows.flatMap((row) => (typeof row.id === "number" ? [row.id] : [])),
  );
  const missingIds = [...new Set(ids)].filter(
    (id): id is number => typeof id === "number" && !knownIds.has(id),
  );

  if (missingIds.length === 0) {
    return rows;
  }

  const additions: Row[] = [];
  for (const id of missingIds) {
    const row = await getById(id);
    if (
      row !== undefined &&
      typeof row.id === "number" &&
      !knownIds.has(row.id)
    ) {
      additions.push(row);
      knownIds.add(row.id);
    }
  }

  return additions.length === 0 ? rows : [...rows, ...additions];
};
