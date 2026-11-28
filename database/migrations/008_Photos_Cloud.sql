/* =============================================================================
   PetCare AI Hub - Migration 008: CLOUD PHOTO & AVATAR COLUMNS
   - Thêm cột PhotoUrl, PhotoPublicId vào dbo.Pets (giữ nguyên Pets.Photo tới S23).
   - Thêm cột AvatarUrl, AvatarPublicId vào dbo.Users.
   - Ràng buộc CHECK ghép cặp CK_Pets_Photo_Pair và CK_Users_Avatar_Pair.
   - Re-runnable (idempotent), mỗi ALTER ở batch GO riêng.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH('dbo.Pets', 'PhotoUrl') IS NULL
BEGIN
    ALTER TABLE dbo.Pets ADD PhotoUrl VARCHAR(500) NULL;
END
GO

IF COL_LENGTH('dbo.Pets', 'PhotoPublicId') IS NULL
BEGIN
    ALTER TABLE dbo.Pets ADD PhotoPublicId VARCHAR(200) NULL;
END
GO

IF OBJECT_ID('dbo.CK_Pets_Photo_Pair', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Pets WITH CHECK ADD CONSTRAINT CK_Pets_Photo_Pair
        CHECK ((PhotoUrl IS NULL AND PhotoPublicId IS NULL) OR (PhotoUrl IS NOT NULL AND PhotoPublicId IS NOT NULL));
END
GO

IF COL_LENGTH('dbo.Users', 'AvatarUrl') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD AvatarUrl VARCHAR(500) NULL;
END
GO

IF COL_LENGTH('dbo.Users', 'AvatarPublicId') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD AvatarPublicId VARCHAR(200) NULL;
END
GO

IF OBJECT_ID('dbo.CK_Users_Avatar_Pair', 'C') IS NULL
BEGIN
    ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_Avatar_Pair
        CHECK ((AvatarUrl IS NULL AND AvatarPublicId IS NULL) OR (AvatarUrl IS NOT NULL AND AvatarPublicId IS NOT NULL));
END
GO
