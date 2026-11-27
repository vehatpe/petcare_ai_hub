'use strict';
const { notFound } = require('./errors');
const { isUuid } = require('./validators');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data, message = 'Thành công', status = 200, meta = undefined) => {
  const body = { success: true, data, message };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
};
/** Route params that are not GUIDs can never match a row -> 404 (also keeps SQL type errors away). */
const uuidParam = (name) => (req, res, next) => (isUuid(req.params[name]) ? (req.params[name] = req.params[name].toLowerCase(), next()) : next(notFound()));

module.exports = { wrap, ok, uuidParam };
