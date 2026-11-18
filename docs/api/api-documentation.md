# PetCare AI Hub – API v1 (hợp đồng giữa frontend và backend)

Base URL: `/api/v1`. Backend (Express) phục vụ cả thư mục `frontend/` ở cùng origin khi `SERVE_FRONTEND=true`.

## Quy ước chung
- Mọi phản hồi: `{ "success": boolean, "data": any, "message": string }`.
- Lỗi: `{ "success": false, "data": null, "message": "<tiếng Việt, nói rõ cách khắc phục>", "code": "<mã>", "errors": { "<field>": "<thông báo>" } }` (`code`, `errors` chỉ có khi liên quan).
- Xác thực: header `Authorization: Bearer <jwt>` (HS256). Token do `/auth/login` và `/auth/register` (khách hàng) trả về.
- Mọi bản ghi của chủ nuôi chỉ truy cập được bởi chính chủ (`UserId` lấy từ token, không bao giờ từ body). Sai chủ → `404` (không lộ sự tồn tại).
- Ngày: `YYYY-MM-DD`. Giờ: `HH:mm`. Thời điểm: ISO-8601 UTC. Tiền: số nguyên VND.
- Mã trạng thái: 200, 201, 400 (JSON hỏng), 401 (`unauthenticated`/`credentials`), 403 (`forbidden`/`pending`/`disabled`), 404, 409 (`duplicate`/`conflict`), 422 (`validation`), 429, 500, 503 (`ai_unavailable`).

## Đối tượng
```
User     { id, role: "customer"|"provider"|"vet"|"admin", status: "active"|"pending"|"disabled"|"rejected",
           fullName, email, phone, providerId?, mustChangePassword?, orgName?, orgType?, createdAt }
Provider { id, name, area, type: "clinic"|"spa"|"hotel"|"emergency", isSample }
Service  { id, category: "medical"|"grooming"|"hotel"|"emergency", categoryLabel, providerId, providerName,
           providerArea, name, description, priceVnd, unit, isSample }
Pet      { id, name, species: "dog"|"cat"|"rabbit"|"hamster"|"bird"|"fish"|"reptile"|"other", breed, sex: "male"|"female", birthDate, weightKg|null,
           color, neutered: "yes"|"no"|"unknown", microchip, conditions, photo|null, createdAt, updatedAt }
           // weightKg = số đo mới nhất trong Health_Metrics, null nếu chưa có.
Booking  { id, petId, petName, serviceId, serviceName, providerName, priceVnd, date, time, notes,
           status: "pending"|"confirmed"|"completed"|"cancelled", createdAt }
```

## Giám sát & Sức khỏe hệ thống
| Method | Path | Xác thực | Kết quả |
|---|---|---|---|
| GET | `/health` | Không yêu cầu | 200 `{status: "ok", database: "connected"}` khi hệ thống và kết nối CSDL bình thường; 503 `{status: "down", database: "disconnected"}` khi mất kết nối CSDL (không lộ chi tiết lỗi nội bộ). |

## Giới hạn tốc độ (Rate Limiting)
Khi vượt quá hạn mức yêu cầu trong cửa sổ thời gian (mặc định 15 phút), API phản hồi mã `429` với cấu trúc:
```json
{
  "success": false,
  "data": null,
  "code": "rate_limited",
  "message": "Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại."
}
```
Các tầng rate limiter được tách riêng:
- **Auth (`/auth/register`, `/auth/login`)**: Khóa theo cặp `IP` + `identifier` (email hoặc số điện thoại đã chuẩn hóa chữ thường).
- **Session verification (`/auth/me`)**: Hạn mức rộng (mặc định 300 lượt / 15 phút / IP) cho phép client kiểm tra phiên khi chuyển trang.
- **AI Chat (`/ai/chat`)**: Khóa theo `UserId` đã xác thực (mặc định 20 lượt / 15 phút / tài khoản), ngăn chặn lạm dụng hạn ngạch Gemini API.
- **Đổi mật khẩu (`/auth/change-password`)**: Khóa theo `UserId` đã xác thực (hoặc IP), chống tấn công dò mật khẩu cũ brute-force.

