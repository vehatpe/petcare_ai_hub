'use strict';
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { notFound, conflict, validation, forbidden, AppError, DuplicateError } = require('../utils/errors');
const { parsePagination } = require('../utils/pagination');
const {
  validateVetInput,
  normalizePhone,
  parseLegalField,
  getServiceOptions,
  validateServiceInput,
  SERVICE_CATEGORIES,
  SERVICE_LIMITS
} = require('../utils/validators');

const DUP_MSG = {
  email: ['Email này đã được đăng ký.', 'Email này đã có tài khoản. Hãy dùng email khác.'],
  phone: ['Số điện thoại này đã được đăng ký.', 'Số điện thoại này đã có tài khoản. Hãy dùng số khác.']
};

/**
 * Sinh slug không dấu cho tên dịch vụ:
 * - NFD bỏ dấu
 * - đ/Đ -> d
 * - ký tự ngoài [a-z0-9] thành '-'
 * - gộp '-' liền nhau, bỏ '-' đầu cuối
 */
function slugifyServiceName(name) {
  if (!name) return 'dich-vu';
  let s = String(name).trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'dich-vu';
}

/**
 * Ghép candidate ServiceId: <providerId>-<slug-tên> rút gọn để tổng <= maxLen (50 ký tự).
 * Trùng thì thêm hậu tố số (-2, -3...).
 */
