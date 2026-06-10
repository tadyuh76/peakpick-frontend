# PeakPick Frontend

Frontend SolidJS + Vite cho demo PeakPick. Frontend chỉ gọi API Gateway, không gọi trực tiếp các microservice nội bộ.

## Trách Nhiệm

- Hiển thị catalog và checkout mock.
- Hiển thị trạng thái đơn cho khách.
- Hiển thị board xử lý cho nhân viên.
- Hiển thị notification và analytics demo.

## Chạy Local

```bash
npm install
npm run dev
```

Biến môi trường chính:

```text
VITE_API_BASE_URL=http://localhost:8000
VITE_ALLOWED_HOSTS=localhost
```
