# Task Manager

Task Manager là ứng dụng web tĩnh dùng để quản lý công việc cá nhân ngay trong trình duyệt.

Phiên bản hiện tại: v2.0.0

## Chức năng cơ bản

- Thêm và xóa công việc.
- Đánh dấu công việc đã hoàn thành hoặc chưa hoàn thành.
- Hiển thị tổng số công việc và số công việc đã hoàn thành.
- Lưu dữ liệu bằng `localStorage` của trình duyệt.

## RQ-001 – Xử lý dữ liệu hỏng

Ứng dụng kiểm tra dữ liệu khi khởi động. Dữ liệu sai JSON hoặc sai cấu trúc được cách ly sang một khóa sao lưu trước khi khóa dữ liệu chính được xóa. Nếu không thể sao lưu, dữ liệu gốc vẫn được giữ nguyên và ứng dụng mở an toàn với danh sách rỗng.

## RQ-002 – Lưu trữ version 2

Dữ liệu cũ dạng mảng được sao lưu và tự động chuyển sang schema version 2 mà không làm mất ID, tên, trạng thái hoặc thứ tự công việc. Dữ liệu từ phiên bản ứng dụng mới hơn được mở ở chế độ chỉ đọc để tránh ghi đè không tương thích.

## RQ-003 – Quản lý công việc nâng cao

- Sửa tên công việc trực tiếp.
- Tìm kiếm không phân biệt chữ hoa và chữ thường.
- Lọc tất cả, chưa hoàn thành hoặc đã hoàn thành.
- Sắp xếp theo mới nhất, cũ nhất, tên A–Z hoặc tên Z–A.

Tìm kiếm, lọc và sắp xếp chỉ thay đổi cách hiển thị, không thay đổi thứ tự dữ liệu đã lưu.

## RQ-004 – Sao lưu và khôi phục

Ứng dụng có thể xuất bản sao lưu JSON và khôi phục từ file `.json` hợp lệ có kích thước tối đa 1 MB. Trước khi ghi đè, ứng dụng yêu cầu xác nhận và tạo một bản sao an toàn của dữ liệu hiện tại.

## Cấu trúc dữ liệu version 2

```json
{
  "version": 2,
  "tasks": [
    {
      "id": 1710000000000,
      "name": "Ví dụ công việc",
      "completed": false,
      "createdAt": "2026-07-12T10:00:00.000Z",
      "updatedAt": "2026-07-12T10:00:00.000Z"
    }
  ]
}
```

`id` có thể là số hoặc chuỗi hợp lệ. `createdAt` và `updatedAt` sử dụng định dạng ISO datetime.

## Cách chạy ứng dụng

1. Mở thư mục dự án.
2. Mở tập tin `index.html` bằng trình duyệt.
3. Nhập tên công việc và bấm nút `Thêm`.

Ứng dụng không yêu cầu cài đặt dependency hoặc backend.

## Kiểm tra cú pháp và kiểm thử

```bash
npm run check
npm test
```

## Lưu ý về dữ liệu

Dữ liệu được lưu trong `localStorage` với khóa `taskManagerTasks`, phụ thuộc vào trình duyệt, hồ sơ người dùng và địa chỉ mở ứng dụng. Nên xuất file sao lưu JSON trước khi xóa dữ liệu trình duyệt hoặc chuyển sang môi trường khác.
