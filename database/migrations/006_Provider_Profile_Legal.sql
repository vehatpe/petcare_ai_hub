/* =============================================================================
   PetCare AI Hub - Migration 006: PROVIDER PROFILE & OPTIONAL LEGAL INFO
   - Users: thêm OrgLicenseNo (NVARCHAR(50)), OrgTaxCode (VARCHAR(20)).
     Lưu tạm thông tin pháp lý do provider nhập lúc đăng ký, chờ được duyệt.
   - Providers: thêm Address (NVARCHAR(200)), Phone (VARCHAR(20)),
     Description (NVARCHAR(500)), LicenseNo (NVARCHAR(50)),
     TaxCode (VARCHAR(20)), UpdatedAt (DATETIME2(3)).
   - Re-runnable (idempotent), mỗi ADD COLUMN một batch GO riêng,
     tất cả cột đều NULL, không thêm ràng buộc mới ngoài kiểu và độ dài.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Users: OrgLicenseNo và OrgTaxCode
IF COL_LENGTH('dbo.Users', 'OrgLicenseNo') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD OrgLicenseNo NVARCHAR(50) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'OrgTaxCode') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD OrgTaxCode VARCHAR(20) NULL;
END
GO

-- 2. Providers: Address, Phone, Description, LicenseNo, TaxCode, UpdatedAt
IF COL_LENGTH('dbo.Providers', 'Address') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD Address NVARCHAR(200) NULL;
END
GO

IF COL_LENGTH('dbo.Providers', 'Phone') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD Phone VARCHAR(20) NULL;
END
GO

IF COL_LENGTH('dbo.Providers', 'Description') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD Description NVARCHAR(500) NULL;
END
GO

IF COL_LENGTH('dbo.Providers', 'LicenseNo') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD LicenseNo NVARCHAR(50) NULL;
END
GO

IF COL_LENGTH('dbo.Providers', 'TaxCode') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD TaxCode VARCHAR(20) NULL;
END
GO

IF COL_LENGTH('dbo.Providers', 'UpdatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Providers ADD UpdatedAt DATETIME2(3) NULL;
END
GO
