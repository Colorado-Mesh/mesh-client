/** Escape `%`, `_`, and `\` for SQL LIKE with ESCAPE '\\'. */
export function escapeSqlLikePattern(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
