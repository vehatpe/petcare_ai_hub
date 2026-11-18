'use strict';
const { notFound, conflict, validation, forbidden, AppError } = require('../utils/errors');

/**
 * Tạo slug từ orgName:
 * - NFD bỏ dấu tổ hợp (diacritics)
 * - đ / Đ -> d
 * - chữ thường
 * - ký tự không [a-z0-9] thành '-'
 * - gộp '-' liền nhau, bỏ '-' đầu/cuối
 * - nếu rỗng -> 'co-so'
 */
function slugifyOrgName(name) {
  if (!name) return 'co-so';
  let s = String(name).trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'co-so';
}

/**
 * Cắt baseSlug sao cho khi ghép hậu tố suffix (ví dụ '-2', '-10')
 * tổng độ dài không vượt quá maxLen (50 ký tự).
 */
function makeCandidateId(baseSlug, suffixNum, maxLen = 50) {
  if (suffixNum <= 1) {
    return baseSlug.slice(0, maxLen).replace(/-+$/, '');
  }
  const suffix = `-${suffixNum}`;
  const allowedBaseLen = maxLen - suffix.length;
  const trimmedBase = baseSlug.slice(0, allowedBaseLen).replace(/-+$/, '');
  return `${trimmedBase}${suffix}`;
}

