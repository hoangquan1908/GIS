# Hà Đông Flood Lab 2.0

Không gian nghiên cứu ngập úng Hà Đông, Hà Nội, với giao diện tiếng Việt cho máy tính và điện thoại. Web chạy bằng **Node.js 20 trở lên**, không cần `npm install` hoặc thư viện npm bên ngoài.

## Mở website

Trên Windows, nhấp đúp **`start.cmd`** để khởi động máy chủ nền và mở trình duyệt. Nếu máy chủ đã chạy, tệp mở lại website. Có thể đóng cửa sổ khởi động mà không dừng máy chủ.

Để tự quản lý máy chủ, khi chưa chạy nền, mở terminal tại thư mục dự án:

```powershell
node server.mjs
```

Truy cập **http://localhost:3000**; dừng bằng Ctrl+C. Máy chủ mặc định chỉ lắng nghe trên máy cá nhân. Cần Internet để tải Leaflet, bản đồ nền OpenStreetMap và dự báo Open-Meteo.

## Giao diện và cách sử dụng

- **Tổng quan:** thanh điều hướng, chỉ số nhanh, trạng thái dữ liệu và nút cập nhật; bố cục tự thích ứng trên điện thoại.
- **Bản đồ:** bật/tắt lớp địa điểm, sông hồ, đường, hạ tầng và báo cáo; tìm địa điểm có hoặc không dấu, lọc nguy cơ, xem chi tiết và định vị thiết bị khi được cấp quyền.
- **Dự báo mưa:** chọn 6/12/24 giờ, xem biểu đồ và bảng, tổng mưa và giờ mưa lớn nhất; xuất CSV/JSON hoặc in/lưu PDF qua trình duyệt.
- **Kịch bản:** điều chỉnh cường độ mưa và mốc 30 phút–3 giờ; có thể nạp giờ mưa dự báo lớn nhất, xem diễn biến giả định và hai tuyến đường mẫu.
- **Chia sẻ bộ lọc:** sao chép liên kết lưu các tham số `rain`, `horizon`, `hours`, `q`, `risk`. Mở lại liên kết sẽ khôi phục thiết lập; báo cáo cá nhân và ảnh không nằm trong liên kết.

Dự báo lấy dữ liệu thật từ Open-Meteo tại điểm đại diện **20.9708, 105.7788**, hiển thị theo UTC+7 và tự cập nhật mỗi **15 phút khi tab đang hiển thị**. Có cache và giới hạn thời gian chờ. Khi thiếu dữ liệu hoặc mất kết nối, giao diện báo lỗi/thiếu dữ liệu, không tự tạo thời tiết và không biến lượng mưa thiếu thành 0. Dữ liệu giả lập chỉ được dùng riêng trong kiểm thử.

## Nhật ký báo ngập và sao lưu

Báo cáo lưu trong **`localStorage` của trình duyệt hiện tại**, chưa gửi tới cộng đồng hoặc cơ quan chức năng. Mọi báo cáo mang trạng thái **chưa xác minh** (`unverified`). Có thể tìm lại báo cáo theo tên người ghi nhận, địa điểm hoặc mô tả.

Ảnh JPEG, PNG hoặc WebP tối đa **1 MB** mỗi ảnh. Tọa độ là tùy chọn: nếu không chọn trên bản đồ, giá trị được lưu là `null`, không tự gán một địa điểm. Nội dung đang nhập và tọa độ được lưu nháp bằng **`sessionStorage` trong tab hiện tại**; ảnh không lưu vào bản nháp và phải chọn lại sau khi tải trang.

Dùng **Xuất báo cáo JSON** để sao lưu. **Nhập bản sao lưu** nhận tệp JSON tối đa **8 MB**, kiểm tra dữ liệu, gộp với nhật ký hiện tại và bỏ qua mục trùng, không ghi đè báo cáo đã có. Dung lượng lưu trữ phụ thuộc trình duyệt; khi đầy, thử bỏ ảnh. Xóa dữ liệu trình duyệt có thể làm mất nhật ký, nên xuất bản sao lưu trước.

API `/api/community-reports` là luồng lưu báo cáo riêng trên máy chủ, **không tự đồng bộ** với nhật ký trên trình duyệt.