## Auth
| Method | Path | Body | Kết quả |
|---|---|---|---|
| POST | `/auth/register` | `{role:"customer"|"provider", fullName, email, phone, password, orgName?, orgType?}` | 201 `{user, token}` (customer) hoặc `{user, token:null}` (provider, status `pending`). vet/admin không tự đăng ký (role khác → 422). |
| POST | `/auth/login` | `{identifier, password, remember?}` | 200 `{user, token}`; `credentials` 401 (thông báo chung), `pending` 403, `disabled` 403. Phản hồi kèm `providerId` và `mustChangePassword`. |
| GET | `/auth/me` | – | 200 `{user}`; 401 nếu token sai/hết hạn. Phản hồi kèm `providerId` và `mustChangePassword`. |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | 200 `{user}`; yêu cầu đăng nhập. Mật khẩu mới thỏa mãn độ phức tạp (≥ 8 ký tự, có chữ và số, tối đa 72 ký tự) và phải khác mật khẩu hiện tại (trùng → 422). Sai mật khẩu cũ → 422 kèm `errors.currentPassword`. Sau khi đổi thành công, `MustChangePassword = 0`. |

Validation giống frontend: email hợp lệ; SĐT VN `^(?:\+?84|0)(?:3|5|7|8|9)\d{8}$` (chuẩn hóa về `0xxxxxxxxx`); mật khẩu ≥ 8 ký tự gồm chữ và số; provider cần `orgName` ≥ 2 ký tự, `orgType` ∈ clinic|spa|hotel|emergency. Email/SĐT trùng → 409 `duplicate` kèm `errors.email`/`errors.phone`.
Mật khẩu băm bằng bcrypt (cost ≥ 10). Giới hạn tốc độ cho `/auth/*`.

### Cổng `must_change_password`
Khi tài khoản có cờ `mustChangePassword: true` (đặc biệt là bác sĩ mới tạo với mật khẩu tạm):
- Mọi route yêu cầu xác thực sẽ bị chặn với mã trạng thái `403` và mã lỗi `must_change_password`:
  ```json
  {
    "success": false,
    "data": null,
    "code": "must_change_password",
    "message": "Bạn phải đổi mật khẩu lần đầu trước khi tiếp tục sử dụng hệ thống."
  }
  ```
- **Ngoại lệ:** Chỉ `GET /api/v1/auth/me` và `POST /api/v1/auth/change-password` được phép đi qua.
- **Lưu ý bảo mật JWT:** JWT cũ đã cấp vẫn có hiệu lực cho đến khi hết hạn (token không trạng thái). Trạng thái `MustChangePassword` được xác thực trực tiếp tại tầng middleware mỗi lượt gọi API, và token cũ sẽ không còn bị chặn một khi cờ trong DB được gỡ về 0. Cân nhắc thu hồi phiên chủ động khi triển khai refresh token trong các giai đoạn sau.

## Quản trị hệ thống (Admin)
Mọi endpoint yêu cầu xác thực (`Authorization: Bearer <jwt>`) và tài khoản có role `admin`. Không bao giờ trả `PasswordHash`.

| Method | Path | Query / Body | Kết quả & Quy tắc |
|---|---|---|---|
| GET | `/admin/users?status=&role=&limit=&offset=` | Query: `status` (active/pending/disabled/rejected), `role` (customer/provider/vet/admin), `limit` (mặc định 20, tối đa 50), `offset` (mặc định 0). | 200 `{ users: User[], meta: { limit, offset, total } }`. Không rò rỉ trường nhạy cảm (`passwordHash`). |
| POST | `/admin/users/:id/approve` | Body: `{ area? }` (bắt buộc nếu tài khoản provider chưa có `orgArea`). | 200 `{ id, role, status: "active", providerId, orgArea, approvedBy, approvedAt }`. Chạy trong 1 transaction: tạo dòng `Providers` (slug từ `orgName` duy nhất ≤ 50 ký tự, `isActive=1`), cập nhật `Users.ProviderId`, `Status='active'`, `ApprovedBy/At`, ghi `AuditLog`. Chỉ áp dụng cho `provider` `pending` (duyệt lặp → 409 `conflict`, thiếu area → 422 `validation`). |
| POST | `/admin/users/:id/reject` | Body: `{ reason }` (bắt buộc, tối đa 200 ký tự). | 200 `{ id, status: "rejected", rejectReason }`. Chỉ áp dụng cho user `pending` (không áp dụng cho `admin`). Ghi `AuditLog`. Từ chối là kết thúc vòng đời. |
| POST | `/admin/users/:id/disable` | – | 200 `{ id, status: "disabled" }`. Chỉ áp dụng cho tài khoản `active`. Khóa `provider` sẽ cùng transaction khóa toàn bộ `vet` thuộc cơ sở đó và đặt `Providers.IsActive = 0`. Ràng buộc: Admin không tự khóa mình (403); không được khóa Admin `active` cuối cùng (403). Ghi `AuditLog`. |
| POST | `/admin/users/:id/enable` | – | 200 `{ id, status: "active" }`. Chỉ áp dụng cho tài khoản `disabled`. Mở khóa `provider` chỉ khôi phục provider và đặt `Providers.IsActive = 1` (các `vet` vẫn disabled, cần mở khóa riêng). Ghi `AuditLog`. |

