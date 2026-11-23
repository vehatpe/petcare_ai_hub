'use strict';
const { isValidYmd } = require('./time');
const { SPECIES_IDS } = require('./species');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(?:\+?84|0)(?:3|5|7|8|9)\d{8}$/;
const PROVIDER_TYPES = ['clinic', 'spa', 'hotel', 'emergency'];
const SPECIES = SPECIES_IDS;
const SEX = ['male', 'female'];
const NEUTERED = ['yes', 'no', 'unknown'];
const TIME_SLOTS = ['08:30', '09:30', '10:30', '14:00', '15:30', '16:30', '18:00', '19:30'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LICENSE_RE = /^[A-Za-z0-9\s/.\-]+$/;
const PHOTO_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTO_BYTES = 400 * 1024;

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function normalizePhone(raw) {
  const compact = str(raw).replace(/[\s.\-()]/g, '');
  if (!PHONE_RE.test(compact)) return null;
  return compact.replace(/^\+?84/, '0');
}

function parseLegalField(fieldName, val, errors) {
  if (val === undefined) return undefined;
  if (val === null) return null;
  const raw = str(val).trim();
  if (raw === '') return null;

  if (fieldName === 'licenseNo') {
    if (raw.length > 50) {
      errors.licenseNo = 'Số giấy phép hành nghề tối đa 50 ký tự.';
      return null;
    }
    if (!LICENSE_RE.test(raw)) {
      errors.licenseNo = 'Số giấy phép chỉ gồm chữ, số, khoảng trắng và các ký tự / - .';
      return null;
    }
    return raw;
  }

  if (fieldName === 'taxCode') {
    const compactTax = raw.replace(/[\s\-]/g, '');
    if (!/^\d{10}$|^\d{13}$/.test(compactTax)) {
      errors.taxCode = 'Mã số thuế phải gồm 10 hoặc 13 chữ số.';
      return null;
    }
    return compactTax;
  }

  return raw;
}

function parseLegalInfo(input, errors) {
  const licenseNo = parseLegalField('licenseNo', input.licenseNo, errors) ?? null;
  const taxCode = parseLegalField('taxCode', input.taxCode, errors) ?? null;
  return { licenseNo, taxCode };
}

function passwordOk(v) {
  const s = str(v);
  return s.length >= 8 && /[A-Za-zÀ-ỹ]/.test(s) && /\d/.test(s);
}

function validateRegister(input) {
  const role = input.role;
  const value = {
    role,
    fullName: str(input.fullName).trim().replace(/\s+/g, ' '),
    email: str(input.email).trim().toLowerCase(),
    phone: normalizePhone(input.phone),
    password: str(input.password),
    orgName: str(input.orgName).trim(),
    orgType: str(input.orgType),
    orgArea: str(input.orgArea).trim(),
    licenseNo: null,
    taxCode: null
  };
  const errors = {};
  if (role !== 'customer' && role !== 'provider') errors.role = 'Chỉ có thể đăng ký tài khoản chủ nuôi hoặc đối tác. Tài khoản bác sĩ/quản trị do hệ thống cấp.';
  if (value.fullName.length < 2) errors.fullName = 'Vui lòng nhập họ và tên (ít nhất 2 ký tự).';
  else if (value.fullName.length > 100) errors.fullName = 'Họ và tên tối đa 100 ký tự.';
  if (!EMAIL_RE.test(value.email) || value.email.length > 254) errors.email = 'Email chưa đúng định dạng, ví dụ: ten@gmail.com.';
  if (!value.phone) errors.phone = 'Số điện thoại Việt Nam gồm 10 số, ví dụ: 0912 345 678.';
  if (!passwordOk(value.password) || value.password.length > 72) errors.password = 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số (tối đa 72 ký tự).';

  if (role === 'provider') {
    if (value.orgName.length < 2) errors.orgName = 'Vui lòng nhập tên cơ sở.';
    else if (value.orgName.length > 150) errors.orgName = 'Tên cơ sở tối đa 150 ký tự.';
    if (!PROVIDER_TYPES.includes(value.orgType)) errors.orgType = 'Vui lòng chọn loại hình cơ sở.';
    if (!value.orgArea) errors.orgArea = 'Vui lòng nhập khu vực hoạt động của cơ sở.';
    else if (value.orgArea.length > 100) errors.orgArea = 'Khu vực tối đa 100 ký tự.';

    const legal = parseLegalInfo(input, errors);
    value.licenseNo = legal.licenseNo;
    value.taxCode = legal.taxCode;
  } else {
    if (input.licenseNo !== undefined && input.licenseNo !== null && str(input.licenseNo).trim() !== '') {
      errors.licenseNo = 'Thông tin pháp lý chỉ áp dụng cho tài khoản đối tác.';
    }
    if (input.taxCode !== undefined && input.taxCode !== null && str(input.taxCode).trim() !== '') {
      errors.taxCode = 'Mã số thuế chỉ áp dụng cho tài khoản đối tác.';
    }
  }
  return { errors, value };
}

function validateVetInput(input) {
  const value = {
    fullName: str(input.fullName).trim().replace(/\s+/g, ' '),
    email: str(input.email).trim().toLowerCase(),
    phone: normalizePhone(input.phone)
  };
  const errors = {};
  if (value.fullName.length < 2) errors.fullName = 'Vui lòng nhập họ và tên bác sĩ (ít nhất 2 ký tự).';
  else if (value.fullName.length > 100) errors.fullName = 'Họ và tên bác sĩ tối đa 100 ký tự.';
  if (!EMAIL_RE.test(value.email) || value.email.length > 254) errors.email = 'Email chưa đúng định dạng, ví dụ: bacsi@clinic.vn.';
  if (!value.phone) errors.phone = 'Số điện thoại Việt Nam gồm 10 số, ví dụ: 0912 345 678.';
  return { errors, value };
}

function validateChangePassword(input) {
  const currentPassword = str(input.currentPassword);
  const newPassword = str(input.newPassword);
  const errors = {};
  if (!currentPassword) errors.currentPassword = 'Vui lòng nhập mật khẩu hiện tại.';
  if (!newPassword) errors.newPassword = 'Vui lòng nhập mật khẩu mới.';
  else if (!passwordOk(newPassword) || newPassword.length > 72) {
    errors.newPassword = 'Mật khẩu mới cần ít nhất 8 ký tự, gồm cả chữ và số (tối đa 72 ký tự).';
  } else if (currentPassword === newPassword) {
    errors.newPassword = 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  }
  return { errors, value: { currentPassword, newPassword } };
}

function parseWeight(raw, errors, key = 'weightKg') {
  if (raw === undefined || raw === null || raw === '') return null;
  const w = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(w) || w < 0.005 || w > 150) {
    errors[key] = 'Cân nặng cần trong khoảng 0,005 – 150 kg.';
    return null;
  }
  return Math.round(w * 1000) / 1000;
}

