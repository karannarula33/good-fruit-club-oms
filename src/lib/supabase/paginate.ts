// PostgREST caps an unpaginated select at 1000 rows and returns the page
// silently -- no error, just fewer rows than exist. Any query over a table
// that can plausibly grow past that (orders, order_lines) must page through
// with .range() instead of a bare .select(), or it starts truncating.
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}