function createAdminService({ models, config, clock = () => new Date() }) {
  const adminModel = models.admin;

  return {
    async listUsers(query = {}) {
      return adminModel.listUsers({
        status: query.status ? String(query.status).trim() : undefined,
        role: query.role ? String(query.role).trim() : undefined,
        limit: query.limit,
        offset: query.offset
      });
    },

    async approve(adminId, userId, { area } = {}) {
      return adminModel.transaction(async (tx) => {
        const user = await adminModel.getUserForUpdate(tx, userId);
        if (!user) throw notFound('Không tìm thấy người dùng cần duyệt.');

        if (user.role !== 'provider') {
          throw new AppError(400, 'invalid_role', 'Chỉ có thể phê duyệt tài khoản đối tác (provider).');
        }

        if (user.status === 'active') {
          throw conflict('Tài khoản đối tác này đã được duyệt trước đó.');
        }

        if (user.status !== 'pending') {
          throw conflict('Chỉ có thể phê duyệt tài khoản đang ở trạng thái chờ duyệt (pending).');
        }

        const orgArea = (area !== undefined && area !== null && String(area).trim())
          ? String(area).trim()
          : (user.orgArea ? String(user.orgArea).trim() : null);

        if (!orgArea) {
          throw validation('Khu vực hoạt động (area) là bắt buộc khi phê duyệt đối tác.', { area: 'Khu vực hoạt động là bắt buộc.' });
        }

        if (orgArea.length > 100) {
          throw validation('Khu vực hoạt động (area) tối đa 100 ký tự.', { area: 'Khu vực hoạt động tối đa 100 ký tự.' });
        }

        // Tạo ProviderId không trùng lặp và <= 50 ký tự
        const baseSlug = slugifyOrgName(user.orgName);
        let chosenProviderId = null;

        for (let i = 1; i <= 1000; i++) {
          const candidate = makeCandidateId(baseSlug, i, 50);
          const exists = await adminModel.providerExists(tx, candidate);
          if (!exists) {
            chosenProviderId = candidate;
            break;
          }
        }

        if (!chosenProviderId) {
          throw conflict('Không thể sinh mã đối tác duy nhất cho cơ sở này.');
        }

        // Tạo dòng Providers
        await adminModel.insertProvider(tx, {
          providerId: chosenProviderId,
          name: user.orgName || 'Cơ sở đối tác',
          area: orgArea,
          type: user.orgType || 'clinic',
          isSample: false,
          isActive: true
        });

        const approvedAt = clock().toISOString();

        // Cập nhật Users
        await adminModel.updateUserApproval(tx, {
          userId,
          providerId: chosenProviderId,
          approvedBy: adminId,
          approvedAt
        });

        // Ghi AuditLog
        await adminModel.logAudit(tx, {
          actorUserId: adminId,
          action: 'approve_provider',
          targetType: 'user',
          targetId: userId,
          detail: JSON.stringify({ providerId: chosenProviderId, area: orgArea, orgName: user.orgName })
        });

        return {
          id: userId,
          role: user.role,
          status: 'active',
          providerId: chosenProviderId,
          orgArea,
          approvedBy: adminId,
          approvedAt
        };
      });
    },

    async reject(adminId, userId, { reason } = {}) {
      const rejectReason = reason ? String(reason).trim() : '';
      if (!rejectReason) {
        throw validation('Lý do từ chối là bắt buộc.', { reason: 'Vui lòng cung cấp lý do từ chối.' });
      }
      if (rejectReason.length > 200) {
        throw validation('Lý do từ chối tối đa 200 ký tự.', { reason: 'Lý do từ chối tối đa 200 ký tự.' });
      }

      return adminModel.transaction(async (tx) => {
        const user = await adminModel.getUserForUpdate(tx, userId);
        if (!user) throw notFound('Không tìm thấy người dùng cần từ chối.');

        if (user.role === 'admin') {
          throw forbidden('Không thể thực hiện thao tác từ chối đối với quản trị viên.');
        }

        if (user.status !== 'pending') {
          throw conflict('Chỉ có thể từ chối tài khoản đang ở trạng thái chờ duyệt (pending).');
        }

        await adminModel.updateUserRejection(tx, {
          userId,
          rejectReason
        });

        await adminModel.logAudit(tx, {
          actorUserId: adminId,
          action: 'reject_user',
          targetType: 'user',
          targetId: userId,
          detail: JSON.stringify({ reason: rejectReason })
        });

        return {
          id: userId,
          status: 'rejected',
          rejectReason
        };
      });
    },

    async disable(adminId, userId) {
      if (String(adminId).toLowerCase() === String(userId).toLowerCase()) {
        throw forbidden('Quản trị viên không thể tự khóa tài khoản của chính mình.');
      }

      return adminModel.transaction(async (tx) => {
        const user = await adminModel.getUserForUpdate(tx, userId);
        if (!user) throw notFound('Không tìm thấy người dùng cần khóa.');

        if (user.status !== 'active') {
          throw conflict('Chỉ có thể khóa tài khoản đang hoạt động (active).');
        }

        if (user.role === 'admin') {
          const activeAdmins = await adminModel.countActiveAdmins(tx);
          if (activeAdmins <= 1) {
            throw forbidden('Không thể khóa quản trị viên active cuối cùng trong hệ thống.');
          }
        }

        await adminModel.updateUserStatus(tx, userId, 'disabled');

        if (user.role === 'provider' && user.providerId) {
          await adminModel.disableProviderAndVets(tx, user.providerId);
        }

        await adminModel.logAudit(tx, {
          actorUserId: adminId,
          action: 'disable_user',
          targetType: 'user',
          targetId: userId,
          detail: JSON.stringify({ role: user.role, providerId: user.providerId })
        });

        return {
          id: userId,
          status: 'disabled'
        };
      });
    },

    async enable(adminId, userId) {
      return adminModel.transaction(async (tx) => {
        const user = await adminModel.getUserForUpdate(tx, userId);
        if (!user) throw notFound('Không tìm thấy người dùng cần mở khóa.');

        if (user.status !== 'disabled') {
          throw conflict('Chỉ có thể mở khóa tài khoản đang bị khóa (disabled).');
        }

        if (user.role === 'vet') {
          if (!user.providerId) {
            throw conflict('Bác sĩ chưa được gán vào cơ sở đối tác nào.');
          }
          const providerActive = await adminModel.isProviderActive(tx, user.providerId);
          if (!providerActive) {
            throw conflict('Cơ sở của bác sĩ này đang bị khóa; hãy mở khóa cơ sở trước.');
          }
        }

        await adminModel.updateUserStatus(tx, userId, 'active');

        if (user.role === 'provider' && user.providerId) {
          await adminModel.enableProviderOnly(tx, user.providerId);
        }

        await adminModel.logAudit(tx, {
          actorUserId: adminId,
          action: 'enable_user',
          targetType: 'user',
          targetId: userId,
          detail: JSON.stringify({ role: user.role, providerId: user.providerId })
        });

        return {
          id: userId,
          status: 'active'
        };
      });
    }
  };
}

module.exports = { createAdminService, slugifyOrgName, makeCandidateId };