## Phạm vi dữ liệu

Bản đồ địa điểm và hạ tầng là dữ liệu tham chiếu nghiên cứu. Nguy cơ, độ sâu, vùng lan, diễn biến theo thời gian và tuyến đường là **mô phỏng chưa kiểm định**, không mô tả tình trạng ngập hiện tại hoặc xác nhận đường có thể đi. Công thức thử nghiệm chưa phải mô hình AI đã huấn luyện; dự báo mưa ở một ô mô hình không đủ để kết luận riêng cho từng đường phố.

Chưa có ranh giới phường đã xác minh, mô hình thủy lực hay hệ thống cảnh báo vận hành. Không dùng toàn bộ quận Hà Đông cũ làm ranh giới phường hiện nay. Đây là công cụ nghiên cứu, không thay thế thông báo của cơ quan chức năng.

Nguồn được ghi trong `data/sources.json`; giao diện ghi công OpenStreetMap contributors và Open-Meteo. Dữ liệu mưa lịch sử 2025 là tái phân tích ERA5, không phải trạm đo; tệp dự báo tải về là ảnh chụp tại thời điểm tải. Web không âm thầm dùng ảnh chụp cũ thay cho nguồn hiện hành.

## Phát triển và kiểm tra

`public/` là nguồn giao diện chính. Sau khi sửa tài nguyên tĩnh, đồng bộ các bản sao ở thư mục gốc:

```powershell
node scripts/sync-static.mjs
node --test tests/*.test.mjs
node scripts/verify-browser.mjs
```

`npm test` chạy kiểm tra logic và API. `npm run test:browser` cần **Node.js 22 trở lên** có `WebSocket` toàn cục và Chrome/Edge; chạy headless bằng hồ sơ tạm riêng, dọn hồ sơ sau kiểm thử và lưu kết quả hình ảnh trong `artifacts/`. Script kiểm tra tương tác, giao diện máy tính/điện thoại và tình huống mất nguồn dữ liệu; thời tiết dùng fixture kiểm thử. Nếu không tự tìm thấy trình duyệt, đặt đường dẫn trước khi chạy:

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/verify-browser.mjs
```

Các tệp chính: `public/` chứa giao diện và logic; `server.mjs` phục vụ web/API; `data/` chứa dữ liệu tham chiếu và nguồn; `scripts/` chứa công cụ vận hành; `tests/` chứa kiểm tra; `ml/README.md` hướng dẫn huấn luyện khi có dữ liệu ngập được xác minh.

Tải dữ liệu nghiên cứu bằng `node scripts/download-data.mjs`. Để phát triển thành mô hình dự báo, cần xác minh phạm vi nghiên cứu, khảo sát địa hình/thoát nước, thu thập nhiều sự kiện ngập và không ngập độc lập, rồi đánh giá theo thời gian và vị trí trước khi công bố độ chính xác hoặc ngưỡng cảnh báo.

### Đồng bộ kịch bản với dự báo

Nút **Mưa: Theo dự báo** nạp lượng mưa của giờ dự báo gần nhất làm đầu vào kịch bản. Kéo thanh mưa hoặc chọn giờ mưa lớn nhất sẽ chuyển sang thủ công để không ghi đè lựa chọn khi cập nhật. Chế độ được giữ trong liên kết (auto=1 hoặc auto=0); liên kết cũ chỉ có rain vẫn mở ở chế độ thủ công. Khi nguồn thời tiết lỗi hoặc thiếu giờ mưa, ứng dụng giữ nguyên kịch bản và hiển thị trạng thái chờ/lỗi.

Bảng trên bản đồ dùng cùng lượng mưa và khoảng thời gian với kịch bản. Vùng tô màu chỉ minh họa kịch bản, không phải radar mưa hay số đo trạm. Âm thanh chỉ phát khi chuyển sang mức cảnh báo khác ở mức cao, có thể bật/tắt bằng hai nút đồng bộ.

Nếu PowerShell chặn npm.ps1, dùng các lệnh node ở trên hoặc npm.cmd test, không cần thay đổi chính sách PowerShell.
