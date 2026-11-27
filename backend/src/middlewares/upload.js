'use strict';

const multer = require('multer');
const { AppError, validation } = require('../utils/errors');

/**
 * Tạo middleware tải lên đúng một tệp ảnh vào bộ nhớ (RAM).
 * Bỏ qua mimetype/originalname; việc kiểm tra magic bytes thực hiện ở service.
 * @param {string} fieldName
 * @param {object} config
 */
function uploadSingle(fieldName, config) {
  const maxBytes = config?.storage?.uploadMaxBytes || 5242880;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 1,
      fileSize: maxBytes
    }
  }).single(fieldName);

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(413, 'file_too_large', 'Ảnh tối đa 5 MB.'));
          }
          return next(
            validation('Tệp tải lên không hợp lệ.', {
              [fieldName]: 'Chỉ được gửi đúng một tệp ảnh hợp lệ.'
            })
          );
        }
        return next(err);
      }

      if (!req.file) {
        return next(
          validation('Chưa chọn ảnh.', {
            [fieldName]: 'Chưa chọn ảnh.'
          })
        );
      }

      return next();
    });
  };
}

module.exports = { uploadSingle };
