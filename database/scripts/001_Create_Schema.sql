/* =============================================================================
   PetCare AI Hub - 001_Create_Schema.sql
   SQL Server 2022. Idempotent: safe to run more than once.
   Edit the database name below if your DB_NAME differs.
   ============================================================================= */
IF DB_ID(N'PetCareAIHub') IS NULL
    CREATE DATABASE PetCareAIHub;
GO
USE PetCareAIHub;
GO
-- Required for filtered indexes / indexed constraints.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* ---------- Users ---------- */
IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        UserId       UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Users_UserId DEFAULT NEWID(),
        Role         VARCHAR(10)      NOT NULL,
        Status       VARCHAR(10)      NOT NULL,
        FullName     NVARCHAR(100)    NOT NULL,
        Email        NVARCHAR(254)    NOT NULL,
        Phone        VARCHAR(15)      NOT NULL,
        PasswordHash VARCHAR(100)     NOT NULL,
        OrgName      NVARCHAR(150)    NULL,
        OrgType      VARCHAR(10)      NULL,
        CreatedAt    DATETIME2(3)     NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Users PRIMARY KEY (UserId),
        CONSTRAINT CK_Users_Role    CHECK (Role IN ('customer','provider','vet','admin')),
        CONSTRAINT CK_Users_Status  CHECK (Status IN ('active','pending','disabled')),
        CONSTRAINT CK_Users_OrgType CHECK (OrgType IS NULL OR OrgType IN ('clinic','spa','hotel','emergency'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_Email' AND object_id = OBJECT_ID(N'dbo.Users'))
    CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_Phone' AND object_id = OBJECT_ID(N'dbo.Users'))
    CREATE UNIQUE INDEX UX_Users_Phone ON dbo.Users (Phone);
GO

/* ---------- Providers ---------- */
IF OBJECT_ID(N'dbo.Providers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Providers (
        ProviderId VARCHAR(50)   NOT NULL,
        Name       NVARCHAR(150) NOT NULL,
        Area       NVARCHAR(100) NOT NULL,
        Type       VARCHAR(10)   NOT NULL,
        IsSample   BIT           NOT NULL CONSTRAINT DF_Providers_IsSample DEFAULT 0,
        IsActive   BIT           NOT NULL CONSTRAINT DF_Providers_IsActive DEFAULT 1,
        CreatedAt  DATETIME2(3)  NOT NULL CONSTRAINT DF_Providers_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Providers PRIMARY KEY (ProviderId),
        CONSTRAINT CK_Providers_Type CHECK (Type IN ('clinic','spa','hotel','emergency'))
    );
END
GO

/* ---------- Services ---------- */
IF OBJECT_ID(N'dbo.Services', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Services (
        ServiceId     VARCHAR(50)   NOT NULL,
        ProviderId    VARCHAR(50)   NOT NULL,
        Category      VARCHAR(10)   NOT NULL,
        CategoryLabel NVARCHAR(50)  NOT NULL,
        Name          NVARCHAR(200) NOT NULL,
        Description   NVARCHAR(500) NOT NULL CONSTRAINT DF_Services_Description DEFAULT N'',
        PriceVnd      INT           NOT NULL,
        Unit          NVARCHAR(30)  NOT NULL,
        SlotCapacity  INT           NOT NULL CONSTRAINT DF_Services_SlotCapacity DEFAULT 3,
        IsSample      BIT           NOT NULL CONSTRAINT DF_Services_IsSample DEFAULT 0,
        IsActive      BIT           NOT NULL CONSTRAINT DF_Services_IsActive DEFAULT 1,
        CreatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_Services_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Services PRIMARY KEY (ServiceId),
        CONSTRAINT FK_Services_Providers FOREIGN KEY (ProviderId) REFERENCES dbo.Providers (ProviderId),
        CONSTRAINT CK_Services_Category CHECK (Category IN ('medical','grooming','hotel','emergency')),
        CONSTRAINT CK_Services_Price CHECK (PriceVnd >= 0),
        CONSTRAINT CK_Services_Capacity CHECK (SlotCapacity >= 1)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Services_Provider' AND object_id = OBJECT_ID(N'dbo.Services'))
    CREATE INDEX IX_Services_Provider ON dbo.Services (ProviderId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Services_Category' AND object_id = OBJECT_ID(N'dbo.Services'))
    CREATE INDEX IX_Services_Category ON dbo.Services (Category);
GO

/* ---------- Pets ---------- */
IF OBJECT_ID(N'dbo.Pets', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Pets (
        PetId      UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Pets_PetId DEFAULT NEWID(),
        OwnerId    UNIQUEIDENTIFIER NOT NULL,
        Name       NVARCHAR(40)     NOT NULL,
        Species    VARCHAR(5)       NOT NULL,
        Breed      NVARCHAR(80)     NOT NULL CONSTRAINT DF_Pets_Breed DEFAULT N'',
        Sex        VARCHAR(6)       NOT NULL,
        BirthDate  DATE             NOT NULL,
        Color      NVARCHAR(50)     NOT NULL CONSTRAINT DF_Pets_Color DEFAULT N'',
        Neutered   VARCHAR(7)       NOT NULL CONSTRAINT DF_Pets_Neutered DEFAULT 'unknown',
        Microchip  VARCHAR(15)      NOT NULL CONSTRAINT DF_Pets_Microchip DEFAULT '',
        Conditions NVARCHAR(500)    NOT NULL CONSTRAINT DF_Pets_Conditions DEFAULT N'',
        Photo      NVARCHAR(MAX)    NULL,
        CreatedAt  DATETIME2(3)     NOT NULL CONSTRAINT DF_Pets_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt  DATETIME2(3)     NOT NULL CONSTRAINT DF_Pets_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Pets PRIMARY KEY (PetId),
        CONSTRAINT FK_Pets_Users FOREIGN KEY (OwnerId) REFERENCES dbo.Users (UserId) ON DELETE CASCADE,
        CONSTRAINT CK_Pets_Species  CHECK (Species IN ('dog','cat','other')),
        CONSTRAINT CK_Pets_Sex      CHECK (Sex IN ('male','female')),
        CONSTRAINT CK_Pets_Neutered CHECK (Neutered IN ('yes','no','unknown')),
        CONSTRAINT CK_Pets_Microchip CHECK (Microchip = '' OR (LEN(Microchip) = 15 AND Microchip NOT LIKE '%[^0-9]%'))
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Pets_Owner' AND object_id = OBJECT_ID(N'dbo.Pets'))
    CREATE INDEX IX_Pets_Owner ON dbo.Pets (OwnerId, CreatedAt);
GO

/* ---------- Health_Metrics (weights) ---------- */
IF OBJECT_ID(N'dbo.Health_Metrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Health_Metrics (
        MetricId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_HM_MetricId DEFAULT NEWID(),
        PetId      UNIQUEIDENTIFIER NOT NULL,
        MetricType VARCHAR(20)      NOT NULL,
        Value      DECIMAL(5,2)     NOT NULL,
        MeasuredOn DATE             NOT NULL,
        CreatedAt  DATETIME2(3)     NOT NULL CONSTRAINT DF_HM_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Health_Metrics PRIMARY KEY (MetricId),
        CONSTRAINT FK_HM_Pets FOREIGN KEY (PetId) REFERENCES dbo.Pets (PetId) ON DELETE CASCADE,
        CONSTRAINT CK_HM_Type  CHECK (MetricType IN ('weight')),
        CONSTRAINT CK_HM_Value CHECK (Value > 0)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_HM_Pet_Type_Date' AND object_id = OBJECT_ID(N'dbo.Health_Metrics'))
    CREATE INDEX IX_HM_Pet_Type_Date ON dbo.Health_Metrics (PetId, MetricType, MeasuredOn, CreatedAt);
GO

/* ---------- Vaccinations ---------- */
IF OBJECT_ID(N'dbo.Vaccinations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Vaccinations (
        VaccinationId  UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Vacc_Id DEFAULT NEWID(),
        PetId          UNIQUEIDENTIFIER NOT NULL,
        VaccineName    NVARCHAR(80)     NOT NULL,
        AdministeredOn DATE             NOT NULL,
        NextDueOn      DATE             NULL,
        ProviderName   NVARCHAR(120)    NOT NULL CONSTRAINT DF_Vacc_Provider DEFAULT N'',
        BatchNo        NVARCHAR(40)     NOT NULL CONSTRAINT DF_Vacc_Batch DEFAULT N'',
        Source         VARCHAR(6)       NOT NULL CONSTRAINT DF_Vacc_Source DEFAULT 'owner',
        CreatedAt      DATETIME2(3)     NOT NULL CONSTRAINT DF_Vacc_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Vaccinations PRIMARY KEY (VaccinationId),
        CONSTRAINT FK_Vacc_Pets FOREIGN KEY (PetId) REFERENCES dbo.Pets (PetId) ON DELETE CASCADE,
        CONSTRAINT CK_Vacc_Source CHECK (Source IN ('owner','clinic')),
        CONSTRAINT CK_Vacc_Dates  CHECK (NextDueOn IS NULL OR NextDueOn >= AdministeredOn)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Vacc_Pet' AND object_id = OBJECT_ID(N'dbo.Vaccinations'))
    CREATE INDEX IX_Vacc_Pet ON dbo.Vaccinations (PetId, AdministeredOn);
GO

/* ---------- Bookings (created before Medical_Records, which references it) ---------- */
IF OBJECT_ID(N'dbo.Bookings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Bookings (
        BookingId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Bookings_Id DEFAULT NEWID(),
        BookingCode   CHAR(11)         NOT NULL,            -- 'BK-' + 8 chars, shown to users
        UserId        UNIQUEIDENTIFIER NOT NULL,
        PetId         UNIQUEIDENTIFIER NULL,                -- NULL after the pet is deleted
        ServiceId     VARCHAR(50)      NOT NULL,
        PetName       NVARCHAR(40)     NOT NULL,            -- snapshots survive pet/service edits
        ServiceName   NVARCHAR(200)    NOT NULL,
        ProviderLabel NVARCHAR(260)    NOT NULL,
        PriceVnd      INT              NOT NULL,
        BookingDate   DATE             NOT NULL,
        BookingTime   CHAR(5)          NOT NULL,            -- 'HH:mm'
        Notes         NVARCHAR(500)    NOT NULL CONSTRAINT DF_Bookings_Notes DEFAULT N'',
        Status        VARCHAR(10)      NOT NULL CONSTRAINT DF_Bookings_Status DEFAULT 'pending',
        CreatedAt     DATETIME2(3)     NOT NULL CONSTRAINT DF_Bookings_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt     DATETIME2(3)     NOT NULL CONSTRAINT DF_Bookings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Bookings PRIMARY KEY (BookingId),
        CONSTRAINT UQ_Bookings_Code UNIQUE (BookingCode),
        -- NO ACTION on Users avoids a multiple-cascade-path error (Users -> Pets -> Bookings).
        CONSTRAINT FK_Bookings_Users    FOREIGN KEY (UserId)    REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_Bookings_Pets     FOREIGN KEY (PetId)     REFERENCES dbo.Pets (PetId) ON DELETE SET NULL,
        CONSTRAINT FK_Bookings_Services FOREIGN KEY (ServiceId) REFERENCES dbo.Services (ServiceId),
        CONSTRAINT CK_Bookings_Status CHECK (Status IN ('pending','confirmed','completed','cancelled')),
        CONSTRAINT CK_Bookings_Time   CHECK (BookingTime LIKE '[0-2][0-9]:[0-5][0-9]'),
        CONSTRAINT CK_Bookings_Price  CHECK (PriceVnd >= 0)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Bookings_User_Date' AND object_id = OBJECT_ID(N'dbo.Bookings'))
    CREATE INDEX IX_Bookings_User_Date ON dbo.Bookings (UserId, BookingDate, BookingTime);
-- Key-range index used by the capacity check (UPDLOCK, HOLDLOCK) in the app.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Bookings_Slot' AND object_id = OBJECT_ID(N'dbo.Bookings'))
    CREATE INDEX IX_Bookings_Slot ON dbo.Bookings (ServiceId, BookingDate, BookingTime, Status);
-- A pet cannot have two non-cancelled bookings at the same date+time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Bookings_Pet_Slot' AND object_id = OBJECT_ID(N'dbo.Bookings'))
    CREATE UNIQUE INDEX UX_Bookings_Pet_Slot ON dbo.Bookings (PetId, BookingDate, BookingTime)
    WHERE PetId IS NOT NULL AND Status <> 'cancelled';
GO

/* ---------- Medical_Records (SOAP) ---------- */
IF OBJECT_ID(N'dbo.Medical_Records', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Medical_Records (
        RecordId   UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_MR_Id DEFAULT NEWID(),
        PetId      UNIQUEIDENTIFIER NOT NULL,
        BookingId  UNIQUEIDENTIFIER NULL,
        VetId      UNIQUEIDENTIFIER NOT NULL,
        VisitDate  DATE             NOT NULL,
        Subjective NVARCHAR(2000)   NOT NULL,
        Objective  NVARCHAR(2000)   NOT NULL,
        Assessment NVARCHAR(2000)   NOT NULL,
        PlanText   NVARCHAR(2000)   NOT NULL,   -- "Plan" is a reserved word in T-SQL
        CreatedAt  DATETIME2(3)     NOT NULL CONSTRAINT DF_MR_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Medical_Records PRIMARY KEY (RecordId),
        CONSTRAINT FK_MR_Pets     FOREIGN KEY (PetId)     REFERENCES dbo.Pets (PetId) ON DELETE CASCADE,
        CONSTRAINT FK_MR_Vet      FOREIGN KEY (VetId)     REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_MR_Bookings FOREIGN KEY (BookingId) REFERENCES dbo.Bookings (BookingId)
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MR_Pet' AND object_id = OBJECT_ID(N'dbo.Medical_Records'))
    CREATE INDEX IX_MR_Pet ON dbo.Medical_Records (PetId, VisitDate);
GO
