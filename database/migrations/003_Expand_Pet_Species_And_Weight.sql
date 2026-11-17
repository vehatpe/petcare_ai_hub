/* =============================================================================
   PetCare AI Hub - Migration: EXPAND PET SPECIES AND WEIGHT
   - Drops CK_Pets_Species if present
   - Alters Pets.Species from VARCHAR(5) to VARCHAR(12) NOT NULL
   - Adds CK_Pets_Species with 8 allowed species:
     ('dog', 'cat', 'rabbit', 'hamster', 'bird', 'fish', 'reptile', 'other')
   - Drops CK_HM_Value if present
   - Alters Health_Metrics.Value from DECIMAL(5,2) to DECIMAL(7,3) NOT NULL
   - Adds CK_HM_Value CHECK (Value > 0)
   - Re-runnable (idempotent), existing data stays intact.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- 1. Alter Pets.Species
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Pets_Species' AND parent_object_id = OBJECT_ID('dbo.Pets'))
BEGIN
    ALTER TABLE dbo.Pets DROP CONSTRAINT CK_Pets_Species;
END
GO

ALTER TABLE dbo.Pets ALTER COLUMN Species VARCHAR(12) NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Pets_Species' AND parent_object_id = OBJECT_ID('dbo.Pets'))
BEGIN
    ALTER TABLE dbo.Pets ADD CONSTRAINT CK_Pets_Species CHECK (Species IN ('dog', 'cat', 'rabbit', 'hamster', 'bird', 'fish', 'reptile', 'other'));
END
GO

-- 2. Alter Health_Metrics.Value
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_HM_Value' AND parent_object_id = OBJECT_ID('dbo.Health_Metrics'))
BEGIN
    ALTER TABLE dbo.Health_Metrics DROP CONSTRAINT CK_HM_Value;
END
GO

ALTER TABLE dbo.Health_Metrics ALTER COLUMN Value DECIMAL(7,3) NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_HM_Value' AND parent_object_id = OBJECT_ID('dbo.Health_Metrics'))
BEGIN
    ALTER TABLE dbo.Health_Metrics ADD CONSTRAINT CK_HM_Value CHECK (Value > 0);
END
GO
