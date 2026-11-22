# PetCare AI Hub — Project Status

> **Tệp này là bộ nhớ làm việc của dự án.** Mọi AI làm việc trên repo này phải đọc nó **trước khi sửa bất cứ thứ gì**, và phải cập nhật nó **sau mỗi lần sửa/đổi dự án** (xem mục 9).
> Nguồn chuẩn về quy trình và nguyên tắc: *Master Prompt Phát triển PetCare AI Hub (v2)*. Khi tệp này mâu thuẫn với mã nguồn, **mã nguồn là sự thật**; sửa tệp này cho đúng.

- **Cập nhật lần cuối:** 2026-11-19
- **Nhánh làm việc:** `giai-doan-c1`
- **Giai đoạn hiện tại:** **C1 — Session 8/9 (test vòng đời vai trò trên DB giả + kiểm thử thật smoke-roles trên SQL Server 2022) hoàn thành**.
- **Việc kế tiếp (một đề xuất duy nhất):** S9/9 (S7b): Rà soát bảo mật toàn diện C1, cập nhật CI chạy smoke-roles trên SQL Server, đóng nhánh `giai-doan-c1` và mở PR vào `main`.

## Đang làm
không có

---

## 1. Tóm tắt một dòng

Nền tảng (A), bảo mật nhanh (B) đã **gộp vào main**. B+ (sửa 7 nhóm lỗi tìm thấy khi chạy thật, CI tích hợp smoke test trên SQL Server) đã **hoàn thành toàn diện, kiểm chứng trên cả DB giả (114 tests) và SQL Server 2022 thật (25/25 smoke tests pass, migrate idempotent)**, đã gộp vào `main`. Giai đoạn C1 đã hoàn thành S3, S4, S5 và bổ sung S5.1; sẵn sàng cho S6a.

## 2. Công nghệ & cách chạy

- Node.js >= 22, Express 4, `mssql` (connection pool), SQL Server 2022, Gemini qua REST, frontend HTML/CSS/JS thuần (IIFE gắn `window`, không ES Modules).
- Chạy backend: `cd backend && npm install && npm start` (cổng 3000, phục vụ luôn thư mục `frontend`). Trang đăng nhập: `http://localhost:3000/pages/login.html`.
- Live Server (VS Code) cổng **5500/5501** được hỗ trợ: `api.config.js` gọi API ở `cùng-hostname:3000`; backend ở môi trường không phải production cho phép CORS cho 5500/5501 khi `CORS_ORIGIN` để trống.
- Dev không cần DB: `node tests/helpers/dev-server.js 3000` (dữ liệu giả trong bộ nhớ, **không** thay thế test trên SQL Server thật).
- DB: `node scripts/migrate.js --seed` (áp dụng migration/seed theo thứ tự, bỏ qua file đã áp dụng, kiểm checksum).
- Test: `npm --prefix backend test` (DB giả), `node backend/scripts/smoke.js` (SQL Server thật qua TCP), `node backend/scripts/check-frontend-csp.js`.
- Biến môi trường: xem `backend/.env.example`. `backend/.env` là của máy cá nhân, **không commit, không đọc/ghi log nội dung**.

## 3. Bảng tiến độ theo giai đoạn (đối chiếu mã nguồn ngày 2026-11-15)

