# Thiết kế: Hoàn thiện demo HTG Monitoring

> Ngày: 2026-07-14 · Trạng thái: đã duyệt

## Bối cảnh

Phần mềm giám sát hiện tại là bản dựng giao diện chạy trên dữ liệu giả. Đối chiếu với mục 6
của [`docs/mo-ta-thiet-ke.md`](../../mo-ta-thiet-ke.md) ("Phần mềm trên máy tính"), có bốn yêu cầu
chưa được đáp ứng:

| Yêu cầu | Hiện trạng |
|---|---|
| Kết hợp hình ảnh camera của từng vị trí | Ô `div` trống, không có nguồn hình ảnh |
| Còi cảnh báo | Không có dòng code âm thanh nào |
| Chụp ảnh 10s/lần khi cảnh báo | Có hẹn giờ, nhưng ghi tên file giả và đóng băng giá trị đo |
| Lưu trữ suất liều kèm ảnh theo thời điểm | Mảng trong RAM, không ai xem được |

Ngoài ra bộ mô phỏng có lỗi khiến demo tự hỏng: `baseline[i] = baseline[i]*0.7 + dose*0.3`
(`src/js/mock-data.js:42`) là random walk **không có lực hồi quy**. Mỗi spike đỏ bị trộn vĩnh viễn
vào nền và không bao giờ giảm lại. Đo thực tế trên 300 tick (10 phút): nền tăng từ ~0,2 lên
0,67–1,0 µSv/h chỉ sau 2 phút; trong 900 lần đọc có 782 lần vàng, 53 lần đỏ, chỉ 65 lần xanh.
Demo mở lâu sẽ kẹt báo động vĩnh viễn.

## Mục tiêu

Demo dùng để **trình bày cho khách hàng và đối tác**. Ba tiêu chí thành công:

1. Trông giống hệ thống thật — có hình ảnh camera, có còi kêu được.
2. Chạy ổn định 30 phút không tự hỏng.
3. Người trình bày chủ động được nhịp kể chuyện, không phải chờ may mắn.

## Ngoài phạm vi

Kết nối API/WebSocket thật, cơ sở dữ liệu, xác thực đăng nhập, xuất PDF/Excel, cấu hình ngưỡng
theo từng đầu đo. Đây là các mục thuộc roadmap sản phẩm trong `README.md`, không thuộc demo.

## Kiến trúc

Giữ nguyên nguyên tắc sẵn có của dự án — tách **nguồn dữ liệu** khỏi **hiển thị** — và mở rộng
nguyên tắc đó cho hai nguồn mới là hình ảnh và âm thanh. Kết quả: bốn module, mỗi module một
trách nhiệm.

| Module | Trách nhiệm | Interface công khai |
|---|---|---|
| `js/mock-data.js` (sửa) | Sinh suất liều 3 vùng + cảm biến môi trường | `onUpdate(cb)`, `start()`, `forceAlert(zoneId, level)`, `resetAll()` |
| `js/camera.js` (mới) | Vẽ hình camera, chụp khung hình | `mount(zoneId, el)`, `setStatus(zoneId, status)`, `grabFrame(zoneId) → dataURL` |
| `js/alarm.js` (mới) | Còi cảnh báo | `unlock()`, `setLevel(status)`, `setMuted(bool)` |
| `js/app.js` (sửa) | Điều phối, hiển thị, lưu trữ bằng chứng | — |

Ranh giới quan trọng: `app.js` **không biết** hình ảnh đến từ canvas mô phỏng hay camera thật, và
**không biết** tiếng còi là oscillator hay file âm thanh. Khi cắm phần cứng thật, thay phần ruột
của `camera.js` mà không phải sửa `app.js`.

## Thiết kế chi tiết

### 1. Render tại chỗ thay vì dựng lại DOM

`renderZones()` hiện ghi đè `zonesContainer.innerHTML` mỗi 2 giây. Đây **không phải lỗi thẩm mỹ mà
là lỗi chặn**: nếu gắn `<canvas>` camera vào thẻ vùng, cứ 2 giây nó lại bị xóa và dựng lại — vòng
lặp vẽ mất tham chiếu, ảnh chụp ra khung đen. Không sửa việc này thì không làm được camera.

Thiết kế mới: dựng khung ba thẻ vùng **một lần duy nhất** lúc khởi động và giữ tham chiếu tới các
phần tử con. Mỗi tick chỉ ghi đè phần thay đổi — text suất liều, class trạng thái, số đếm ảnh.
Một thay đổi này sửa luôn lỗi "bộ đếm ảnh bị xóa mỗi 2 giây" và mở đường cho camera.

### 2. Bộ mô phỏng: nền cố định + spike tự tắt dần

Thay random walk trôi tự do bằng mô hình có hồi quy về nền:

