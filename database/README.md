# Database (SQL Server 2022)

| Thứ tự | Tệp | Nội dung |
|---|---|---|
| 1 | `scripts/001_Create_Schema.sql` | Tạo DB `PetCareAIHub` (nếu chưa có) + Users, Providers, Services, Pets, Health_Metrics, Vaccinations, Bookings, Medical_Records |
| 2 | `scripts/002_Create_AI_Knowledge.sql` | `Knowledge_Chunks` cho RAG |
| 3 | `seeds/001_Seed_Providers_And_Services.sql` | 4 cơ sở + 7 dịch vụ **minh họa** (`IsSample = 1`). Không có user/thú cưng/lịch hẹn/tiêm chủng/cân nặng giả. |

Mọi script chạy lại được nhiều lần (idempotent). Nếu dùng tên DB khác `PetCareAIHub`, sửa dòng `CREATE DATABASE`/`USE` ở đầu từng tệp và `DB_NAME` trong `backend/.env`.

## SSMS 2022
1. Connect tới instance, mở từng tệp theo thứ tự trên (File > Open), nhấn **Execute** (F5). Tệp dùng `GO`, SSMS tự tách batch.
2. Kiểm tra: `SELECT * FROM PetCareAIHub.dbo.Services;` phải có 7 dòng, `IsSample = 1`.

## sqlcmd
```
sqlcmd -S localhost -U sa -P "<mật khẩu>" -C -b -i database/scripts/001_Create_Schema.sql
sqlcmd -S localhost -U sa -P "<mật khẩu>" -C -b -i database/scripts/002_Create_AI_Knowledge.sql
sqlcmd -S localhost -U sa -P "<mật khẩu>" -C -b -i database/seeds/001_Seed_Providers_And_Services.sql
```
(`-C` tin cậy chứng chỉ tự ký, chỉ dùng khi dev; `-b` dừng với mã lỗi nếu có lỗi.) Dùng sqlcmd, `SET QUOTED_IDENTIFIER ON` đã nằm trong script (cần cho filtered index).

## Ghi chú thiết kế
- Id người dùng/thú cưng/lịch hẹn là `UNIQUEIDENTIFIER`; Providers/Services dùng slug (`medical-general`).
- `UX_Bookings_Pet_Slot`: filtered unique index, một bé không thể có hai lịch chưa hủy cùng ngày+giờ.
- `Bookings.PetId` là `ON DELETE SET NULL`; lịch hẹn giữ ảnh chụp `PetName/ServiceName/ProviderLabel/PriceVnd`. `Bookings.UserId` và `Medical_Records.VetId` cố ý để `NO ACTION` (tránh lỗi "multiple cascade paths"); chưa có chức năng xóa user.
- Cột `Medical_Records.PlanText` (không phải `Plan`, vì `PLAN` là từ khóa dành riêng của T-SQL).
- Mô tả dịch vụ (`Services.Description`) để trống vì bản mẫu không có mô tả; không bịa thêm.

## Cơ chế Migration tự động
Dự án sử dụng cơ chế migration có phiên bản qua bảng `dbo.SchemaVersions` và script `backend/scripts/migrate.js`:
```bash
cd backend
npm run migrate         # Chạy các script schema và migration mới nhất
npm run migrate -- --seed # Chạy kèm script seed minh họa
```
- Tự động bỏ qua các file migration đã áp dụng trước đó (idempotent).
- Các migration tăng tiến tiếp theo được đặt trong thư mục `database/migrations/` (ví dụ `003_....sql`, `004_....sql`).

## Đã kiểm chứng trên SQL Server 2022 thật
Toàn bộ các script tạo schema (`001_Create_Schema.sql`), tri thức RAG (`002_Create_AI_Knowledge.sql`) và dữ liệu mẫu (`001_Seed_Providers_And_Services.sql`) đã được thực thi và kiểm chứng thành công trên Microsoft SQL Server 2022 (RTM) thật và container Docker `mcr.microsoft.com/mssql/server:2022-latest`. Mọi cú pháp T-SQL, kiểu dữ liệu (`UNIQUEIDENTIFIER`, `DATETIME2(3)`, `NVARCHAR(MAX)` JSON check constraint), chỉ mục có điều kiện (`UX_Bookings_Pet_Slot`), và câu lệnh `MERGE` đều hoạt động trơn tru không phát sinh lỗi.


