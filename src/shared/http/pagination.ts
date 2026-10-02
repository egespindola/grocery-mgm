import { z } from 'zod';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof paginationQuery>;

export interface Page<T> {
  data: T[];
  meta: Pagination & { total: number };
}

export function toPage<T>(data: T[], pagination: Pagination, total: number): Page<T> {
  return { data, meta: { limit: pagination.limit, offset: pagination.offset, total } };
}
