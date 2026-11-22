/* =============================================================================
   PetCare AI Hub - Migration 004: ROLES LIFECYCLE, PROVIDER LINK & AUDIT LOG
   - Lý do chọn ràng buộc CHECK ở tầng DB (CK_Users_ProviderLink):
     Bảo vệ tính toàn vẹn dữ liệu tuyệt đối ở mức lõi, ngăn chặn lỗi logic từ bất kỳ
     service, migration hay câu lệnh cập nhật trực tiếp nào có thể tạo ra người dùng
     vet/provider active mà không có ProviderId, hoặc gán ProviderId cho customer/admin.
   - Users: thêm các cột ProviderId, OrgArea, ApprovedBy, ApprovedAt, MustChangePassword, RejectReason.
   - Users: cập nhật CK_Users_Status cho phép ('active','pending','disabled','rejected').
   - Users: thêm CK_Users_ProviderLink với WITH CHECK.
   - Users: thêm filtered index IX_Users_ProviderId.
   - AuditLog: tạo bảng AuditLog và index IX_AuditLog_CreatedAt.
     (Detail không bao giờ chứa mật khẩu/token).
   - Re-runnable (idempotent), dữ liệu cũ nguyên vẹn.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Thêm các cột mới vào dbo.Users nếu chưa tồn tại
IF COL_LENGTH('dbo.Users', 'ProviderId') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD ProviderId VARCHAR(50) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'OrgArea') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD OrgArea NVARCHAR(100) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'ApprovedBy') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD ApprovedBy UNIQUEIDENTIFIER NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'ApprovedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD ApprovedAt DATETIME2(3) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'MustChangePassword') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD MustChangePassword BIT NOT NULL CONSTRAINT DF_Users_MustChangePassword DEFAULT 0;
END
GO

IF COL_LENGTH('dbo.Users', 'RejectReason') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD RejectReason NVARCHAR(200) NULL;
END
GO

-- 2. Thêm khóa ngoại cho ProviderId và ApprovedBy (batch riêng sau khi cột đã tồn tại)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_ProviderId' AND parent_object_id = OBJECT_ID('dbo.Users'))
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_ProviderId FOREIGN KEY (ProviderId) REFERENCES dbo.Providers (ProviderId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Users_ApprovedBy' AND parent_object_id = OBJECT_ID('dbo.Users'))
BEGIN
    ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_ApprovedBy FOREIGN KEY (ApprovedBy) REFERENCES dbo.Users (UserId);
END
GO

-- 3. Cập nhật CK_Users_Status: drop và add lại
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Users_Status' AND parent_object_id = OBJECT_ID('dbo.Users'))
BEGIN
    ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_Status;
END
GO

ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_Status CHECK (Status IN ('active', 'pending', 'disabled', 'rejected'));
GO

-- 4. Kiểm tra dòng vi phạm trước khi thêm CK_Users_ProviderLink
-- Đếm số dòng không thỏa mãn:
-- (Role IN ('vet','provider') AND (Status <> 'active' OR ProviderId IS NOT NULL)) OR (Role NOT IN ('vet','provider') AND ProviderId IS NULL)
DECLARE @Violations INT;
SELECT @Violations = COUNT(*) FROM dbo.Users
WHERE NOT (
    (Role IN ('vet', 'provider') AND (Status <> 'active' OR ProviderId IS NOT NULL))
    OR
    (Role NOT IN ('vet', 'provider') AND ProviderId IS NULL)
);

IF @Violations > 0
BEGIN
    PRINT N'[WARNING] Phát hiện ' + CAST(@Violations AS NVARCHAR(10)) + N' dòng vi phạm CK_Users_ProviderLink!';
END
ELSE
BEGIN
    PRINT N'[INFO] 0 dòng vi phạm CK_Users_ProviderLink. Sẵn sàng tạo ràng buộc.';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Users_ProviderLink' AND parent_object_id = OBJECT_ID('dbo.Users'))
BEGIN
    ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_ProviderLink CHECK (
        (Role IN ('vet', 'provider') AND (Status <> 'active' OR ProviderId IS NOT NULL))
        OR
        (Role NOT IN ('vet', 'provider') AND ProviderId IS NULL)
    );
END
GO

-- 5. Filtered Index IX_Users_ProviderId
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Users_ProviderId' AND object_id = OBJECT_ID('dbo.Users'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Users_ProviderId ON dbo.Users (ProviderId) WHERE ProviderId IS NOT NULL;
END
GO

-- 6. Bảng AuditLog và Index
IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLog (
        AuditId      BIGINT IDENTITY(1,1) NOT NULL,
        ActorUserId  UNIQUEIDENTIFIER     NULL,
        Action       VARCHAR(40)          NOT NULL,
        TargetType   VARCHAR(20)          NOT NULL,
        TargetId     VARCHAR(50)          NOT NULL,
        Detail       NVARCHAR(500)        NULL, -- Detail không bao giờ chứa mật khẩu/token
        CreatedAt    DATETIME2(3)         NOT NULL CONSTRAINT DF_AuditLog_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AuditLog PRIMARY KEY (AuditId),
        CONSTRAINT FK_AuditLog_ActorUserId FOREIGN KEY (ActorUserId) REFERENCES dbo.Users (UserId)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AuditLog_CreatedAt' AND object_id = OBJECT_ID('dbo.AuditLog'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_AuditLog_CreatedAt ON dbo.AuditLog (CreatedAt);
END
GO
