/* =============================================================================
   PetCare AI Hub - 002_Create_AI_Knowledge.sql
   Run after 001. Idempotent. Rows are written by backend/scripts/ingest-knowledge.js
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID(N'dbo.Knowledge_Chunks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Knowledge_Chunks (
        ChunkId       INT IDENTITY(1,1) NOT NULL,
        DocSlug       VARCHAR(100)      NOT NULL,
        DocTitle      NVARCHAR(200)     NOT NULL,
        ChunkIndex    INT               NOT NULL,
        Content       NVARCHAR(MAX)     NOT NULL,
        EmbeddingJson NVARCHAR(MAX)     NOT NULL,   -- JSON array of floats
        ReviewStatus  VARCHAR(30)       NOT NULL CONSTRAINT DF_KC_Review DEFAULT 'pending-veterinary-review',
        CreatedAt     DATETIME2(3)      NOT NULL CONSTRAINT DF_KC_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_Knowledge_Chunks PRIMARY KEY (ChunkId),
        CONSTRAINT UQ_KC_Doc_Chunk UNIQUE (DocSlug, ChunkIndex),
        CONSTRAINT CK_KC_Review CHECK (ReviewStatus IN ('pending-veterinary-review','approved','rejected')),
        CONSTRAINT CK_KC_Json CHECK (ISJSON(EmbeddingJson) = 1)
    );
END
GO