## Sửa chữ tiếng Việt bị hỏng (encoding)

Nguyên nhân thường gặp: `sqlcmd` đọc seed UTF-8 bằng ANSI. `migrate.js` hiện truyền `-f 65001` (qua `buildSqlcmdArgs()`) và sau mỗi seed tự đọc lại `CategoryLabel` của `medical-general` để phát hiện lỗi ("encoding corrupt").

Dòng seed đã ghi trong `SchemaVersions` bị bỏ qua, nên dữ liệu đã hỏng được sửa bằng file mới `seeds/002_Repair_Sample_Text.sql` (idempotent, chỉ cập nhật dòng `IsSample = 1`, không đụng dữ liệu thật):

```
node scripts/migrate.js --seed
```

Kiểm tra sau sửa:

```sql
SELECT ServiceId, CategoryLabel, Name FROM dbo.Services;
SELECT ProviderId, Name, Area FROM dbo.Providers;
```

`CategoryLabel` của `medical-general` phải là `Khám & điều trị`. Không sửa nội dung các file đã áp dụng (checksum sẽ báo MISMATCH).

## Migration 003: loài thú cưng và cân nặng

`migrations/003_Expand_Pet_Species_And_Weight.sql` (chạy lại được): `Pets.Species` → `VARCHAR(12)` với 8 loài; `Health_Metrics.Value` → `DECIMAL(7,3)`, `CHECK (Value > 0)`. Dữ liệu cũ giữ nguyên.

## Migration 004: Vòng đời vai trò (Roles Lifecycle), liên kết Provider và AuditLog

`migrations/004_Roles_Lifecycle.sql` (chạy lại được):
- `Users`: thêm các cột `ProviderId VARCHAR(50) NULL` (FK → `Providers`), `OrgArea NVARCHAR(100) NULL`, `ApprovedBy UNIQUEIDENTIFIER NULL` (FK → `Users`), `ApprovedAt DATETIME2(3) NULL`, `MustChangePassword BIT NOT NULL DEFAULT 0`, `RejectReason NVARCHAR(200) NULL`.
- `Users`: nới rộng `CK_Users_Status` cho phép `'active'`, `'pending'`, `'disabled'`, `'rejected'`.
- `Users`: ràng buộc kiểm tra toàn vẹn tầng DB `CK_Users_ProviderLink` đảm bảo các vai trò `vet`/`provider` khi `active` bắt buộc phải có `ProviderId`, và người dùng không thuộc vai trò này không được gắn `ProviderId`.
- `Users`: non-clustered filtered index `IX_Users_ProviderId` (WHERE `ProviderId IS NOT NULL`).
- `AuditLog`: bảng ghi vết kiểm toán quản trị (`AuditId`, `ActorUserId`, `Action`, `TargetType`, `TargetId`, `Detail`, `CreatedAt`) và index `IX_AuditLog_CreatedAt`. `Detail` không bao giờ chứa mật khẩu/token.

### Tạo tài khoản Quản trị viên (Admin)

Admin chỉ được khởi tạo qua script dòng lệnh `scripts/create-admin.js`, không tạo qua form đăng ký công khai:

```bash
cd backend
# Cách 1: Thiết lập biến môi trường ADMIN_PASSWORD trước khi chạy
node scripts/create-admin.js --email <email-admin> --name "<Họ và tên>" --phone <số-điện-thoại>

# Cách 2: Chạy script và nhập mật khẩu ẩn trực tiếp qua stdin khi được nhắc
node scripts/create-admin.js --email <email-admin> --name "<Họ và tên>" --phone <số-điện-thoại>
```

- Mật khẩu tuân thủ nghiêm ngặt chuẩn hệ thống (ít nhất 8 ký tự, có cả chữ và số, tối đa 72 ký tự).
- Tuyệt đối không truyền mật khẩu qua tham số dòng lệnh CLI, không ghi log hay in ra stdout.
- Script có tính chất idempotent: nếu email đã là admin thì báo đã tồn tại và thoát 0; nếu email đã thuộc role khác thì từ chối (không nâng quyền ngầm). Ghi vết `admin_created` vào `AuditLog`.

