'use strict';

class AppError extends Error {
  constructor(status, code, message, errors) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code || null;
    this.errors = errors || null;
  }
}

const validation = (message, errors) => new AppError(422, 'validation', message || 'Vui lòng kiểm tra lại các trường được đánh dấu.', errors);
const notFound = (message) => new AppError(404, 'not_found', message || 'Không tìm thấy dữ liệu yêu cầu.');
const conflict = (message, errors, code) => new AppError(409, code || 'conflict', message, errors);
const unauthenticated = (message) => new AppError(401, 'unauthenticated', message || 'Vui lòng đăng nhập để tiếp tục.');
const forbidden = (message) => new AppError(403, 'forbidden', message || 'Bạn không có quyền thực hiện thao tác này.');
const aiUnavailable = (message) => new AppError(503, 'ai_unavailable', message || 'Trợ lý AI hiện chưa sẵn sàng. Vui lòng thử lại sau.');

/** Thrown by models when a unique index is violated (field = 'email' | 'phone'). */
class DuplicateError extends Error {
  constructor(field) {
    super('duplicate ' + field);
    this.name = 'DuplicateError';
    this.field = field;
  }
}

/** Thrown by models when a business limit is hit inside a transaction. */
class LimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LimitError';
  }
}

module.exports = { AppError, DuplicateError, LimitError, validation, notFound, conflict, unauthenticated, forbidden, aiUnavailable };
