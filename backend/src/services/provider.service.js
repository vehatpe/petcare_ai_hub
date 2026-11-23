'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { notFound, conflict, validation, forbidden, AppError, DuplicateError } = require('../utils/errors');
const { validateVetInput } = require('../utils/validators');

const DUP_MSG = {
  email: ['Email này đã được đăng ký.', 'Email này đã có tài khoản. Hãy dùng email khác.'],
  phone: ['Số điện thoại này đã được đăng ký.', 'Số điện thoại này đã có tài khoản. Hãy dùng số khác.']
};

/**
 * Sinh mật khẩu tạm ngẫu nhiên:
 * - Dùng crypto.randomBytes / crypto.randomInt
 * - Độ dài 12 ký tự
 * - Đảm bảo đủ chữ hoa, chữ thường, chữ số (thỏa mãn validators: >= 8 ký tự, có chữ và số)
 */
function generateTempPassword() {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = uppers + lowers + digits + '!@#$%&*';

  const chars = [
    uppers[crypto.randomInt(0, uppers.length)],
    lowers[crypto.randomInt(0, lowers.length)],
    digits[crypto.randomInt(0, digits.length)],
    digits[crypto.randomInt(0, digits.length)]
  ];

  while (chars.length < 12) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }

  // Shuffle Fisher-Yates
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join('');
}

