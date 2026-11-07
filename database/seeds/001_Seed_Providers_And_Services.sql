/* =============================================================================
   PetCare AI Hub - seed: ILLUSTRATIVE providers and services (IsSample = 1).
   Copied from the prototype catalog. These are placeholders, not real partners.
   Idempotent: existing rows are left untouched. No users/pets/bookings are seeded.
   ============================================================================= */
USE PetCareAIHub;
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
MERGE dbo.Providers WITH (HOLDLOCK) AS t
USING (VALUES
    ('petcare-central',   N'Bệnh viện PetCare Central',  N'Quận 1',     'clinic'),
    ('furry-spa',         N'Furry Spa & Grooming Lab',   N'Thảo Điền',  'spa'),
    ('green-paw',         N'Green Paw Eco Resort',       N'Quận 7',     'hotel'),
    ('saigon-vet-clinic', N'Saigon Vet Clinic',          N'Bình Thạnh', 'clinic')
) AS s (ProviderId, Name, Area, Type)
ON t.ProviderId = s.ProviderId
WHEN NOT MATCHED BY TARGET THEN
    INSERT (ProviderId, Name, Area, Type, IsSample, IsActive)
    VALUES (s.ProviderId, s.Name, s.Area, s.Type, 1, 1);
GO
MERGE dbo.Services WITH (HOLDLOCK) AS t
USING (VALUES
    ('medical-general', 'petcare-central',   'medical',  N'Khám & điều trị', N'Khám sức khỏe tổng quát & siêu âm',        250000, N'lượt khám'),
    ('vaccine-combo',   'petcare-central',   'medical',  N'Tiêm chủng',      N'Tiêm vắc-xin 7 bệnh & Dại',                210000, N'mũi tiêm'),
    ('deworming',       'saigon-vet-clinic', 'medical',  N'Phòng bệnh',      N'Tẩy giun định kỳ & tầm soát ký sinh trùng', 120000, N'liệu trình'),
    ('sterilization',   'petcare-central',   'medical',  N'Phẫu thuật',      N'Triệt sản & chăm sóc hậu phẫu',            650000, N'gói phẫu thuật'),
    ('spa-combo',       'furry-spa',         'grooming', N'Spa & làm đẹp',   N'Combo tắm sục thảo mộc & cắt tỉa',         320000, N'combo'),
    ('hotel-stay',      'green-paw',         'hotel',    N'Lưu trú',         N'Khách sạn điều hòa 24/7 & camera',         180000, N'ngày đêm'),
    ('eco-resort',      'green-paw',         'hotel',    N'Lưu trú',         N'Khách sạn sân vườn & vận động',            280000, N'ngày')
) AS s (ServiceId, ProviderId, Category, CategoryLabel, Name, PriceVnd, Unit)
ON t.ServiceId = s.ServiceId
WHEN NOT MATCHED BY TARGET THEN
    INSERT (ServiceId, ProviderId, Category, CategoryLabel, Name, PriceVnd, Unit, IsSample, IsActive)
    VALUES (s.ServiceId, s.ProviderId, s.Category, s.CategoryLabel, s.Name, s.PriceVnd, s.Unit, 1, 1);
GO