## Quản lý Bác sĩ Cơ sở (Provider & Admin)
Mọi endpoint yêu cầu xác thực (`Authorization: Bearer <jwt>`) và tài khoản có role `provider` (đang `active`) hoặc `admin`.

| Method | Path | Query / Body | Kết quả & Quy tắc |
|---|---|---|---|
| POST | `/provider/vets` | Body: `{ fullName, email, phone, providerId? }` | 201 `{ vet: User, tempPassword }`. Header kèm `Cache-Control: no-store`. Provider chỉ được tạo vet cho chính cơ sở của mình (`ProviderId` lấy từ tài khoản người gọi). Admin bắt buộc truyền `providerId` (cơ sở phải tồn tại và `IsActive = 1`, nếu không → 404/422). Mật khẩu tạm sinh ngẫu nhiên (≥ 12 ký tự, đủ hoa/thường/số) và chỉ trả **duy nhất một lần** trong phản hồi; không bao giờ lưu trữ dạng thô hoặc ghi log/AuditLog. Cờ `MustChangePassword = 1`. Trùng email/phone → 409 `duplicate` có `errors.email`/`errors.phone`. Ghi AuditLog `vet_created`. |
| GET | `/provider/vets` | Query: `limit`, `offset`, `providerId?` (chỉ dành cho admin) | 200 `{ vets: User[], meta: { limit, offset, total } }`. Chỉ trả danh sách bác sĩ thuộc cơ sở của provider gọi API (hoặc cơ sở do admin chỉ định). Tuyệt đối không trả `passwordHash` hay mật khẩu tạm. |
| POST | `/provider/vets/:id/disable` | – | 200 `{ id, status: "disabled" }`. Chỉ áp dụng cho vet thuộc chính cơ sở của người gọi (vet thuộc cơ sở khác trả 404 để không lộ sự tồn tại). Vet phải đang ở trạng thái `active`. Ghi AuditLog `disable_vet`. |
| POST | `/provider/vets/:id/enable` | – | 200 `{ id, status: "active" }`. Chỉ áp dụng cho vet thuộc chính cơ sở của người gọi (vet thuộc cơ sở khác trả 404). Chỉ được mở khóa khi cơ sở của vet đang hoạt động (`Providers.IsActive = 1`), nếu cơ sở bị khóa → 409 conflict. Ghi AuditLog `enable_vet`. |

## Danh mục (công khai, không cần token)
| Method | Path | Ghi chú |
|---|---|---|
| GET | `/providers` | `Provider[]` đang hoạt động |
| GET | `/services?category=&providerId=&q=` | `Service[]` đang hoạt động |
| GET | `/services/:id` | `Service` |
| GET | `/services/:id/slots?date=YYYY-MM-DD` | `[{time, available}]`. Khung giờ cố định: 08:30 09:30 10:30 14:00 15:30 16:30 18:00 19:30. `available=false` khi đủ `SlotCapacity` lịch chưa hủy, hoặc giờ đã qua (ngày hôm nay, múi giờ `APP_TIMEZONE`). Ngày quá khứ → 422. |

`isSample=true` nghĩa là dữ liệu minh họa do seed; frontend phải gắn nhãn "minh họa" dựa trên cờ này, không hard-code.

