# PetCare AI Hub — Project Status

> **Tệp này là bộ nhớ làm việc của dự án.** Mọi AI làm việc trên repo này phải đọc nó **trước khi sửa bất cứ thứ gì**, và phải cập nhật nó **sau mỗi lần sửa/đổi dự án** (xem mục 9).
> Nguồn chuẩn về quy trình và nguyên tắc: *Master Prompt Phát triển PetCare AI Hub (v2)*. Khi tệp này mâu thuẫn với mã nguồn, **mã nguồn là sự thật**; sửa tệp này cho đúng.

- **Cập nhật lần cuối:** 2026-11-17
- **Nhánh làm việc:** `giai-doan-c1` (tách từ `main`, `main` đã gộp PR #6 của Giai đoạn B+)
- **Giai đoạn hiện tại:** **C1 (migration 004 + script tạo admin) — ĐÃ HOÀN THÀNH**. Sẵn sàng cho Session C2 / các endpoint quản trị.
- **Việc kế tiếp (một đề xuất duy nhất):** Tiến hành Session C1 tiếp theo (hoặc C2): hiện thực các service/endpoint đăng ký Provider pending, Vet flow và Admin duyệt.

## Đang làm
không có

---

## 1. Tóm tắt một dòng

Nền tảng (A), bảo mật nhanh (B) đã **gộp vào main**. B+ (sửa 7 nhóm lỗi tìm thấy khi chạy thật, CI tích hợp smoke test trên SQL Server) đã **hoàn thành toàn diện, kiểm chứng trên cả DB giả (114 tests) và SQL Server 2022 thật (25/25 smoke tests pass, migrate idempotent)**, đã đẩy lên remote và sẵn sàng mở PR vào `main`. Các giai đoạn **C, D, E, F chưa bắt đầu**.

## 2. Công nghệ & cách chạy

- Node.js >= 22, Express 4, `mssql` (connection pool), SQL Server 2022, Gemini qua REST, frontend HTML/CSS/JS thuần (IIFE gắn `window`, không ES Modules).
- Chạy backend: `cd backend && npm install && npm start` (cổng 3000, phục vụ luôn thư mục `frontend`). Trang đăng nhập: `http://localhost:3000/pages/login.html`.
- Live Server (VS Code) cổng **5500/5501** được hỗ trợ: `api.config.js` gọi API ở `cùng-hostname:3000`; backend ở môi trường không phải production cho phép CORS cho 5500/5501 khi `CORS_ORIGIN` để trống.
- Dev không cần DB: `node tests/helpers/dev-server.js 3000` (dữ liệu giả trong bộ nhớ, **không** thay thế test trên SQL Server thật).
- DB: `node scripts/migrate.js --seed` (áp dụng migration/seed theo thứ tự, bỏ qua file đã áp dụng, kiểm checksum).
- Test: `npm test` (DB giả), `node scripts/smoke.js` (SQL Server thật qua TCP), `node scripts/check-frontend-csp.js`.
- Biến môi trường: xem `backend/.env.example`. `backend/.env` là của máy cá nhân, **không commit, không đọc/ghi log nội dung**.

## 3. Bảng tiến độ theo giai đoạn (đối chiếu mã nguồn ngày 2026-11-15)

| GĐ | Nội dung | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| **A** | Nền kiểm thử, migration, CI | **Xong, đã gộp** | `database/migrations/`, `SchemaVersions`, `scripts/migrate.js`, `docker-compose.dev.yml`, `.github/workflows/ci.yml`; commit `db9ff95`, `ded381d` |
| **B** | Bảo mật nhanh | **Xong, đã gộp (PR #1)** | `middlewares/rate-limiters.js` (3 limiter), `GET /health`, retry SQL 1205 (có test), CSP không còn `'unsafe-inline'` ở `script-src`, `TRUST_PROXY` ghi trong `.env.example`; commit `64b5c8a`, `dcb21f5` |
| **B+** | Sửa lỗi thấy khi chạy thật | **Xong, đã gộp (PR #6)** | Commit `09b0837`, `7e9c50e`; CI tích hợp smoke test trên SQL Server |
| **C** | Vòng đời 4 vai trò, trạng thái booking | **Đang thực hiện (C1 xong)** | `004_Roles_Lifecycle.sql` (cột ProviderId, OrgArea, ApprovedBy/At, MustChangePassword, RejectReason; CK_Users_ProviderLink, AuditLog); script `create-admin.js` |
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

**Kiểm chứng đã có:**
- `npm test`: **114/114 pass** — chạy trên **DB giả** (fake-models), kiểm lại ngày 2026-11-17.
- `node scripts/smoke.js`: **25/25 pass** — chạy trên **SQL Server thật qua TCP (localhost:1433)** ngày 2026-11-17 (gồm chữ tiếng Việt, 8 loài, cân nặng 0,045 kg, trùng giờ 409, kín chỗ 409, hủy lịch).
- `migrate.js --seed`: 5 script (001, 002, 003, seed 001, seed 002) đều "already applied, checksum verified" trên DB dev qua 2 lần chạy liên tiếp.
- `check-frontend-csp.js`: xanh tuyệt đối (0 vi phạm).
- `CI`: thêm bước chạy smoke test với service MSSQL 2022.

## 6. Trạng thái đóng Giai đoạn B+

1. Toàn bộ mã nguồn và test đã commit sạch và đẩy lên nhánh `giai-doan-b-plus`.
2. Kiểm chứng đầy đủ trên cả DB giả và SQL Server thật.
3. CI đã tích hợp smoke test tự động trên container SQL Server 2022.
4. Mở PR `giai-doan-b-plus` → `main` để chủ dự án duyệt và gộp.

## 7. Nhận xét hướng của Master Prompt và quyết định kế tiếp

**Hướng đi đúng chuẩn (giữ):** chia giai đoạn nhỏ có tiêu chí "Hoàn thành khi" kiểm chứng được; bắt buộc đọc file trước khi sửa và báo cáo kết quả test thật (phân biệt DB giả/thật); dừng chờ duyệt; nguyên tắc dữ liệu trung thực; migration có phiên bản; đưa thanh toán/email/Redis ra ngoài phạm vi và đòi quyết định trước. B+ đã chứng minh quy trình hiệu quả: lỗi thật (reload lặp, CSP, chữ hỏng) chỉ lộ khi chạy thật và được sửa nhờ prompt chi tiết.

**Điểm cần chỉnh khi đi tiếp (đề xuất, chờ chủ dự án duyệt):**
1. **Đánh số migration:** Master Prompt gán `003` cho Giai đoạn C, nhưng `003` đã bị B+ dùng (`003_Expand_Pet_Species_And_Weight`). Migration kế tiếp là **`004`** trở đi. Không đổi tên file đã áp dụng.
2. **Giai đoạn C quá lớn** (migration + admin + provider + vet + máy trạng thái + phân quyền + tài liệu). Nên chia: **C1** = migration `004` (liên kết `Users`↔`Providers`, cột vòng đời `Bookings`) + seed/script tạo Admin + endpoint Admin duyệt/từ chối/khóa provider; **C2** = endpoint Provider (tạo Vet, `confirm/complete/no-show/reject`) + máy trạng thái + phân quyền theo tài nguyên + ghi bệnh án của Vet. Mỗi phần có báo cáo và PR riêng.
3. **Phụ thuộc E–F–RAG:** `RAG_REQUIRE_APPROVED=true` ở production chỉ có tác dụng khi có người duyệt chunk (Admin Dashboard, Giai đoạn F). Trước đó bật cờ này sẽ làm AI trả "chưa có tài liệu phù hợp" cho mọi câu hỏi. Ghi rõ vào `.env.example`/docs.
4. **Thiếu trong Master Prompt:** test e2e trên trình duyệt (các lỗi B+ đều là lỗi phía trình duyệt mà unit test không bắt được); môi trường staging, sao lưu và rollback migration; giám sát/ghi log khi chạy thật; kiểm thử với người dùng thật (3–5 chủ nuôi/phòng khám) trước Giai đoạn F.
5. **Mục 2 của Master Prompt đã cũ:** vài dòng ("11 bài test", bảng "thiếu/sai" của A/B) không còn đúng; cập nhật bằng cách coi tệp này là nguồn trạng thái hiện hành.
6. **Quyết định chủ dự án còn nợ:** tài khoản Cloudinary (Giai đoạn D), nhà cung cấp email, cách thu tiền (đặt cọc hay trả tại chỗ). Gợi ý: bắt đầu bằng đặt lịch + trả tại chỗ, ghi trạng thái thanh toán thủ công, đặt cọc tùy chọn sau Giai đoạn C + F.

**Quyết định kế tiếp:** (a) đóng B+ theo mục 6; (b) sau khi chủ dự án viết "duyệt", làm **Giai đoạn C1**; (c) tiếp theo C2, rồi D, E, F theo thứ tự (F chỉ sau C).

## 8. Vấn đề đã biết / việc tồn đọng

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
3. Không ghi "đã xong/đã qua" cho việc chưa chạy thật; ghi trong "Chưa kiểm chứng".
4. Không xóa lịch sử cũ trong Nhật ký; chỉ viết lại các mục trạng thái cho đúng hiện tại.
5. Không ghi bí mật (mật khẩu, khóa API, nội dung `.env`) vào tệp này.

## 10. Nhật ký thay đổi

| Ngày | Giai đoạn | Việc đã làm | Kiểm chứng |
| --- | --- | --- | --- |
| (trước 11/2026) | A | Test harness, migration có checksum, CI, docker-compose.dev | `npm test`; chạy script trên SQL Server thật |
| (trước 11/2026) | B | Rate limiters tách riêng, CSP bỏ `unsafe-inline` ở `script-src`, retry deadlock 1205, `/health`, `TRUST_PROXY` | Test (DB giả); PR #1 gộp vào `main` |
| 2026-11-14 | B+ | Rà soát B+; sửa 2 test hỏng; `health-records.js` 0,005 kg; `Fmt.kg`; CSS `.segmented-wrap` lưới 4×2; mở rộng `smoke.js`; cập nhật docs/README | `npm test` 90/90 (DB giả); chụp giao diện với dữ liệu giả |
| 2026-11-15 | B+ | Sửa `smoke.js` (giới hạn 10 pet, thêm `11-setup`); hỗ trợ Live Server 5500/5501 (+CORS dev, +test) | `npm test` 91/91 (DB giả); `smoke.js` 25/25 trên SQL Server thật (chủ dự án chạy) |
| 2026-11-15 | — | Tạo `project_status.md`; đối chiếu hiện trạng với Master Prompt | Đọc mã nguồn, chạy lại `npm test` 91/91 (DB giả); **chưa** chạy smoke/CI từ phía AI |
| 2026-11-17 | B+ (Session 1/9) | landing.js tách 3 trạng thái tải / lỗi / trống; data-action="reload-profile"; test landing-states.test.js | `npm test` 99 pass (DB giả); `check-frontend-csp.js` pass | Chưa kiểm chứng giao diện thực tế trên trình duyệt |
| 2026-11-17 | B+ (Session 1.1) | Chống nhấp nháy hero: thêm auth-boot.js, CSS landing.css, data-authReady trong landing.js, test auth-boot & landing-states | `npm test` 113 pass (DB giả); `check-frontend-csp.js` pass | Chưa đo độ trễ mạng thực tế trên trình duyệt |
| 2026-11-17 | B+ (Session 1.2) | Mở rộng CSS chống nhấp nháy cho #heroTitle, #heroSub; thêm test tĩnh kiểm tra 4 id trong landing.css | `npm test` 114 pass (DB giả); `check-frontend-csp.js` pass | Chưa đo độ trễ mạng thực tế trên trình duyệt |
| 2026-11-17 | B+ (Session 2/9) | Đóng B+: thêm bước smoke test vào CI `.github/workflows/ci.yml`, kiểm thử toàn diện | `npm test`: 114 pass (DB giả); `check-frontend-csp.js`: pass; `migrate.js --seed`: 5/5 verified (DB thật); `smoke.js`: 25/25 pass (DB thật) | Chưa biết kết quả Actions trên GitHub (chưa có gh CLI) |
| 2026-11-17 | C1 (Session 3/9) | Migration 004_Roles_Lifecycle.sql (cột mới, CK_Users_ProviderLink, AuditLog); user.model & fake-models đọc/ghi cột mới; script create-admin.js; test create-admin; cập nhật database/README.md | `migrate.js --seed`: 6/6 verified (DB thật); `create-admin.js`: tạo thành công & idempotent (DB thật); `npm test`: 120 pass, 0 fail (DB giả); `check-frontend-csp.js`: pass | Chưa có endpoint API cho các vai trò mới (chờ session sau) |
