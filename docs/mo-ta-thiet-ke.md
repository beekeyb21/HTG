# Mô tả thiết kế hệ thống HTG

> Nguồn: chuyển thể từ tài liệu thiết kế gốc "Mô tả thiết kế HTG".

## 1. Nguồn điện

- Sử dụng điện lưới **220VAC**.

## 2. Camera

- Gắn kèm mỗi đầu đo phóng xạ **1 camera** để giám sát.
- Dữ liệu camera đồng bộ về thân thiết bị.
- Số lượng: **03 camera**.

## 3. Đầu đo phóng xạ

- Ghi đo bức xạ gamma, truyền dữ liệu về thân thiết bị.
- **Đầu vào:** nguồn 12VDC.
- **Đầu ra:** giá trị đo suất liều gamma, ngưỡng cảnh báo.
- **Số lượng:** 03 đầu đo.

## 4. Cảm biến môi trường

- 01 cảm biến nhiệt độ, độ ẩm, áp suất.

## 5. Thân thiết bị

- **Nguồn vào:** 220VAC.
- Thu nhận dữ liệu từ 3 đầu đo phóng xạ.
- Thu nhận dữ liệu từ 3 camera.
- Cấp nguồn và thu nhận dữ liệu từ cảm biến nhiệt độ, độ ẩm, áp suất.
- Phân thành **3 vùng** tương ứng với 3 đầu đo. Mỗi vùng hiển thị:
  - Giá trị đo suất liều gamma trên màn hình.
  - Đèn trạng thái cảnh báo (xanh, vàng, đỏ).
  - Còi cảnh báo khi có cảnh báo.

| Vị trí 1 | Vị trí 2 |
|---|---|
| Vị trí 3 | |

## 6. Phần mềm trên máy tính

- Thu nhận dữ liệu từ thân thiết bị. Hiển thị lên giao diện phần mềm.
- Giao diện phân thành **3 vùng** tương ứng với 3 đầu đo, mỗi vùng hiển thị giá trị đo suất liều gamma trên màn hình, kết hợp hình ảnh camera của từng vị trí.

| Vị trí 1 | Vị trí 2 |
|---|---|
| Vị trí 3 | |

- Khi có cảnh báo: phát tín hiệu đèn, còi tương ứng, đồng thời chụp lại hình ảnh camera tại thời điểm cảnh báo theo chu kỳ **10 giây/1 hình ảnh**.
- Lưu trữ giá trị đo suất liều cùng với hình ảnh tại từng thời điểm.