```
suất_liều = nền_cố_định[i] + nhiễu_nhỏ + biên_độ_spike[i]
biên_độ_spike[i] *= DECAY   mỗi tick   (DECAY = 0.85)
```

Nền là hằng số cho từng vùng, **không bao giờ bị spike kéo lên**. Spike cộng thêm rồi tự tắt dần —
với `DECAY = 0.85` và chu kỳ 2 giây, một spike đỏ giảm về mức bình thường sau khoảng 15–20 giây.
Đủ dài để người xem kịp thấy đèn đỏ, nghe còi, và thấy một đến hai ảnh được chụp ở chu kỳ 10 giây.

Bổ sung `forceAlert(zoneId, level)` — nạp thẳng biên độ spike đủ để vượt ngưỡng vàng hoặc đỏ — và
`resetAll()` để đưa cả ba vùng về bình thường ngay lập tức.

### 3. Camera: canvas mô phỏng, khung hình chụp là ảnh thật

Mỗi vùng một `<canvas>` vẽ khoảng 10 khung hình mỗi giây: nền tối, đường quét chạy, hạt nhiễu,
overlay tên vùng và đồng hồ đang chạy, chấm `● REC` đỏ nhấp nháy khi vùng đang cảnh báo.

Chụp ảnh dùng `canvas.toDataURL('image/jpeg', 0.7)`, trả về **ảnh JPEG thật** — không phải chuỗi
tên file giả như hiện tại. Nhờ vậy tính năng lưu trữ bằng chứng chạy end-to-end thật sự.

Đường chụp ảnh được thiết kế trung lập với nguồn: sau này dù nguồn là `<video>` phát file, luồng
RTSP hay MJPEG từ thiết bị thật, đều đi qua cùng một bước `drawImage` → `toDataURL`. Không phải
viết lại.

### 4. Còi: Web Audio API, không cần file âm thanh

Dùng `OscillatorNode` nên không phải thêm file nhị phân vào repo.

- **Vàng** — bíp ngắt quãng ~660 Hz, một nhịp mỗi giây.
- **Đỏ** — hú liên tục quét 800↔1200 Hz, nhịp gấp.

Còi lấy **mức nghiêm trọng cao nhất** trong ba vùng, không cộng dồn ba nguồn tiếng.

Hai chi tiết bắt buộc cho buổi trình bày trực tiếp:

- **Nút bật tiếng.** Trình duyệt chặn phát âm thanh khi trang chưa nhận click của người dùng
  (autoplay policy). Không có nút này thì đứng trước khách mà còi câm. Giao diện phải hiện rõ
  trạng thái "chưa bật tiếng".
- **Nút tắt tiếng.** Còi hú liên tục thì người trình bày không nói được.

### 5. Snapshot đúng tài liệu thiết kế

Lỗi hiện tại: `setInterval(() => captureSnapshot(zone), ...)` giữ closure lên object `zone` của
đúng lần đọc lúc cảnh báo *bắt đầu*. Mọi ảnh sau đó đều ghi lại cùng một giá trị đo cũ.

Tài liệu thiết kế yêu cầu "lưu trữ giá trị đo suất liều cùng với hình ảnh **tại từng thời điểm**".
Sửa: `app.js` giữ một tham chiếu tới lần đọc mới nhất; timer 10 giây tra cứu giá trị của vùng đó
**tại thời điểm chụp**, không dùng giá trị bị đóng băng trong closure.

### 6. Khu xem lại bằng chứng

Section mới "Lịch sử ảnh cảnh báo": lưới thumbnail, mỗi ảnh gắn badge suất liều (µSv/h), tên vùng,
và mốc thời gian. Click để phóng to trong modal.

**Giới hạn bộ nhớ:** demo 30 phút với cảnh báo liên tục có thể sinh khoảng 500 ảnh; mỗi data URL
JPEG cỡ 25 KB, tổng ~13 MB. Giữ **60 ảnh gần nhất**, và hiển thị "còn N ảnh cũ hơn" cho phần bị
cắt, để người xem biết dữ liệu không bị mất một cách âm thầm.

### 7. Thanh điều khiển demo

Mỗi vùng hai nút `Vàng` / `Đỏ`, thêm nút `Về bình thường` và toggle âm thanh. Người trình bày chủ
động được nhịp kể chuyện thay vì chờ spike ngẫu nhiên.

## Xử lý lỗi

- `AudioContext` bị chặn hoặc trình duyệt không hỗ trợ → hiện badge "🔇 Bấm để bật tiếng"; phần
  còn lại của giao diện vẫn chạy bình thường.
- `toDataURL()` thất bại (canvas bị nhiễm bẩn — sẽ không xảy ra với canvas tự vẽ, nhưng sẽ xảy ra
  nếu sau này nạp ảnh cross-origin) → bỏ qua ảnh đó, vẫn ghi lại giá trị đo, không làm sập vòng lặp.
