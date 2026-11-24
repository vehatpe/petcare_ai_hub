/* =============================================================================
   PetCare AI Hub - Migration 005: USERS TOKEN VERSION (REVOCATION)
   - Thêm cột TokenVersion INT NOT NULL DEFAULT 0 vào dbo.Users.
   - Khi người dùng đổi mật khẩu hoặc bị khóa tài khoản, TokenVersion được tăng (+1),
     làm mọi JWT token cũ chứa claim tv cũ bị vô hiệu hóa ngay lập tức (401 token_revoked).
   - Re-runnable (idempotent), batch GO riêng, tên constraint DF_Users_TokenVersion rõ ràng.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Users', 'TokenVersion') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD TokenVersion INT NOT NULL CONSTRAINT DF_Users_TokenVersion DEFAULT 0;
END
GO
