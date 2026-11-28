# PetCare AI Hub - Backend

Express 4 + SQL Server (`mssql`) + Gemini REST (embeddings + generate) cho RAG. Hợp đồng API: `../docs/api/api-documentation.md` (gồm mục "Ghi chú triển khai").

## Thiết lập
```
cd backend
npm install
cp .env.example .env        # điền DB_*, JWT_SECRET, GEMINI_API_KEY
```
1. Chạy các script trong `../database` (xem `../database/README.md`).
2. `npm run ingest` để nạp `docs/knowledge-base/*.md` (cần DB + `GEMINI_API_KEY`; `npm run ingest -- --dry-run` chỉ chia chunk, không gọi mạng/DB). Chạy lại khi sửa tài liệu.
3. `npm start` rồi mở `http://localhost:3000` (frontend cùng origin khi `SERVE_FRONTEND=true`).

Production (`NODE_ENV=production`) từ chối khởi động nếu `JWT_SECRET` ngắn hơn 32 ký tự hoặc giống giá trị mẫu.

### Lưu ý quan trọng về Reverse Proxy (`TRUST_PROXY`)
Khi chạy ứng dụng sau reverse proxy (như Nginx, Cloudflare, Traefik, AWS ALB hoặc Docker Swarm/Kubernetes Ingress), **bắt buộc phải cấu hình biến môi trường `TRUST_PROXY`** (ví dụ: `TRUST_PROXY=1` hoặc `TRUST_PROXY=true`).
- **Lý do kỹ thuật:** Express dựa vào cấu hình `trust proxy` để đọc header `X-Forwarded-For`. Nếu không bật, `req.ip` sẽ luôn nhận địa chỉ IP của reverse proxy thay vì IP thật của client.
- **Hậu quả:** Toàn bộ người dùng trên Internet sẽ bị coi là chung một địa chỉ IP, khiến các tầng rate limit (`/auth/register`, `/auth/login`, `/auth/me`) tính chung một hạn mức và đồng loạt chặn tất cả người dùng bằng mã lỗi `429 rate_limited`.

## Biến môi trường
Xem `.env.example`. Mặc định: `GEMINI_MODEL=gemini-2.5-flash`, `GEMINI_EMBED_MODEL=gemini-embedding-001` (768 chiều, `GEMINI_EMBED_DIM`), `RAG_TOP_K=4`, `RAG_MIN_SCORE=0.6` (ngưỡng cần hiệu chỉnh trên dữ liệu thật), `APP_TIMEZONE=Asia/Ho_Chi_Minh`. Tên model là mặc định chưa được kiểm chứng với tài khoản Gemini của bạn; đổi trong env nếu cần.

### Lưu trữ ảnh (`STORAGE_DRIVER`)
- `STORAGE_DRIVER`: `local` (mặc định dev/CI) hoặc `cloudinary` (production).
- `UPLOAD_DIR`: thư mục lưu ảnh khi dùng `local` (mặc định `backend/uploads`). **Nhớ sao lưu `UPLOAD_DIR`** định kỳ khi dùng `local`.
- `UPLOAD_MAX_BYTES`: giới hạn dung lượng tệp tải lên (mặc định `5242880` = 5 MB).
- `PUBLIC_BASE_URL`: origin công khai để ghép URL ảnh `/uploads/...` khi dùng `local` (tùy chọn).
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: bắt buộc khi `STORAGE_DRIVER=cloudinary`.
- Kiểm thử upload trên SQL Server thật: `node backend/scripts/smoke-uploads.js`.
- Chuyển ảnh Base64 cũ sang storage: `node backend/scripts/migrate-photos.js --dry-run` rồi `node backend/scripts/migrate-photos.js` (chạy với `STORAGE_DRIVER=cloudinary` khi đưa lên production).

## Kiểm thử
`npm test` (node --test; không cần mạng hay SQL Server; dùng `tests/helpers/fake-models.js`, một test double trong bộ nhớ). `npm run check-sql` kiểm tra cú pháp T-SQL một phần.

## Kiến trúc
`server.js` nối mô hình mssql thật -> `createApp({ models, config, ai, clock? })` (`src/app.js`). Services là factory nhận phụ thuộc; controllers mỏng; mọi SQL tham số hóa; giao dịch cho (thú cưng + cân nặng đầu tiên) và (kiểm tra sức chứa + thêm lịch với `UPDLOCK, HOLDLOCK`). "Hôm nay/bây giờ" luôn theo `APP_TIMEZONE` (`src/utils/time.js`).

## Ví dụ curl
```
B=http://localhost:3000/api/v1
curl -s $B/auth/register -H 'Content-Type: application/json' \
  -d '{"role":"customer","fullName":"Nguyễn Văn A","email":"a@gmail.com","phone":"0912345678","password":"matkhau123"}'
TOKEN=$(curl -s $B/auth/login -H 'Content-Type: application/json' -d '{"identifier":"a@gmail.com","password":"matkhau123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
curl -s $B/services
curl -s "$B/services/medical-general/slots?date=2026-12-01"
curl -s $B/pets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Bơ","species":"dog","sex":"male","birthDate":"2024-01-15","weightKg":11.5}'
curl -s $B/dashboard/customer -H "Authorization: Bearer $TOKEN"
curl -s $B/ai/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"message":"Chó của tôi nôn 2 lần"}'
```
`/ai/chat` trả 503 `ai_unavailable` nếu thiếu `GEMINI_API_KEY`, chưa nạp tài liệu hoặc Gemini lỗi; không bao giờ trả câu trả lời giả lập.

## Chưa được kiểm chứng
Chưa chạy với SQL Server thật và chưa gọi Gemini thật (không có trong môi trường phát triển). Lớp mssql (`src/models/*.model.js`), script SQL, định dạng request/response Gemini và chất lượng truy hồi RAG cần được thử trên môi trường thật. Tài liệu tri thức ở trạng thái `pending-veterinary-review`: cần bác sĩ thú y duyệt trước khi dùng cho người dùng thật.