function makeServiceCandidateId(providerId, slug, suffixNum, maxLen = 50) {
  const prefix = `${providerId}-`;
  const suffix = suffixNum > 1 ? `-${suffixNum}` : '';
  const allowedSlugLen = maxLen - prefix.length - suffix.length;
  if (allowedSlugLen <= 0) {
    const fallbackPrefix = providerId.slice(0, Math.max(1, maxLen - suffix.length - 2)) + '-';
    return `${fallbackPrefix}${suffix.replace(/^-/, '')}`;
  }
  const trimmedSlug = slug.slice(0, allowedSlugLen).replace(/-+$/, '');
  return `${prefix}${trimmedSlug}${suffix}`;
}

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

  function assertActiveProvider(actorUser) {
    if (actorUser.role !== 'provider') {
      throw forbidden('Chỉ đối tác (provider) mới có quyền thực hiện thao tác này.');
    }
    if (actorUser.status !== 'active') {
      throw forbidden('Tài khoản đối tác chưa được kích hoạt hoặc đang bị khóa.');
    }
    if (!actorUser.providerId) {
      throw notFound('Tài khoản đối tác chưa được liên kết với cơ sở nào.');
    }
  }

  function resolveVetProviderId(actorUser, query = {}) {
    if (actorUser.role === 'admin') {
      const targetProviderId = query.providerId ? String(query.providerId).trim() : null;
      if (!targetProviderId) {
        throw validation('Quản trị viên cần chỉ định providerId khi xem danh sách bác sĩ.', { providerId: 'Vui lòng cung cấp providerId.' });
      }
      return targetProviderId;
    }
    if (actorUser.role === 'provider') {
      if (actorUser.status !== 'active') throw forbidden('Tài khoản đối tác không hoạt động.');
      if (!actorUser.providerId) throw forbidden('Tài khoản đối tác chưa gắn cơ sở.');
      return actorUser.providerId;
    }
    throw forbidden('Bạn không có quyền truy cập danh sách bác sĩ.');
  }

  return {
    async getProfile(actorUser) {
      if (actorUser.role !== 'provider') {
        throw forbidden('Chỉ đối tác (provider) mới có quyền truy cập hồ sơ cơ sở.');
      }
      if (!actorUser.providerId) {
        throw notFound('Tài khoản đối tác chưa được liên kết với cơ sở nào.');
      }
      const profile = await memberModel.getProviderProfile(actorUser.providerId);
      if (!profile) {
        throw notFound('Không tìm thấy cơ sở đối tác.');
      }
      return profile;
    },

    async updateProfile(actorUser, input = {}) {
      if (actorUser.role !== 'provider') {
        throw forbidden('Chỉ đối tác (provider) mới có quyền cập nhật hồ sơ cơ sở.');
      }
      if (!actorUser.providerId) {
        throw notFound('Tài khoản đối tác chưa được liên kết với cơ sở nào.');
      }

      // Kiểm tra name, area, type không được gửi lên
      if (input.name !== undefined || input.area !== undefined || input.type !== undefined) {
        const errors = {};
        if (input.name !== undefined) errors.name = 'Tên, khu vực và loại hình cơ sở do quản trị viên quản lý.';
        if (input.area !== undefined) errors.area = 'Tên, khu vực và loại hình cơ sở do quản trị viên quản lý.';
        if (input.type !== undefined) errors.type = 'Tên, khu vực và loại hình cơ sở do quản trị viên quản lý.';
        throw validation('Tên, khu vực và loại hình cơ sở do quản trị viên quản lý.', errors);
      }

      // Validate address, phone, description, licenseNo, taxCode TRƯỚC transaction
      const errors = {};
      const fieldsToUpdate = {};

      if ('address' in input) {
        if (input.address === null || String(input.address).trim() === '') {
          fieldsToUpdate.address = null;
        } else {
          const addr = String(input.address).trim();
          if (addr.length > 200) {
            errors.address = 'Địa chỉ cơ sở tối đa 200 ký tự.';
          } else {
            fieldsToUpdate.address = addr;
          }
        }
      }

      if ('phone' in input) {
        if (input.phone === null || String(input.phone).trim() === '') {
          fieldsToUpdate.phone = null;
        } else {
          const normPhone = normalizePhone(input.phone);
          if (!normPhone) {
            errors.phone = 'Số điện thoại Việt Nam gồm 10 số, ví dụ: 0912 345 678.';
          } else {
            fieldsToUpdate.phone = normPhone;
          }
        }
      }

      if ('description' in input) {
        if (input.description === null || String(input.description).trim() === '') {
          fieldsToUpdate.description = null;
        } else {
          const desc = String(input.description).trim();
          if (desc.length > 500) {
            errors.description = 'Mô tả cơ sở tối đa 500 ký tự.';
          } else {
            fieldsToUpdate.description = desc;
          }
        }
      }

      if ('licenseNo' in input) {
        fieldsToUpdate.licenseNo = parseLegalField('licenseNo', input.licenseNo, errors);
      }

      if ('taxCode' in input) {
        fieldsToUpdate.taxCode = parseLegalField('taxCode', input.taxCode, errors);
      }

      if (Object.keys(errors).length > 0) {
        throw validation('Dữ liệu hồ sơ cơ sở chưa hợp lệ.', errors);
      }

      return memberModel.transaction(async (tx) => {
        // Kiểm tra user active
        if (actorUser.status !== 'active') {
          throw forbidden('Chỉ đối tác đang hoạt động (active) mới có quyền cập nhật hồ sơ cơ sở.');
        }

        const provider = await memberModel.getProviderForUpdate(tx, actorUser.providerId);
        if (!provider) {
          throw notFound('Không tìm thấy cơ sở đối tác.');
        }

        if (!provider.isActive) {
          throw forbidden('Cơ sở đối tác đã bị khóa hoặc ngừng hoạt động.');
        }

        if (provider.isSample) {
          throw forbidden('Không thể chỉnh sửa cơ sở dữ liệu mẫu.');
        }

        const merged = {
          address: 'address' in fieldsToUpdate ? fieldsToUpdate.address : provider.address,
          phone: 'phone' in fieldsToUpdate ? fieldsToUpdate.phone : provider.phone,
          description: 'description' in fieldsToUpdate ? fieldsToUpdate.description : provider.description,
          licenseNo: 'licenseNo' in fieldsToUpdate ? fieldsToUpdate.licenseNo : provider.licenseNo,
          taxCode: 'taxCode' in fieldsToUpdate ? fieldsToUpdate.taxCode : provider.taxCode
        };

        // Tìm các trường thật sự thay đổi giá trị
        const diffFields = [];
        for (const k of ['address', 'phone', 'description', 'licenseNo', 'taxCode']) {
          if (k in fieldsToUpdate) {
            const oldVal = provider[k] ?? null;
            const newVal = fieldsToUpdate[k] ?? null;
            if (oldVal !== newVal) {
              diffFields.push(k);
            }
          }
        }

        if (diffFields.length === 0) {
          return {
            id: provider.id,
            name: provider.name,
            area: provider.area,
            type: provider.type,
            address: provider.address,
            phone: provider.phone,
            description: provider.description,
            licenseNo: provider.licenseNo,
            taxCode: provider.taxCode,
            isActive: provider.isActive,
            isSample: provider.isSample,
            updatedAt: provider.updatedAt
          };
        }

        const updatedAt = clock().toISOString();

        await memberModel.updateProviderProfile(tx, actorUser.providerId, merged, updatedAt);

        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'provider_profile_updated',
          targetType: 'provider',
          targetId: actorUser.providerId,
          detail: JSON.stringify({ fields: diffFields })
        });

        return {
          id: provider.id,
          name: provider.name,
          area: provider.area,
          type: provider.type,
          address: merged.address,
          phone: merged.phone,
          description: merged.description,
          licenseNo: merged.licenseNo,
          taxCode: merged.taxCode,
          isActive: provider.isActive,
          isSample: provider.isSample,
          updatedAt
        };
      });
    },

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
      const targetProviderId = resolveVetProviderId(actorUser, query);
      const { page, limit } = parsePagination(query);
      return memberModel.listVets({
        providerId: targetProviderId,
        page,
        limit
      });
    },

    async listVetOptions(actorUser, query = {}) {
      const targetProviderId = resolveVetProviderId(actorUser, query);
      const vets = await memberModel.listVetOptions(targetProviderId);
      return { vets };
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
    },

    // --- Services Management (Session S10) ---
    async listServices(actorUser, query = {}) {
      assertActiveProvider(actorUser);
      const { page, limit } = parsePagination(query);
      const result = await memberModel.listServices({ providerId: actorUser.providerId, page, limit });
      return {
        services: result.services,
        options: getServiceOptions(),
        meta: result.meta
      };
    },

    async createService(actorUser, input = {}) {
      assertActiveProvider(actorUser);

      // Validate input trước khi mở transaction
      const { errors, value } = validateServiceInput(input, false);
      if (Object.keys(errors).length > 0) {
        throw validation('Dữ liệu dịch vụ chưa hợp lệ.', errors);
      }

      const slug = slugifyServiceName(value.name);

      return memberModel.transaction(async (tx) => {
        // Khóa dòng Providers của cơ sở (UPDLOCK, HOLDLOCK) và kiểm IsActive = 1
        const prov = await memberModel.getProviderForUpdate(tx, actorUser.providerId);
        if (!prov) {
          throw notFound('Không tìm thấy cơ sở đối tác.');
        }
        if (prov.isSample) {
          throw forbidden('Dữ liệu mẫu không thuộc ai và không thể tạo dịch vụ.');
        }
        if (!prov.isActive) {
          throw conflict('Cơ sở đang bị khóa hoặc ngưng hoạt động; không thể tạo dịch vụ mới.');
        }

        // Tối đa 50 dịch vụ mỗi cơ sở
        const count = await memberModel.countServices(tx, actorUser.providerId);
        if (count >= SERVICE_LIMITS.maxServicesPerProvider) {
          throw conflict(`Mỗi cơ sở chỉ được tạo tối đa ${SERVICE_LIMITS.maxServicesPerProvider} dịch vụ.`);
        }

        // Kiểm trùng tên dịch vụ trong cùng cơ sở (không phân biệt hoa thường, kể cả dịch vụ ẩn)
        const dupName = await memberModel.findServiceByName(tx, actorUser.providerId, value.name);
        if (dupName) {
          throw conflict('Tên dịch vụ này đã tồn tại trong cơ sở của bạn.', { name: 'Tên dịch vụ đã tồn tại.' }, 'duplicate');
        }

        // Sinh ServiceId duy nhất: <providerId>-<slug-tên> rút gọn để tổng <= 50 ký tự; trùng thì thêm hậu tố số
        let candidateId = '';
        let suffixNum = 1;
        while (true) {
          candidateId = makeServiceCandidateId(actorUser.providerId, slug, suffixNum, 50);
          const exists = await memberModel.serviceIdExists(tx, candidateId);
          if (!exists) break;
          suffixNum++;
        }

        const now = clock();
        const service = {
          id: candidateId,
          providerId: actorUser.providerId,
          category: value.category,
          categoryLabel: value.categoryLabel,
          name: value.name,
          description: value.description || '',
          priceVnd: value.priceVnd,
          unit: value.unit,
          slotCapacity: value.slotCapacity,
          isActive: true,
          isSample: false,
          createdAt: now
        };

        await memberModel.createService(tx, service);

        // AuditLog: action = 'service_created', TargetType = 'service'
        // Detail chỉ chứa id dịch vụ và TÊN các trường đã tạo, không chứa giá/mô tả
        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'service_created',
          targetType: 'service',
          targetId: candidateId,
          detail: JSON.stringify({ serviceId: candidateId, fields: ['name', 'category', 'categoryLabel', 'priceVnd', 'unit', 'slotCapacity', 'description'] })
        });

        return {
          id: service.id,
          providerId: service.providerId,
          category: service.category,
          categoryLabel: service.categoryLabel,
          name: service.name,
          description: service.description,
          priceVnd: service.priceVnd,
          unit: service.unit,
          slotCapacity: service.slotCapacity,
          isActive: service.isActive,
          isSample: service.isSample,
          createdAt: now.toISOString()
        };
      });
    },

    async updateService(actorUser, serviceId, input = {}) {
      assertActiveProvider(actorUser);

      // Validate input trước khi mở transaction (isUpdate = true)
      const { errors, value } = validateServiceInput(input, true);
      if (Object.keys(errors).length > 0) {
        throw validation('Dữ liệu dịch vụ chưa hợp lệ.', errors);
      }

      return memberModel.transaction(async (tx) => {
        // Khóa Providers của cơ sở
        const prov = await memberModel.getProviderForUpdate(tx, actorUser.providerId);
        if (!prov) throw notFound('Không tìm thấy cơ sở đối tác.');
        if (prov.isSample) throw forbidden('Dữ liệu mẫu không thể chỉnh sửa.');
        if (!prov.isActive) {
          throw conflict('Cơ sở đang bị khóa hoặc ngưng hoạt động; không thể chỉnh sửa dịch vụ.');
        }

        // Lấy dịch vụ với UPDLOCK, HOLDLOCK
        const svc = await memberModel.getServiceForUpdate(tx, serviceId);
        if (!svc || svc.providerId !== actorUser.providerId || svc.isSample) {
          throw notFound('Không tìm thấy dịch vụ này.');
        }

        // Kiểm trùng tên nếu có đổi tên
        const newName = value.name !== undefined ? value.name : svc.name;
        if (value.name !== undefined && value.name.toLowerCase() !== svc.name.toLowerCase()) {
          const dupName = await memberModel.findServiceByName(tx, actorUser.providerId, newName, serviceId);
          if (dupName) {
            throw conflict('Tên dịch vụ này đã tồn tại trong cơ sở của bạn.', { name: 'Tên dịch vụ đã tồn tại.' }, 'duplicate');
          }
        }

        // Validate lại category & categoryLabel tương thích
        const newCategory = value.category !== undefined ? value.category : svc.category;
        const catDef = SERVICE_CATEGORIES.find((c) => c.id === newCategory);
        let newLabel = value.categoryLabel !== undefined ? value.categoryLabel : svc.categoryLabel;
        if (value.category !== undefined && value.categoryLabel === undefined) {
          // Nếu đổi category mà không gửi categoryLabel, mặc định nhãn đầu
          newLabel = catDef ? catDef.labels[0] : newLabel;
        } else if (catDef && !catDef.labels.includes(newLabel)) {
          throw validation('Nhãn danh mục không khớp với danh mục đã chọn.', {
            categoryLabel: `Nhãn hợp lệ: ${catDef.labels.join(', ')}.`
          });
        }

        // So sánh từng trường để tìm changedFields thật sự
        const changedFields = [];

        if (value.name !== undefined && value.name !== svc.name) {
          changedFields.push('name');
        }

        const oldDesc = (svc.description || '').trim();
        const newDesc = value.description !== undefined ? value.description.trim() : oldDesc;
        if (value.description !== undefined && newDesc !== oldDesc) {
          changedFields.push('description');
        }

        if (value.category !== undefined && value.category !== svc.category) {
          changedFields.push('category');
        }

        if (newLabel !== svc.categoryLabel) {
          changedFields.push('categoryLabel');
        }

        if (value.priceVnd !== undefined && Number(value.priceVnd) !== Number(svc.priceVnd)) {
          changedFields.push('priceVnd');
        }

        if (value.unit !== undefined && value.unit !== svc.unit) {
          changedFields.push('unit');
        }

        if (value.slotCapacity !== undefined && Number(value.slotCapacity) !== Number(svc.slotCapacity)) {
          changedFields.push('slotCapacity');
        }

        // Khi không có trường nào thay đổi: không gọi updateService, không ghi AuditLog
        if (changedFields.length === 0) {
          return {
            id: svc.id,
            providerId: svc.providerId,
            category: svc.category,
            categoryLabel: svc.categoryLabel,
            name: svc.name,
            description: svc.description,
            priceVnd: svc.priceVnd,
            unit: svc.unit,
            slotCapacity: svc.slotCapacity,
            isActive: svc.isActive,
            isSample: svc.isSample,
            createdAt: svc.createdAt
          };
        }

        const merged = {
          name: newName,
          description: newDesc,
          category: newCategory,
          categoryLabel: newLabel,
          priceVnd: value.priceVnd !== undefined ? Number(value.priceVnd) : svc.priceVnd,
          unit: value.unit !== undefined ? value.unit : svc.unit,
          slotCapacity: value.slotCapacity !== undefined ? Number(value.slotCapacity) : svc.slotCapacity
        };

        await memberModel.updateService(tx, serviceId, merged);

        // AuditLog: action = 'service_updated', TargetType = 'service'
        // Detail chỉ chứa id dịch vụ và TÊN các trường thật sự đổi, không chứa giá/mô tả
        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'service_updated',
          targetType: 'service',
          targetId: serviceId,
          detail: JSON.stringify({ serviceId, changedFields })
        });

        return {
          id: svc.id,
          providerId: svc.providerId,
          ...merged,
          isActive: svc.isActive,
          isSample: svc.isSample,
          createdAt: svc.createdAt
        };
      });
    },

    async disableService(actorUser, serviceId) {
      assertActiveProvider(actorUser);

      return memberModel.transaction(async (tx) => {
        const prov = await memberModel.getProviderForUpdate(tx, actorUser.providerId);
        if (!prov) throw notFound('Không tìm thấy cơ sở đối tác.');
        if (prov.isSample) throw forbidden('Dữ liệu mẫu không thể chỉnh sửa.');
        if (!prov.isActive) {
          throw conflict('Cơ sở đang bị khóa hoặc ngưng hoạt động; không thể chỉnh sửa dịch vụ.');
        }

        const svc = await memberModel.getServiceForUpdate(tx, serviceId);
        if (!svc || svc.providerId !== actorUser.providerId || svc.isSample) {
          throw notFound('Không tìm thấy dịch vụ này.');
        }

        if (!svc.isActive) {
          throw conflict('Dịch vụ này đã ở trạng thái ngưng hoạt động.');
        }

        await memberModel.setServiceActive(tx, serviceId, false);

        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'service_disabled',
          targetType: 'service',
          targetId: serviceId,
          detail: JSON.stringify({ serviceId })
        });

        return { id: serviceId, isActive: false };
      });
    },

    async enableService(actorUser, serviceId) {
      assertActiveProvider(actorUser);

      return memberModel.transaction(async (tx) => {
        const prov = await memberModel.getProviderForUpdate(tx, actorUser.providerId);
        if (!prov) throw notFound('Không tìm thấy cơ sở đối tác.');
        if (prov.isSample) throw forbidden('Dữ liệu mẫu không thể chỉnh sửa.');
        if (!prov.isActive) {
          throw conflict('Cơ sở đang bị khóa hoặc ngưng hoạt động; không thể chỉnh sửa dịch vụ.');
        }

        const svc = await memberModel.getServiceForUpdate(tx, serviceId);
        if (!svc || svc.providerId !== actorUser.providerId || svc.isSample) {
          throw notFound('Không tìm thấy dịch vụ này.');
        }

        if (svc.isActive) {
          throw conflict('Dịch vụ này đã ở trạng thái đang hoạt động.');
        }

        await memberModel.setServiceActive(tx, serviceId, true);

        await adminModel.logAudit(tx, {
          actorUserId: actorUser.id,
          action: 'service_enabled',
          targetType: 'service',
          targetId: serviceId,
          detail: JSON.stringify({ serviceId })
        });

        return { id: serviceId, isActive: true };
      });
    }
  };
}

module.exports = { createProviderService, generateTempPassword, slugifyServiceName, makeServiceCandidateId };