/** hasPhoto tells whether the key was present (PUT keeps the stored photo when absent). */
function validatePet(input, today) {
  const errors = {};
  const name = str(input.name).trim();
  if (!name) errors.name = 'Vui lòng nhập tên của bé.';
  else if (name.length > 40) errors.name = 'Tên tối đa 40 ký tự.';
  if (!SPECIES.includes(input.species)) errors.species = 'Vui lòng chọn loài.';
  if (!SEX.includes(input.sex)) errors.sex = 'Vui lòng chọn giới tính.';

  const birthDate = str(input.birthDate);
  if (!birthDate) errors.birthDate = 'Vui lòng chọn ngày sinh. Nếu không nhớ chính xác, hãy chọn ngày gần đúng.';
  else if (!isValidYmd(birthDate)) errors.birthDate = 'Ngày sinh chưa hợp lệ.';
  else if (birthDate > today) errors.birthDate = 'Ngày sinh không thể ở tương lai.';
  else if (birthDate < '1995-01-01') errors.birthDate = 'Ngày sinh quá xa, vui lòng kiểm tra lại.';

  const weightKg = parseWeight(input.weightKg, errors);
  const microchip = str(input.microchip).trim();
  if (microchip && !/^\d{15}$/.test(microchip)) errors.microchip = 'Mã microchip gồm đúng 15 chữ số.';
  const conditions = str(input.conditions).trim();
  if (conditions.length > 500) errors.conditions = 'Ghi chú sức khỏe tối đa 500 ký tự.';
  const breed = str(input.breed).trim();
  if (breed.length > 80) errors.breed = 'Giống tối đa 80 ký tự.';
  const color = str(input.color).trim();
  if (color.length > 50) errors.color = 'Màu lông tối đa 50 ký tự.';

  const hasPhoto = Object.prototype.hasOwnProperty.call(input, 'photo');
  let photo = null;
  if (hasPhoto && input.photo) {
    if (typeof input.photo !== 'string' || !PHOTO_RE.test(input.photo)) errors.photo = 'Ảnh cần là tệp PNG, JPEG, WEBP hoặc GIF.';
    else if (Buffer.byteLength(input.photo) > MAX_PHOTO_BYTES) errors.photo = 'Ảnh tối đa 400 KB. Hãy chọn ảnh nhỏ hơn.';
    else photo = input.photo;
  }
  return {
    errors,
    hasPhoto,
    value: {
      name, species: input.species, breed, sex: input.sex, birthDate, weightKg, color,
      neutered: NEUTERED.includes(input.neutered) ? input.neutered : 'unknown', microchip, conditions, photo
    }
  };
}