## Thú cưng (customer)
| Method | Path | Body / Kết quả |
|---|---|---|
| GET | `/pets` | `Pet[]` của chủ, cũ → mới |
| POST | `/pets` | body: name, species, breed?, sex, birthDate, weightKg?, color?, neutered?, microchip?, conditions?, photo? (data URL ≤ 400 KB). 201 `Pet`. Tối đa 10 thú/chủ → 409 `conflict`. Có `weightKg` → tạo thêm 1 dòng Health_Metrics hôm nay. |
| GET | `/pets/:id` | `Pet` |
| PUT | `/pets/:id` | cùng body; `weightKg` khác số đo mới nhất → thêm dòng Health_Metrics hôm nay |
| DELETE | `/pets/:id` | 200 `{deleted:true}`. Xóa kèm cân nặng/tiêm chủng/bệnh án của bé; lịch hẹn giữ lại (PetName lưu trên Booking). |

Validation: name 1–40; species/sex thuộc tập; birthDate hợp lệ, không ở tương lai, ≥ 1995-01-01; weightKg 0,005–150 kg (làm tròn 3 chữ số; thú nhỏ như hamster 0,045 kg hợp lệ, ngoài khoảng → 422 `weightKg`: "Cân nặng cần trong khoảng 0,005 – 150 kg."); species ngoài 8 giá trị trên → 422 `species`: "Vui lòng chọn loài."; microchip đúng 15 chữ số nếu có; conditions ≤ 500.

## Sổ sức khỏe (customer, chủ của bé)
| Method | Path | Ghi chú |
|---|---|---|
| GET | `/health-records?petId=` | Tổng hợp (xem dưới) |
| POST | `/pets/:id/weights` | `{weightKg, measuredOn?}` (mặc định hôm nay; không ở tương lai) → 201 `WeightPoint` |
| DELETE | `/pets/:id/weights/:metricId` | xóa số đo nhập nhầm |
| POST | `/pets/:id/vaccinations` | `{vaccineName, administeredOn, nextDueOn?, providerName?, batchNo?}` → 201. Bản ghi do chủ nuôi nhập có `source:"owner"` (chưa được cơ sở xác nhận). |
| DELETE | `/pets/:id/vaccinations/:vaccinationId` | chỉ xóa được bản ghi `source:"owner"` |
| POST | `/pets/:id/medical-records` | chỉ role `vet`/`admin`; `{visitDate, subjective, objective, assessment, plan, bookingId?}` |

Tổng hợp `GET /health-records?petId=`:
```
{ pet:{id,name},
  weights:[{id, weightKg, measuredOn}],            // tăng dần theo ngày
  weightChart:{ count, canRender },                // canRender = count >= 2 (nếu false frontend hiển thị empty state)
  vaccinations:[{id, vaccineName, administeredOn, nextDueOn|null, providerName, batchNo, source:"owner"|"clinic",
                 status:"ok"|"due-soon"|"overdue"|"recorded"}],   // status tính ở server theo ngày hiện tại
  vaccineSummary:{ total, upToDate, dueSoon, overdue, nextDue:{vaccineName, dueOn}|null },
  medicalRecords:[{id, visitDate, vetName|null, subjective, objective, assessment, plan}] }  // mới → cũ
```
Quy tắc trạng thái tiêm: với mỗi `vaccineName` chỉ tính mũi có `administeredOn` mới nhất. `nextDueOn` null → `recorded`; `< hôm nay` → `overdue`; trong 30 ngày tới → `due-soon`; còn lại `ok`. `vaccineSummary` đếm trên các mũi mới nhất đó; `total` = số loại vắc-xin; không có dữ liệu thì mọi số bằng 0 và `nextDue:null`. Server **không** trả cờ kiểu "sổ tiêm hợp lệ" nào ngoài các số tính được.

## Lịch hẹn (customer)
| Method | Path | Ghi chú |
|---|---|---|
| GET | `/bookings` | `Booking[]` của chủ, sắp theo ngày+giờ |
| POST | `/bookings` | `{petId, serviceId, date, time, notes?}` → 201 `Booking` status `pending`. Kiểm tra: bé thuộc chủ; dịch vụ còn hoạt động; ngày không ở quá khứ; `time` thuộc khung giờ; còn chỗ (`SlotCapacity`); bé không trùng giờ → 409 `conflict` với `errors.time`. |
| PATCH | `/bookings/:id/cancel` | → `Booking` status `cancelled`; đã hủy/hoàn tất → 409 |

## Dashboard (customer) – mọi số được tính từ DB
`GET /dashboard/customer` →
```
{ petCount,
  bookings:{ total, upcomingCount, next:Booking|null },     // upcoming = chưa hủy, ngày+giờ >= hiện tại
  vaccines:{ dueSoonCount, overdueCount, nextDue:{petId, petName, vaccineName, dueOn}|null } }
```

