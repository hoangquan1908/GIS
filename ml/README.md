# AI nghiên cứu mưa và dự báo ngập

## Đã huấn luyện: mô hình mưa hồi cứu

Chạy `python ml/rain_benchmark.py` sau `node scripts/download-history.mjs`. Nguồn là ERA5 qua Open-Meteo, 52.608 giờ từ 2020 đến hết 2025. Đây là dữ liệu tái phân tích, không phải quan trắc tại Hà Đông và không có sẵn đúng thời điểm phát hành dự báo trong quá khứ.

Mục tiêu: tổng mưa tại t+1, t+2, t+3. Đặc trưng chỉ dùng các giờ đến t: mưa trễ/tổng 3,6,12,24h, nhiệt độ, độ ẩm, áp suất, chu kỳ giờ và năm. Huấn luyện 2020–2023; chọn mô hình bằng MAE năm 2024; chỉ đánh giá cuối trên năm 2025. Loại các cửa sổ nhãn vượt qua mốc chia. Không chọn lại thuật toán theo điểm số năm 2025.

So sánh hai HistGradientBoosting với ba baseline: không mưa, duy trì mưa 3h vừa qua, trung bình mùa/giờ học từ tập train. Báo cáo MAE, RMSE, bias, MAE trên cửa sổ có mưa, recall/precision cho ngưỡng nghiên cứu 10 mm/3h, và khoảng bootstrap theo ngày. Ngưỡng 10 mm/3h không phải cấp cảnh báo chính thức. Các cửa sổ chồng lấn không phải các trận mưa độc lập.

Kết quả công khai ở `data/rain-model-report.json`; mô hình và dự đoán từng giờ ở `ml/artifacts/` (không đưa lên Git). Mô hình này KHÔNG được gọi làm AI ngập trực tiếp trên web; cần dữ liệu dự báo lưu trữ theo thời điểm phát hành và quan trắc độc lập để đánh giá vận hành.

## Dự báo ngập: quy trình đã nâng cấp, còn thiếu nhãn

Mẫu CSV trống: `data/flood-observations-template.csv`. Lưu dữ liệu khảo sát thực tế trong `data/private/` (không công khai). Không tạo nhãn ngập từ công thức lượng mưa.

- Một dòng là **vị trí × thời điểm phát hành × hạn dự báo**. Một lần huấn luyện chỉ dùng một hạn 1, 2 hoặc 3 giờ.
- `issued_at`, `target_at`, `features_available_at`, `forecast_issued_at`: ISO 8601 có múi giờ, ví dụ `2025-09-30T10:00:00+07:00`. target_at = issued_at + horizon_hours.
- `features_available_at`: thời điểm muộn nhất mà toàn bộ đặc trưng đầu vào thực sự đã sẵn sàng. Không được lớn hơn issued_at.
- `forecast_issued_at`: thời điểm phát hành dự báo đã lưu trữ, không phải thời điểm tải lại dữ liệu. Không dùng tái phân tích làm dự báo phát hành trong quá khứ.
- `rain_1h_mm,rain_3h_mm,rain_24h_mm`: cửa sổ kết thúc tại issued_at, đơn vị mm; tổng 24h ≥ 3h ≥ 1h.
- `forecast_rain_mm`: lượng mưa dự báo trong đúng horizon_hours tiếp theo, từ phiên dự báo có sẵn khi phát hành.
- `latitude,longitude`: tọa độ WGS84 đã kiểm tra; một site_id ứng với một tọa độ.
- `elevation_m`: cao độ nguồn thống nhất; `impervious_fraction`: tỷ lệ mặt không thấm 0–1 trong vùng đệm định nghĩa trước; `distance_drain_m`: khoảng cách đến đối tượng thoát nước đã xác minh.
- `flood_depth_cm`: độ sâu đo/xác nhận tại target_at. Mặc định nghiên cứu coi ≥10 cm là nhãn flooded=1, dưới 10 cm là 0; có thể đổi bằng --depth-threshold-cm. Cần chốt định nghĩa với người hướng dẫn. 0 không nhất thiết nghĩa là hoàn toàn khô.
- `verification_status=verified`, `boundary_verified=true`: chỉ ghi sau khi thực sự đối chiếu nguồn và địa giới chính thức.
- `observation_source`: mã biên bản/nguồn kiểm chứng nhãn; `feature_source`: tham chiếu bộ đặc trưng, nguồn mưa và phiên dự báo. Không đưa tên/số điện thoại cư dân vào mẫu công khai.
- `event_id`: cùng một sự kiện mưa phải cùng mã giữa mọi vị trí; bao gồm các sự kiện có mẫu không đạt ngưỡng ngập.

```powershell
python -m pip install -r ml/requirements.txt
python ml/train.py data/private/observations.csv --depth-threshold-cm 10
```

Script kiểm tra rò rỉ thời gian, nguồn, tọa độ, nhãn–độ sâu, đơn vị và giá trị thiếu; chia sự kiện theo thời gian 60/20/20 với khoảng cách tối thiểu 24h để tránh chồng lấn cửa sổ đặc trưng. Tối thiểu phần mềm: 10 sự kiện và mỗi tập có ≥5 mẫu mỗi lớp; đây không phải khẳng định đủ dữ liệu khoa học.

So sánh Random Forest và Logistic Regression; chọn bằng average precision tập giữa, hiệu chỉnh sigmoid và chọn ngưỡng theo F2 trên tập giữa. Báo cáo cuối chỉ dùng tập cuối chưa đụng tới, gồm PR-AUC (average precision), ROC-AUC, Brier, precision, recall, F1, F2, confusion matrix và baseline tần suất. Cần kiểm định thêm theo khu vực chưa thấy và vận hành tiền cứu. Không tự kích hoạt mô hình trên web.

Các cờ verified không chứng minh dữ liệu đúng nếu khai sai: vẫn phải kiểm tra hồ sơ nguồn và khảo sát. Không có độ chính xác dự báo ngập khi chưa có bộ nhãn thật.