- Khi vùng rời trạng thái cảnh báo, timer chụp ảnh phải được `clearInterval` — tránh rò rỉ timer
  tích tụ qua nhiều chu kỳ cảnh báo.

## Kiểm chứng

Repo không có test framework và việc thêm một framework nằm ngoài phạm vi demo. Xác minh bằng hai
cách:

1. **Script Node** chạy lại logic `nextReading()` trong 30 phút mô phỏng, khẳng định nền không
   trôi và trạng thái xanh vẫn chiếm đa số. Đây đúng là cách bug drift ban đầu bị phát hiện.
2. **Chạy thật trong trình duyệt**: ép cảnh báo bằng thanh điều khiển, xác nhận đèn đổi màu, còi
   kêu, ảnh được chụp, và gallery hiện **ảnh thật** kèm đúng suất liều và mốc thời gian.

Không tuyên bố hoàn thành nếu chưa quan sát được bằng chứng của cả hai.

## Ảnh hưởng tới tài liệu

`README.md` hiện mô tả còi cảnh báo và tính năng chụp ảnh như thể đã hoạt động, trong khi chúng
chưa tồn tại. Sau khi triển khai xong, các mô tả đó trở thành đúng. Cần cập nhật thêm: hướng dẫn
bấm nút bật tiếng khi chạy thử, thanh điều khiển demo, và khu xem lại bằng chứng. Bảng "Thành phần
phần mềm" trong `docs/architecture.md` cần liệt kê đủ bốn module.

---

## Phụ lục: những gì review đối kháng tìm ra sau khi triển khai

Sau khi code xong và kiểm chứng "23/23 đạt", một đợt review đa tác tử (5 góc nhìn độc lập, mỗi
phát hiện bị 3 phản biện viên cố bác bỏ) sinh 25 phát hiện thô, **11 sống sót**. Bốn trong số đó
nghiêm trọng, và đều là lỗi do đợt triển khai này gây ra. Ghi lại vì mỗi lỗi dạy một bài học về
cách kiểm chứng.

**Bài test tự nó hỏng, và trượt 47% số lần chạy — với thông báo lỗi sai.** `onUpdate()` không có
cách hủy đăng ký, nên 60 lần đo cung bậc để lại 60 listener sống; các mảng kết quả ghi đè lẫn
nhau. Nó báo "ép Vàng vọt lên đỏ", điều toán học không thể xảy ra (1,12 < 1,2). Ba lần chạy thấy
PASS chỉ là bốc trúng mặt may. *Bài học: chạy test ngẫu nhiên vài lần không chứng minh được gì —
phải chạy hàng chục lần, hoặc làm nó tất định.*

**Bấm nút ở vùng này làm vùng khác đang cảnh báo tự khỏi.** `forceAlert()` gọi `emit()` →
`nextReading()` → tắt dần spike của **cả ba vùng**. Mỗi cú click là một nhịp decay tặng không cho
các vùng khác. Sửa: tách `advance` ra khỏi `emit`, chỉ tắt dần spike khi thời gian thật sự trôi.
*Bài học: decay phải gắn với thời gian, không gắn với số lần phát tin.*

**Trên Safari còi câm, nút lại báo "Đang bật tiếng", và bấm lần hai thì TẮT tiếng.** `unlock()`
gọi `applyPattern()` trước khi `ctx.resume()` resolve. Chrome đặt `state = "running"` đồng bộ nên
**kiểm chứng bằng Chrome không thể phát hiện lỗi này**. Sửa: nối `applyPattern` vào `.then()` của
resume, và cho giao diện dựa vào `isUnlocked()` thay vì `isReady()`. *Bài học: một trình duyệt
không phải là mọi trình duyệt.*

**Còi tự hú 27 lần trong 30 phút, chiếm 23% thời lượng buổi nói.** Thước đo trong test ("91% xanh")
là **sai thước đo**: nó đo từng-vùng-từng-lần-đọc, còn thứ khách nghe là mức màn hình — "có ít
nhất một vùng đang hú". Sửa: hạ mạnh xác suất spike tự phát, và đổi test sang đo mức màn hình
trên 20 phiên độc lập. Kết quả: còi tự kêu 2,9% thời lượng, ~3,5 đợt mỗi 30 phút. *Bài học: một
con số đẹp trên sai thước đo còn nguy hiểm hơn không đo gì.*

Bảy phát hiện còn lại ở mức trung bình/thấp, đều đã sửa: cảm biến môi trường nhảy ngẫu nhiên toàn
dải mỗi 2 giây (phi vật lý, lộ rõ đồ giả) → đi bộ ngẫu nhiên từng bước nhỏ; ảnh bằng chứng phóng
to bị vỡ hạt → nâng canvas từ 320×180 lên 640×360.