| GĐ | Nội dung | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| **A** | Nền kiểm thử, migration, CI | **Xong, đã gộp** | `database/migrations/`, `SchemaVersions`, `scripts/migrate.js`, `docker-compose.dev.yml`, `.github/workflows/ci.yml`; commit `db9ff95`, `ded381d` |
| **B** | Bảo mật nhanh | **Xong, đã gộp (PR #1)** | `middlewares/rate-limiters.js` (3 limiter), `GET /health`, retry SQL 1205 (có test), CSP không còn `'unsafe-inline'` ở `script-src`, `TRUST_PROXY` ghi trong `.env.example`; commit `64b5c8a`, `dcb21f5` |
| **B+** | Sửa lỗi thấy khi chạy thật | **Xong, đã gộp (PR #6)** | Commit `09b0837`, `7e9c50e`; CI tích hợp smoke test trên SQL Server |
| **C** | Vòng đời 4 vai trò, trạng thái booking | **Đang thực hiện (C1: S3–S8/9 hoàn thành: 6/7 session)** | `004_Roles_Lifecycle.sql`; `create-admin.js`; S4 API Admin; S5/S5.1 API Provider+Vet; S6 UI Auth; S7 UI Admin/Provider; S8 `roles-lifecycle.test.js` (161 pass) + `smoke-roles.js` (17/17 pass trên SQL Server 2022) |
| **D** | Phân trang + upload ảnh (Cloudinary) | **Chưa bắt đầu** | Chưa có `utils/pagination.js`, `middlewares/upload.js`, `storage.service.js`; ảnh pet vẫn base64 `Pets.Photo` |
| **E** | Lịch sử chat AI trên server | **Chưa bắt đầu** | Chưa có `chat.model.js`, `chat.service.js`, `ChatSessions/ChatMessages` |
| **F** | Dashboard Provider/Vet/Admin | **Chưa bắt đầu** | `frontend/pages/` chỉ có `customer-dashboard.html`; vai trò khác thấy "đang xây dựng" |

## 4. Những gì đã có và phải giữ nguyên

Truy vấn SQL tham số có kiểu; JWT HS256 + chặn secret yếu ở production; Helmet/CORS/rate limit tách riêng; `UPDLOCK, HOLDLOCK` + unique index chống trùng lịch; lọc theo chủ sở hữu ở mọi truy vấn riêng; envelope `{ success, data, message }`; biểu đồ cân nặng chỉ vẽ khi >= 2 điểm; không seed dữ liệu người dùng/thú cưng/lịch hẹn giả; AI luôn kèm cảnh báo y tế do server gắn và trả 503 thật khi lỗi (`grounded: false` khi không có tài liệu phù hợp).

## 5. Chi tiết Giai đoạn B+ (đối chiếu prompt B+)

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| BP.0 `.gitattributes`, `.gitignore` | Xong | Commit `a222f55`. |
| BP.1 Vòng lặp reload trang chủ | Xong | `updateUser` bỏ qua khi dữ liệu không đổi; `landing.js` dùng `renderForAuth()` + cơ chế bỏ kết quả cũ, không còn `location.reload()`; `header.js` dùng ủy quyền sự kiện; `tests/api-session.test.js`. Đo trên trình duyệt (dữ liệu giả): `index.html` tải 1 lần sau 4 giây. |
| BP.2 Giao diện theo đăng nhập/vai trò | Xong (chưa có ảnh trước/sau) | Hero, thẻ hồ sơ trống, CTA, chân trang (slot `data-auth-slot="footer-account"` ở 8 trang), nút "Trợ lý AI" thu gọn icon. |
| BP.3 Inline handler/CSP | Xong | `data-action="reload"` + listener ủy quyền; `check-frontend-csp.js` quét cả HTML và JS, có xuất hàm, có `tests/frontend-csp.test.js`. |
| BP.4 Chữ tiếng Việt hỏng | Xong | `buildSqlcmdArgs()` có `-f 65001` (+ test); `migrate.js` kiểm tra "encoding corrupt"; `seeds/002_Repair_Sample_Text.sql` đã áp dụng; smoke kiểm tra chuỗi + `charset=utf-8`. |
| BP.5 8 loài + cân nặng thú nhỏ | Xong | `utils/species.js` là nguồn duy nhất; migration `003` (đã áp dụng); cân nặng 0,005–150 kg, `DECIMAL(7,3)`; `Fmt.kg` hiển thị gam; lưới chọn loài 4×2 (`.segmented-wrap`); `health-records.js` nhận 0,005 kg; test hợp đồng frontend/backend. |
| BP.6 Tài liệu + kiểm chứng | Xong | `docs/api/api-documentation.md`, `database/README.md` đã cập nhật; smoke mở rộng; CI chạy smoke trên SQL Server; 114 test unit pass; smoke 25/25 pass trên DB thật. |

## 6. Trạng thái đóng Giai đoạn B+

1. Toàn bộ mã nguồn và test đã commit sạch và đẩy lên nhánh `giai-doan-b-plus`.
2. Kiểm chứng đầy đủ trên cả DB giả và SQL Server thật.
3. CI đã tích hợp smoke test tự động trên container SQL Server 2022.
4. Mở PR `giai-doan-b-plus` → `main` để chủ dự án duyệt và gộp.

## 7. Nhận xét hướng của Master Prompt và quyết định kế tiếp

**Hướng đi đúng chuẩn (giữ):** chia giai đoạn nhỏ có tiêu chí "Hoàn thành khi" kiểm chứng được; bắt buộc đọc file trước khi sửa và báo cáo kết quả test thật (phân biệt DB giả/thật); dừng chờ duyệt; nguyên tắc dữ liệu trung thực; migration có phiên bản; đưa thanh toán/email/Redis ra ngoài phạm vi và đòi quyết định trước.

**Kế hoạch Giai đoạn C:**
- **C1 (Hiện tại):**
  - S3: Migration `004_Roles_Lifecycle.sql`, script `create-admin.js`.
  - S4: API Admin duyệt/từ chối/khóa đối tác (`/admin/users/*`).
  - S5 / S5.1: API Provider tạo/quản lý Vet + cổng `must_change_password` + đổi mật khẩu bắt buộc (`/provider/vets*`, `/auth/change-password`).
  - S6a: Trang đổi mật khẩu bắt buộc (`change-password.html`), cập nhật header/login.
  - S6b: Trang quản lý Vet phía Provider (`provider-vets.html`).
  - S7a: Smoke test C1 trên SQL Server thật (vai trò, vòng đời, khóa cascade, đổi mật khẩu).
  - S7b: Rà soát bảo mật, đóng nhánh `giai-doan-c1`, mở PR vào `main`.
- **C2 (Tiếp theo):**
  - Quy tắc ghi bệnh án của Vet: "vet chỉ ghi bệnh án cho thú cưng có lịch hẹn (không hủy) với cơ sở của vet".
  - Máy trạng thái Booking (`pending` -> `confirmed` -> `completed` / `cancelled` / `no-show`).
  - Phân quyền theo tài nguyên.

## 8. Vấn đề đã biết / việc tồn đọng

- C2: Quy tắc ghi bệnh án của Vet ("vet chỉ ghi bệnh án cho thú cưng có lịch hẹn (không hủy) với cơ sở của vet") hoãn có kiểm soát sang C2.
- JWT cũ vẫn dùng được sau khi đổi mật khẩu cho đến khi hết hạn (token không trạng thái; chấp nhận ở phạm vi hiện tại, cân nhắc vô hiệu hóa khi làm refresh token).
- AuditLog có FK ActorUserId → Users (S3 thêm, khác prompt gốc). Hệ quả: dọn dữ liệu thử ở smoke-roles.js phải xóa dòng AuditLog liên quan TRƯỚC khi xóa user thử.
- CSP: `style-src` vẫn có `'unsafe-inline'` (Master Prompt chỉ cấm ở `script-src`).
- Nút "Trợ lý AI": không có dữ liệu RAG cho loài ngoài chó/mèo → trả `grounded: false` (đúng thiết kế; cần bổ sung tài liệu `docs/knowledge-base/` cho thỏ, hamster, chim, cá, bò sát).
- `Fmt.kg` và `health-records.js` đã sửa cho thú nhỏ; chưa có test e2e giao diện.
- Vai trò provider/vet/admin chỉ thấy màn "đang xây dựng" (chờ C và F).
- `GET /services`, `/pets`, `/bookings` chưa phân trang (Giai đoạn D); ảnh pet vẫn base64 (Giai đoạn D).
- `backend/.env` có trong thư mục làm việc (bí mật cá nhân): không commit, không đưa vào zip chia sẻ.

## 9. Quy tắc cập nhật tệp này (bắt buộc cho mọi AI)

Sau **mỗi lần** sửa/cập nhật dự án, trước khi báo cáo:
1. Cập nhật "Cập nhật lần cuối", "Giai đoạn hiện tại", bảng mục 3 và mục 5/6 nếu liên quan.
2. Thêm **một dòng** vào Nhật ký (mục 10): ngày · giai đoạn · việc đã làm · kiểm chứng (ghi rõ DB giả hay SQL Server thật) · chưa kiểm chứng.

## 10. Nhật ký tiến độ

- 2026-11-17 · B+ · Hoàn tất B+ (BP.0 - BP.6), 114 test unit pass (DB giả), 25/25 smoke test pass (SQL Server 2022 thật), CSP xanh, tạo PR #6 gộp vào main · Đã kiểm chứng DB giả & SQL Server thật.
- 2026-11-18 · C1 · S3 xong: migration 004, create-admin.js; S4 xong: admin.model, admin.service, admin.controller, 131 test unit pass (DB giả) · Chưa kiểm chứng S4 trên SQL Server thật (chờ S7a).
- 2026-11-18 · C1 · S5 xong: API provider/vets, /auth/change-password, cổng must_change_password, 143 test pass + 1 todo (DB giả), CSP xanh · Chưa kiểm chứng trên SQL Server thật (chờ S7a).
- 2026-11-18 · C1 · S5.1 xong: refactor createVet atomic runner, callback transaction DB-only, dao thứ tự middleware change-password, test rollback + isolation limiter pass 145/145 (DB giả), CSP xanh · Chưa kiểm chứng trên SQL Server thật (chờ S7a).
- 2026-11-18 · C1 · S6 xong: mã lỗi login pending/rejected/disabled sau khi đúng mk, bắt buộc orgArea provider (client + server), UI đăng nhập chuyển hướng mustChangePassword, change-password.html + change-password.js + auth-gate + header cập nhật, 147 test pass (DB giả), CSP xanh · Chưa kiểm chứng trên SQL Server thật (chờ S7a).
- 2026-11-19 · C1 · Việc 0 xong: redirect tự động sang change-password.html khi Api nhận 403 must_change_password (ở ngoài change-password.html) + set user.mustChangePassword=true trong phiên + không hiện toast chung, 148 test pass (DB giả), CSP xanh · Chưa kiểm chứng trên SQL Server thật (chờ S7a).
- 2026-11-19 · C1 · S7/9 xong: admin-partners.html + js duyệt/từ chối đối tác pending, provider-vets.html + js tạo bác sĩ (mật khẩu tạm 1 lần) và khóa/mở khóa vet, landing.js & header.js liên kết theo vai trò, 149 test pass (DB giả), CSP xanh · Chưa kiểm chứng giao diện thực tế (chờ reviewer) & SQL Server thật (chờ S7a).
- 2026-11-19 · C1 · S8/9 xong: roles-lifecycle.test.js kiểm thử vòng đời 4 vai trò trên fake-models (161 pass, 0 fail), smoke-roles.js kiểm thử thật 17/17 bước trên SQL Server 2022 (idempotent 2 lần liên tiếp, dọn sạch hoàn toàn Users/Providers về baseline) · Đã kiểm chứng đầy đủ trên DB giả và SQL Server 2022 thật.
