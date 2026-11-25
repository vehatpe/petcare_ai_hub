/* =============================================================================
   PetCare AI Hub - Migration 007: BOOKINGS LIFECYCLE & VET LINK
   - Bookings: thêm ProviderId, VetId, ConfirmedAt, CompletedAt, NoShowAt,
     CancelledAt, CancelledBy, CancelReason.
   - Backfill ProviderId từ Services.ProviderId qua ServiceId.
   - Với lịch cũ đã 'cancelled': CancelledBy = 'customer', CancelledAt = CreatedAt.
   - Khóa ngoại: FK_Bookings_ProviderId, FK_Bookings_VetId (NO ACTION).
   - Đặt lại CK_Bookings_Status: ('pending','confirmed','completed','cancelled','no_show').
   - Ràng buộc ghép cặp hủy: CK_Bookings_Cancel_Pair.
   - Chỉ mục: IX_Bookings_Provider_Date, IX_Bookings_Vet_Date, IX_Bookings_Status_Date.
   - Medical_Records: IX_MR_Vet, UX_MR_Booking (filtered UNIQUE WHERE BookingId IS NOT NULL).
   - Re-runnable (idempotent), mỗi ADD COLUMN / ADD CONSTRAINT ở batch GO riêng.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Thêm các cột vòng đời vào dbo.Bookings nếu chưa có
IF COL_LENGTH('dbo.Bookings', 'ProviderId') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD ProviderId VARCHAR(50) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'VetId') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD VetId UNIQUEIDENTIFIER NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'ConfirmedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD ConfirmedAt DATETIME2(3) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'CompletedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD CompletedAt DATETIME2(3) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'NoShowAt') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD NoShowAt DATETIME2(3) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'CancelledAt') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD CancelledAt DATETIME2(3) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'CancelledBy') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD CancelledBy VARCHAR(10) NULL;
END
GO

IF COL_LENGTH('dbo.Bookings', 'CancelReason') IS NULL
BEGIN
    ALTER TABLE dbo.Bookings ADD CancelReason NVARCHAR(300) NULL;
END
GO

-- 2. Backfill ProviderId từ Services và các cột hủy cho lịch cũ
UPDATE b
SET b.ProviderId = s.ProviderId
FROM dbo.Bookings b
INNER JOIN dbo.Services s ON b.ServiceId = s.ServiceId
WHERE b.ProviderId IS NULL;
GO

UPDATE dbo.Bookings
SET CancelledBy = 'customer',
    CancelledAt = CreatedAt
WHERE Status = 'cancelled' AND (CancelledBy IS NULL OR CancelledAt IS NULL);
GO

-- Kiểm tra tính toàn vẹn: nếu còn bất kỳ dòng nào ProviderId IS NULL thì dừng với lỗi rõ ràng
DECLARE @NullProviderCount INT;
SELECT @NullProviderCount = COUNT(*) FROM dbo.Bookings WHERE ProviderId IS NULL;
IF @NullProviderCount > 0
BEGIN
    RAISERROR(N'Phát hiện %d dòng Bookings không có ProviderId sau backfill! Hủy migration.', 16, 1, @NullProviderCount);
    RETURN;
END
GO

-- Đặt NOT NULL cho ProviderId sau khi backfill và kiểm tra an toàn
IF EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.Bookings') 
      AND name = 'ProviderId' 
      AND is_nullable = 1
)
BEGIN
    ALTER TABLE dbo.Bookings ALTER COLUMN ProviderId VARCHAR(50) NOT NULL;
END
GO

-- 3. Khóa ngoại: ProviderId -> Providers, VetId -> Users
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Bookings_ProviderId' AND parent_object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    ALTER TABLE dbo.Bookings ADD CONSTRAINT FK_Bookings_ProviderId FOREIGN KEY (ProviderId) REFERENCES dbo.Providers (ProviderId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Bookings_VetId' AND parent_object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    ALTER TABLE dbo.Bookings ADD CONSTRAINT FK_Bookings_VetId FOREIGN KEY (VetId) REFERENCES dbo.Users (UserId);
END
GO

-- 4. Tạo lại CK_Bookings_Status gồm 5 giá trị
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Bookings_Status' AND parent_object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    ALTER TABLE dbo.Bookings DROP CONSTRAINT CK_Bookings_Status;
END
GO

ALTER TABLE dbo.Bookings ADD CONSTRAINT CK_Bookings_Status CHECK (Status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));
GO

-- 5. CHECK ghép cặp: CancelledBy và CancelledAt cùng NULL hoặc cùng có;
-- chỉ khi Status='cancelled' thì hai cột này mới có giá trị;
-- CancelReason chỉ khi đã hủy.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Bookings_Cancel_Pair' AND parent_object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    ALTER TABLE dbo.Bookings DROP CONSTRAINT CK_Bookings_Cancel_Pair;
END
GO

ALTER TABLE dbo.Bookings ADD CONSTRAINT CK_Bookings_Cancel_Pair CHECK (
    -- CancelledBy chỉ có thể là 'customer' hoặc 'provider' khi có giá trị
    (CancelledBy IS NULL OR CancelledBy IN ('customer', 'provider'))
    AND
    -- Khi Status = 'cancelled': cả CancelledBy và CancelledAt đều phải NOT NULL
    -- Khi Status <> 'cancelled': cả CancelledBy, CancelledAt và CancelReason đều phải NULL
    (
        (Status = 'cancelled' AND CancelledBy IS NOT NULL AND CancelledAt IS NOT NULL)
        OR
        (Status <> 'cancelled' AND CancelledBy IS NULL AND CancelledAt IS NULL AND CancelReason IS NULL)
    )
);
GO

-- 6. Chỉ mục trên Bookings và Medical_Records
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Bookings_Provider_Date' AND object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Bookings_Provider_Date ON dbo.Bookings (ProviderId, BookingDate, BookingTime);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Bookings_Vet_Date' AND object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Bookings_Vet_Date ON dbo.Bookings (VetId, BookingDate) WHERE VetId IS NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Bookings_Status_Date' AND object_id = OBJECT_ID('dbo.Bookings'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Bookings_Status_Date ON dbo.Bookings (Status, BookingDate);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MR_Vet' AND object_id = OBJECT_ID('dbo.Medical_Records'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_MR_Vet ON dbo.Medical_Records (VetId);
END
GO

-- 7. UX_MR_Booking: unique lọc (BookingId) WHERE BookingId IS NOT NULL
-- Trước đó kiểm tra trùng BookingId; nếu có trùng, migration dừng với thông báo liệt kê
DECLARE @DupMrBookings INT;
SELECT @DupMrBookings = COUNT(*)
FROM (
    SELECT BookingId
    FROM dbo.Medical_Records
    WHERE BookingId IS NOT NULL
    GROUP BY BookingId
    HAVING COUNT(*) > 1
) dup;

IF @DupMrBookings > 0
BEGIN
    RAISERROR(N'Phát hiện trùng lặp BookingId trong dbo.Medical_Records! Hủy tạo UX_MR_Booking.', 16, 1);
    RETURN;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_MR_Booking' AND object_id = OBJECT_ID('dbo.Medical_Records'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_MR_Booking ON dbo.Medical_Records (BookingId) WHERE BookingId IS NOT NULL;
END
GO


