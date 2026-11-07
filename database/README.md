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