function validateWeight(input, today) {
  const errors = {};
  if (input.weightKg === undefined || input.weightKg === null || input.weightKg === '') errors.weightKg = 'Vui lòng nhập cân nặng.';
  const weightKg = parseWeight(input.weightKg, errors);
  let measuredOn = today;
  if (input.measuredOn !== undefined && input.measuredOn !== null && input.measuredOn !== '') {
    measuredOn = str(input.measuredOn);
    if (!isValidYmd(measuredOn)) errors.measuredOn = 'Ngày đo chưa hợp lệ.';
    else if (measuredOn > today) errors.measuredOn = 'Ngày đo không thể ở tương lai.';
  }
  return { errors, value: { weightKg, measuredOn } };
}

function validateVaccination(input, today) {
  const errors = {};
  const vaccineName = str(input.vaccineName).trim();
  if (!vaccineName) errors.vaccineName = 'Vui lòng nhập tên vắc-xin.';
  else if (vaccineName.length > 80) errors.vaccineName = 'Tên vắc-xin tối đa 80 ký tự.';
  const administeredOn = str(input.administeredOn);
  if (!isValidYmd(administeredOn)) errors.administeredOn = 'Vui lòng chọn ngày tiêm hợp lệ.';
  else if (administeredOn > today) errors.administeredOn = 'Ngày tiêm không thể ở tương lai.';
  let nextDueOn = null;
  if (input.nextDueOn !== undefined && input.nextDueOn !== null && input.nextDueOn !== '') {
    nextDueOn = str(input.nextDueOn);
    if (!isValidYmd(nextDueOn)) errors.nextDueOn = 'Ngày tiêm nhắc lại chưa hợp lệ.';
    else if (!errors.administeredOn && nextDueOn < administeredOn) errors.nextDueOn = 'Ngày nhắc lại không thể trước ngày tiêm.';
  }
  const providerName = str(input.providerName).trim();
  if (providerName.length > 120) errors.providerName = 'Tên cơ sở tối đa 120 ký tự.';
  const batchNo = str(input.batchNo).trim();
  if (batchNo.length > 40) errors.batchNo = 'Số lô tối đa 40 ký tự.';
  return { errors, value: { vaccineName, administeredOn, nextDueOn, providerName, batchNo } };
}

function validateMedicalRecord(input, today) {
  const errors = {};
  const visitDate = str(input.visitDate);
  if (!isValidYmd(visitDate)) errors.visitDate = 'Vui lòng chọn ngày khám hợp lệ.';
  else if (visitDate > today) errors.visitDate = 'Ngày khám không thể ở tương lai.';
  const labels = { subjective: 'Triệu chứng chủ nuôi mô tả (S)', objective: 'Khám lâm sàng (O)', assessment: 'Đánh giá (A)', plan: 'Kế hoạch (P)' };
  const value = { visitDate };
  for (const k of Object.keys(labels)) {
    value[k] = str(input[k]).trim();
    if (!value[k]) errors[k] = `Vui lòng nhập: ${labels[k]}.`;
    else if (value[k].length > 2000) errors[k] = 'Tối đa 2000 ký tự.';
  }
  if (input.bookingId !== undefined && input.bookingId !== null && input.bookingId !== '') {
    if (!isUuid(input.bookingId)) errors.bookingId = 'Mã lịch hẹn không hợp lệ.';
    else value.bookingId = input.bookingId.toLowerCase();
  }
  return { errors, value };
}

function validateBooking(input, now) {
  const errors = {};
  const petId = str(input.petId);
  if (!isUuid(petId)) errors.petId = 'Vui lòng chọn thú cưng.';
  const serviceId = str(input.serviceId).trim();
  if (!serviceId) errors.serviceId = 'Vui lòng chọn dịch vụ.';
  const date = str(input.date);
  if (!isValidYmd(date)) errors.date = 'Vui lòng chọn ngày hẹn hợp lệ.';
  else if (date < now.date) errors.date = 'Không thể đặt lịch cho ngày đã qua.';
  const time = str(input.time);
  if (!TIME_SLOTS.includes(time)) errors.time = 'Vui lòng chọn một khung giờ có sẵn.';
  else if (!errors.date && date === now.date && time <= now.time) errors.time = 'Khung giờ này đã qua. Vui lòng chọn giờ khác.';
  const notes = str(input.notes).trim();
  if (notes.length > 500) errors.notes = 'Ghi chú tối đa 500 ký tự.';
  return { errors, value: { petId: petId.toLowerCase(), serviceId, date, time, notes } };
}

module.exports = {
  EMAIL_RE, TIME_SLOTS, PROVIDER_TYPES, isUuid, normalizePhone, parseLegalInfo, parseLegalField, validateRegister, validateVetInput, validateChangePassword, validatePet,
  validateWeight, validateVaccination, validateMedicalRecord, validateBooking
};
