'use strict';

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, data: null, message: 'Đường dẫn không tồn tại.', code: 'not_found' });
}

function createErrorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const body = (status, message, code, errors) => {
      const out = { success: false, data: null, message };
      if (code) out.code = code;
      if (errors) out.errors = errors;
      return res.status(status).json(out);
    };
    if (err && err.name === 'AppError') return body(err.status, err.message, err.code, err.errors);
    if (err && err.type === 'entity.parse.failed') return body(400, 'Dữ liệu gửi lên không phải JSON hợp lệ.', 'bad_json');
    if (err && err.type === 'entity.too.large') return body(413, 'Dữ liệu gửi lên quá lớn. Ảnh thú cưng tối đa 400 KB.', 'too_large');
    // Never leak internals (stack traces, SQL errors) to the client.
    if (logger) logger.error('[unhandled]', err && err.message ? err.message : err);
    return body(500, 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau ít phút.', 'internal');
  };
}

module.exports = { notFoundHandler, createErrorHandler };
