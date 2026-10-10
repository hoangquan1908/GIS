# Đưa website lên Internet bằng Render

Sau khi triển khai thành công, website chạy trên máy chủ Render. Máy tính cá nhân có thể tắt; người xem dùng đường dẫn HTTPS được Render cấp.

## Cách triển khai

1. Đăng nhập GitHub và tạo repository cho đề tài. Có thể để repository private.
2. Đưa `public/`, `data/sites.geojson`, `data/sources.json`, `server.mjs`, `weather-cache.mjs`, `package.json`, `render.yaml` lên repository, giữ nguyên cấu trúc thư mục. Đây là các tệp cần cho web; không cần tải dữ liệu khảo sát cá nhân hoặc thông tin đăng nhập.
3. Đăng nhập https://dashboard.render.com, chọn **New → Blueprint**, kết nối repository vừa tạo. Render đọc cấu hình `render.yaml`.
4. Kiểm tra dịch vụ `hadong-flood-lab`, gói **Free**, rồi triển khai. Nếu tạo **Web Service** thủ công: Runtime Node; Build Command `node --check server.mjs`; Start Command `node server.mjs`; biến môi trường `HOST=0.0.0.0`, `NODE_VERSION=24`.
5. Chờ trạng thái **Live** và mở đường dẫn HTTPS Render cấp. Chỉ đường dẫn được cấp sau khi triển khai mới là địa chỉ web thực tế.
6. Kiểm tra bản đồ, cập nhật mưa và kịch bản bằng điện thoại qua mạng di động. Sau đó có thể tắt máy tính và kiểm tra lại đường dẫn.

## Điều cần biết

- Gói Free ngủ sau 15 phút không có truy cập; lượt truy cập tiếp theo đánh thức dịch vụ, có thể mất khoảng một phút. Việc này không phụ thuộc máy tính cá nhân. Xem https://render.com/docs/free.
- Cấu hình chỉ định gói Free, không tự đăng ký gói trả phí. Nếu cần phản hồi ngay sau thời gian dài không truy cập, cân nhắc gói không ngủ sau khi kiểm tra giá.
- Mã nguồn hiện không có cơ sở dữ liệu hoặc chức năng lưu thông tin người dùng. Không dùng ổ đĩa tạm của Render để lưu dữ liệu khảo sát cần bảo toàn.
- Mặc định chạy cục bộ vẫn chỉ mở ở 127.0.0.1. Cấu hình HOST trên Render cho phép nền tảng nhận lưu lượng công khai.
- Trạng thái hiện tại: **đã chuẩn bị cấu hình, chưa triển khai lên tài khoản hosting**.

Tài liệu: https://render.com/docs/web-services và https://render.com/docs/blueprint-spec.