function createProviderService({ models, config, clock = () => new Date() }) {
  const memberModel = models.providerMember;
  const adminModel = models.admin; // để dùng isProviderActive, logAudit, providerExists
  const userModel = models.users;

  const dupError = (field) => conflict(DUP_MSG[field][0], { [field]: DUP_MSG[field][1] }, 'duplicate');

  return {
    async createVet(actorUser, input = {}) {
      let targetProviderId;
      if (actorUser.role === 'admin') {
        const pId = input.providerId ? String(input.providerId).trim() : '';
        if (!pId) {
          throw validation('Mã cơ sở đối tác (providerId) là bắt buộc khi quản trị viên tạo bác sĩ.', { providerId: 'Vui lòng cung cấp providerId.' });
        }
        targetProviderId = pId;
      } else if (actorUser.role === 'provider') {
        if (actorUser.status !== 'active') {
          throw forbidden('Chỉ đối tác đang hoạt động (active) mới có quyền tạo bác sĩ.');
        }
        if (!actorUser.providerId) {
          throw forbidden('Tài khoản đối tác chưa được liên kết với cơ sở nào.');
        }
        targetProviderId = actorUser.providerId;
      } else {
        throw forbidden('Bạn không có quyền thực hiện chức năng này.');
      }

      // 1. Thực hiện các thao tác ngoài callback transaction: validate, sinh password, hash, uuid
      const { errors, value } = validateVetInput(input || {});
      if (Object.keys(errors).length) {
        throw validation('Vui lòng kiểm tra lại thông tin bác sĩ.', errors);
      }

      // Kiểm tra trùng email/phone ở ngoài để trả lỗi nhanh
      if (await userModel.findByEmail(value.email)) throw dupError('email');
      if (await userModel.findByPhone(value.phone)) throw dupError('phone');

      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, config.bcryptCost);
      const vetId = crypto.randomUUID();
      const createdAt = clock().toISOString();

      const user = {
        id: vetId,
        role: 'vet',
        status: 'active',
        fullName: value.fullName,
        email: value.email,
        phone: value.phone,
        passwordHash,
        providerId: targetProviderId,
        mustChangePassword: true,
        createdAt
      };

      // 2. Mở transaction: callback CHỈ chứa thao tác DB thuần túy
      const createdVet = await memberModel.transaction(async (tx) => {
        if (actorUser.role === 'admin') {
          const exists = await adminModel.providerExists(tx, targetProviderId);
          if (!exists) {
            throw notFound('Không tìm thấy cơ sở đối tác được chỉ định.');
          }
          const isActive = await adminModel.isProviderActive(tx, targetProviderId);
          if (!isActive) {
            throw validation('Cơ sở đối tác được chỉ định hiện đang bị khóa.', { providerId: 'Cơ sở này đang bị khóa.' });
          }
        } else {
          const isActive = await adminModel.isProviderActive(tx, targetProviderId);
          if (!isActive) {
            throw conflict('Cơ sở của bạn hiện đang bị khóa.');
          }
        }

        try {
          await userModel.create(user, tx);
        } catch (e) {
          if (e instanceof DuplicateError) throw dupError(e.field);
          throw e;
        }

        // Ghi AuditLog (Detail TUYỆT ĐỐI không chứa mật khẩu)
        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'vet_created',
          targetType: 'user',
          targetId: vetId,
          detail: JSON.stringify({ fullName: value.fullName, email: value.email, providerId: targetProviderId })
        });

        return {
          id: vetId,
          role: 'vet',
          status: 'active',
          fullName: value.fullName,
          email: value.email,
          phone: value.phone,
          providerId: targetProviderId,
          mustChangePassword: true,
          createdAt
        };
      });

      // 3. tempPassword giữ ở ngoài và chỉ trả sau khi transaction commit thành công
      return {
        vet: createdVet,
        tempPassword
      };
    },

    async listVets(actorUser, query = {}) {
      let targetProviderId;
      if (actorUser.role === 'admin') {
        targetProviderId = query.providerId ? String(query.providerId).trim() : null;
        if (!targetProviderId) {
          throw validation('Quản trị viên cần chỉ định providerId khi xem danh sách bác sĩ.', { providerId: 'Vui lòng cung cấp providerId.' });
        }
      } else if (actorUser.role === 'provider') {
        if (actorUser.status !== 'active') throw forbidden('Tài khoản đối tác không hoạt động.');
        targetProviderId = actorUser.providerId;
        if (!targetProviderId) throw forbidden('Tài khoản đối tác chưa gắn cơ sở.');
      } else {
        throw forbidden('Bạn không có quyền truy cập danh sách bác sĩ.');
      }

      return memberModel.listVets({
        providerId: targetProviderId,
        limit: query.limit,
        offset: query.offset
      });
    },

    async disableVet(actorUser, vetId) {
      const targetProviderId = actorUser.role === 'provider' ? actorUser.providerId : null;

      return memberModel.transaction(async (tx) => {
        const vet = await memberModel.getVetForUpdate(tx, vetId);
        if (!vet) throw notFound('Không tìm thấy bác sĩ cần khóa.');

        // Kiểm tra quyền cơ sở
        if (actorUser.role === 'provider' && (!targetProviderId || vet.providerId !== targetProviderId)) {
          // Vet cơ sở khác -> 404 (không lộ sự tồn tại)
          throw notFound('Không tìm thấy bác sĩ cần khóa.');
        }

        if (vet.status !== 'active') {
          throw conflict('Chỉ có thể khóa bác sĩ đang hoạt động (active).');
        }

        await memberModel.updateVetStatus(tx, vetId, 'disabled', true);

        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'disable_vet',
          targetType: 'user',
          targetId: vetId,
          detail: JSON.stringify({ providerId: vet.providerId, role: 'vet' })
        });

        return { id: vetId, status: 'disabled' };
      });
    },

    async enableVet(actorUser, vetId) {
      const targetProviderId = actorUser.role === 'provider' ? actorUser.providerId : null;

      return memberModel.transaction(async (tx) => {
        const vet = await memberModel.getVetForUpdate(tx, vetId);
        if (!vet) throw notFound('Không tìm thấy bác sĩ cần mở khóa.');

        // Kiểm tra quyền cơ sở
        if (actorUser.role === 'provider' && (!targetProviderId || vet.providerId !== targetProviderId)) {
          // Vet cơ sở khác -> 404 (không lộ sự tồn tại)
          throw notFound('Không tìm thấy bác sĩ cần mở khóa.');
        }

        if (vet.status !== 'disabled') {
          throw conflict('Chỉ có thể mở khóa bác sĩ đang bị khóa (disabled).');
        }

        // Bổ sung Việc 1: route enable chỉ được mở khóa vet khi cơ sở của vet đang hoạt động (Providers.IsActive = 1)
        const providerActive = await adminModel.isProviderActive(tx, vet.providerId);
        if (!providerActive) {
          throw conflict('Cơ sở của bác sĩ này đang bị khóa; hãy mở khóa cơ sở trước.');
        }

        await memberModel.updateVetStatus(tx, vetId, 'active');

        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'enable_vet',
          targetType: 'user',
          targetId: vetId,
          detail: JSON.stringify({ providerId: vet.providerId, role: 'vet' })
        });

        return { id: vetId, status: 'active' };
      });
    }
  };
}

module.exports = { createProviderService, generateTempPassword };