## Trợ lý AI (customer)
`POST /ai/chat` `{message (1–1000 ký tự), petId?}` →
```
200 { text, disclaimer, sources:[{title}], grounded:boolean }
```
- RAG: nhúng câu hỏi bằng Gemini embeddings, lấy top-K từ `Knowledge_Chunks` theo cosine; nếu điểm cao nhất < `RAG_MIN_SCORE` → `grounded:false` và câu trả lời nói rõ chưa có tài liệu phù hợp, khuyên hỏi bác sĩ (không để mô hình tự bịa).
- Ngữ cảnh bé (loài, giống, tuổi, cân nặng mới nhất, lưu ý sức khỏe) lấy từ DB theo `petId` của chính chủ.
- `disclaimer` luôn do server gắn: "AI chỉ đóng vai trò tư vấn & sàng lọc ban đầu, không thay thế chẩn đoán lâm sàng của Bác sĩ thú y chuyên môn."
- Thiếu `GEMINI_API_KEY`, chưa có chunk nào, hoặc Gemini lỗi → 503 `ai_unavailable` với thông báo thật. Tuyệt đối không trả câu trả lời giả lập.
- `sources` chỉ gồm tiêu đề tài liệu thật trong `Knowledge_Chunks`.

## Ghi chú triển khai
Các điểm hợp đồng chưa nói rõ; backend chọn cách hiểu đơn giản nhất như sau.
- **Booking** có thêm trường `code` (mã hiển thị `BK-XXXXXXXX`); `id` là GUID chữ thường.
- **Sức chứa khung giờ** (`SlotCapacity`) là cột của bảng `Services` (mặc định 3), tính theo dịch vụ + ngày + giờ; không lộ ra API.
- **Đặt lịch**: bé/dịch vụ không tồn tại (hoặc không thuộc chủ) → `404`; giờ đã qua trong ngày hôm nay → `422 errors.time`; trùng giờ của cùng bé được kiểm tra trước, rồi mới đến hết chỗ; cả hai trả `409 conflict` với `errors.time`. `providerName` của Booking có dạng `"Tên cơ sở (Khu vực)"`.
- **Hủy lịch**: chỉ `pending`/`confirmed` hủy được; `cancelled`/`completed` → `409`.
- **`GET /health-records`** bắt buộc `petId` hợp lệ (thiếu/sai định dạng → `422`).
- **Tiêm chủng**: danh sách trả mọi mũi; chỉ mũi mới nhất của mỗi `vaccineName` (không phân biệt hoa thường/khoảng trắng) được đánh giá, các mũi cũ có `status:"recorded"`. `upToDate` = số vắc-xin có status `ok`. `nextDue` = `nextDueOn` sớm nhất trong các mũi mới nhất có `nextDueOn` (kể cả đã quá hạn). Dashboard đánh giá theo từng bé rồi cộng dồn.
- **Dashboard**: `bookings.total` = mọi lịch của chủ (kể cả đã hủy); `upcomingCount`/`next` chỉ tính `pending`/`confirmed` có ngày+giờ ≥ hiện tại (múi giờ `APP_TIMEZONE`).
- **`PUT /pets/:id`** thay toàn bộ trường; riêng `photo`: vắng mặt → giữ ảnh cũ, `null` → xóa ảnh. `GET /pets` trả cả ảnh (tối đa 10 × 400 KB).
- **Bệnh án**: vet/admin ghi được cho bất kỳ bé nào (chưa có khái niệm bác sĩ phụ trách bé); `bookingId` nếu có phải là lịch của chính bé đó (`422 errors.bookingId`).
- **Mã bổ sung**: `413 too_large` khi body > 600 KB; `400 bad_json`; `404 not_found` cho đường dẫn lạ; `429 rate_limited`; `403 disabled` khi token hợp lệ nhưng tài khoản bị khóa.
- **AI**: tài liệu có `ReviewStatus='rejected'` không bao giờ được dùng; `RAG_REQUIRE_APPROVED=true` chỉ dùng tài liệu đã `approved`. Nguồn hiển thị chỉ là tiêu đề tài liệu.
- Token: HS256, hết hạn 1 ngày (30 ngày nếu `remember`). Vắc-xin `source:"clinic"` chưa có API tạo (chờ luồng cơ sở xác nhận); hiện chỉ chủ nuôi nhập `owner`.
