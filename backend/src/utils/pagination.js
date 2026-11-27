'use strict';
const { validation } = require('./errors');

const MAX_PAGE = 1_000_000;

function parsePositiveInt(raw) {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * Parse `page` and `limit` from query parameters.
 * Ignores `offset`. Caps `limit` at `maxLimit`.
 */
function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 50 } = {}) {
  let page = 1;
  if (query.page !== undefined && query.page !== '') {
    const parsedPage = parsePositiveInt(query.page);
    if (parsedPage === null || parsedPage < 1 || parsedPage > MAX_PAGE) {
      throw validation('Trang phải là số nguyên từ 1.', { page: 'Trang phải là số nguyên từ 1.' });
    }
    page = parsedPage;
  }

  let limit = defaultLimit;
  if (query.limit !== undefined && query.limit !== '') {
    const parsedLimit = parsePositiveInt(query.limit);
    if (parsedLimit === null || parsedLimit < 1) {
      throw validation('Số dòng mỗi trang phải là số nguyên từ 1.', { limit: 'Số dòng mỗi trang phải là số nguyên từ 1.' });
    }
    limit = Math.min(parsedLimit, maxLimit);
  }

  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
}

function buildMeta({ page, limit, total }) {
  const safeTotal = Number(total) || 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages: Math.max(1, Math.ceil(safeTotal / limit))
  };
}

module.exports = { parsePagination, buildMeta };
