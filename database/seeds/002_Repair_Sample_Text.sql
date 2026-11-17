/* =============================================================================
   PetCare AI Hub - seed: REPAIR SAMPLE TEXT (UTF-8 encoding repair)
   Repairs corrupted Vietnamese characters in Providers and Services.
   Idempotent: updates existing sample rows (IsSample = 1) without touching IsSample = 0.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

MERGE dbo.Providers WITH (HOLDLOCK) AS t
USING (VALUES
    ('petcare-central',   N'Bệnh viện PetCare Central',  N'Quận 1'),
    ('furry-spa',         N'Furry Spa & Grooming Lab',   N'Thảo Điền'),
    ('green-paw',         N'Green Paw Eco Resort',       N'Quận 7'),
    ('saigon-vet-clinic', N'Saigon Vet Clinic',          N'Bình Thạnh')
) AS s (ProviderId, Name, Area)
ON t.ProviderId = s.ProviderId
WHEN MATCHED AND t.IsSample = 1 THEN
    UPDATE SET t.Name = s.Name, t.Area = s.Area;
GO

MERGE dbo.Services WITH (HOLDLOCK) AS t
USING (VALUES
    ('medical-general', N'Khám & điều trị', N'Khám sức khỏe tổng quát & siêu âm',        N'lượt khám'),
    ('vaccine-combo',   N'Tiêm chủng',      N'Tiêm vắc-xin 7 bệnh & Dại',                N'mũi tiêm'),
    ('deworming',       N'Phòng bệnh',      N'Tẩy giun định kỳ & tầm soát ký sinh trùng', N'liệu trình'),
    ('sterilization',   N'Phẫu thuật',      N'Triệt sản & chăm sóc hậu phẫu',            N'gói phẫu thuật'),
    ('spa-combo',       N'Spa & làm đẹp',   N'Combo tắm sục thảo mộc & cắt tỉa',         N'combo'),
    ('hotel-stay',      N'Lưu trú',         N'Khách sạn điều hòa 24/7 & camera',         N'ngày đêm'),
    ('eco-resort',      N'Lưu trú',         N'Khách sạn sân vườn & vận động',            N'ngày')
) AS s (ServiceId, CategoryLabel, Name, Unit)
ON t.ServiceId = s.ServiceId
WHEN MATCHED AND t.IsSample = 1 THEN
    UPDATE SET t.CategoryLabel = s.CategoryLabel, t.Name = s.Name, t.Unit = s.Unit;
GO
