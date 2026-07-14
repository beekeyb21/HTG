/**
 * camera.js
 *
 * Nguồn hình ảnh camera cho 3 vùng giám sát.
 *
 * Bản này VẼ MÔ PHỎNG bằng canvas (chưa có phần cứng thật), nhưng khung hình chụp ra là
 * ảnh JPEG THẬT — nhờ vậy tính năng "chụp ảnh 10s/lần khi cảnh báo, lưu kèm suất liều"
 * trong tài liệu thiết kế chạy được end-to-end ngay từ demo.
 *
 * Khi có camera thật, thay phần ruột của module này (dựng <video> từ RTSP/MJPEG/WebRTC
 * thay vì <canvas> tự vẽ). Đường chụp ảnh không đổi: drawImage → toDataURL. app.js không
 * cần biết nguồn hình đến từ đâu.
 *
 * Interface:
 *   HtgCameraSource.mount(zoneId, container)   gắn khung hình vào thẻ vùng
 *   HtgCameraSource.setStatus(zoneId, status)  'green' | 'yellow' | 'red'
 *   HtgCameraSource.grabFrame(zoneId)          → data URL JPEG, hoặc null nếu chụp lỗi
 */

const HtgCameraSource = (() => {
  const WIDTH = 320; // hệ toạ độ vẽ (logic)
  const HEIGHT = 180; // 16:9
  const FPS = 10;

  // Canvas thật lớn gấp SCALE lần hệ toạ độ vẽ. Ảnh bằng chứng được phóng to trong modal lên tới
  // ~900px; chụp ở 320x180 rồi kéo lên gần 3 lần thì vỡ hạt, làm chính tính năng chủ lực trông rẻ
  // tiền. Vẽ ở 640x360 rồi để ctx.scale lo phần quy đổi — mọi toạ độ dưới đây vẫn viết theo hệ
  // 320x180, không phải sửa gì.
  const SCALE = 2;

  const cams = {}; // zoneId -> { canvas, ctx, status, frame }
  let loopTimer = null;

  function mount(zoneId, container) {
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * SCALE;
    canvas.height = HEIGHT * SCALE;
    canvas.className = "camera-canvas";
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    cams[zoneId] = { canvas, ctx, status: "green", frame: 0 };

    if (loopTimer === null) {
      loopTimer = setInterval(renderAll, 1000 / FPS);
    }
  }

  function setStatus(zoneId, status) {
    const cam = cams[zoneId];
    if (cam) cam.status = status;
  }

  function renderAll() {
    Object.keys(cams).forEach((zoneId) => draw(cams[zoneId], Number(zoneId)));
  }

  /** Cảnh tĩnh: sàn phối cảnh + hai thùng chứa. Mỗi vùng lệch bố cục một chút cho khác nhau. */
  function drawScene(ctx, zoneId) {
    const offset = (zoneId - 1) * 18;

    ctx.fillStyle = "#0b1219";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Tường sau
    ctx.fillStyle = "#131f2b";
    ctx.fillRect(0, 0, WIDTH, 110);

    // Sàn phối cảnh
    ctx.fillStyle = "#0e1822";
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.lineTo(WIDTH - 30, 110);
    ctx.lineTo(30, 110);
    ctx.closePath();
    ctx.fill();

    // Vạch kẻ sàn
    ctx.strokeStyle = "#1d2b3a";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = 110 + (HEIGHT - 110) * (i / 4);
      const inset = 30 * (1 - (y - 110) / (HEIGHT - 110));
      ctx.beginPath();
      ctx.moveTo(inset, y);
      ctx.lineTo(WIDTH - inset, y);
      ctx.stroke();
    }

    // Hai thùng chứa (nguồn phóng xạ giả định)
    ctx.fillStyle = "#1c2a38";
    ctx.strokeStyle = "#2a3d50";
    [70 + offset, 190 + offset].forEach((x, i) => {
      const w = 38;
      const h = 46 + i * 8;
      const y = 112 - h;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y, w / 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  /** Quầng sáng phát ra từ thùng khi vùng đang cảnh báo — cho thấy camera "phản ứng" với sự cố. */
  function drawGlow(ctx, zoneId, status, frame) {
    if (status === "green") return;

    const cx = 89 + (zoneId - 1) * 18;
    const cy = 90;
    const pulse = 0.5 + 0.5 * Math.sin(frame / (status === "red" ? 2.5 : 5));
    const radius = status === "red" ? 55 + pulse * 20 : 40 + pulse * 10;
    const color = status === "red" ? "231, 76, 60" : "241, 196, 15";

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(${color}, ${status === "red" ? 0.45 : 0.25})`);
    grad.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Nhiễu hạt + đường quét: dấu hiệu thị giác cho thấy đây là luồng hình đang chạy. */
  function drawSignalArtifacts(ctx, frame) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
    for (let i = 0; i < 90; i++) {
      ctx.fillRect(Math.random() * WIDTH, Math.random() * HEIGHT, 1, 1);
    }

    const scanY = (frame * 2) % (HEIGHT + 40) - 20;
    const grad = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
    grad.addColorStop(0, "rgba(120, 190, 255, 0)");
    grad.addColorStop(0.5, "rgba(120, 190, 255, 0.05)");
    grad.addColorStop(1, "rgba(120, 190, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, scanY - 12, WIDTH, 24);
  }

  function drawOverlay(ctx, zoneId, status, frame) {
    ctx.font = "10px monospace";

    ctx.fillStyle = "rgba(230, 237, 243, 0.85)";
    ctx.fillText(`CAM-0${zoneId}`, 8, 16);

    // Đồng hồ chạy tới phần trăm giây — bằng chứng trực quan rằng hình đang sống.
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const cs = String(Math.floor(now.getMilliseconds() / 10)).padStart(2, "0");
    const stamp = `${hh}:${mm}:${ss}.${cs}`;
    ctx.fillText(stamp, WIDTH - ctx.measureText(stamp).width - 8, HEIGHT - 8);

    // Chấm REC nhấp nháy khi đang cảnh báo (đang ghi hình làm bằng chứng).
    if (status !== "green" && Math.floor(frame / 5) % 2 === 0) {
      ctx.fillStyle = "#e74c3c";
      ctx.beginPath();
      ctx.arc(WIDTH - 40, 13, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText("REC", WIDTH - 32, 17);
    }
  }

  function draw(cam, zoneId) {
    const { ctx, status } = cam;
    cam.frame++;

    drawScene(ctx, zoneId);
    drawGlow(ctx, zoneId, status, cam.frame);
    drawSignalArtifacts(ctx, cam.frame);
    drawOverlay(ctx, zoneId, status, cam.frame);
  }

  /**
   * Chụp khung hình hiện tại thành ảnh JPEG thật.
   *
   * Vẽ lại một khung TƯƠI trước khi chụp. Vòng lặp chỉ vẽ 10 khung/giây, nên nếu chụp thẳng
   * từ canvas thì tấm ảnh có thể là khung được vẽ trước đó tới 100ms — vẽ lúc vùng còn xanh.
   * Hậu quả: ảnh bằng chứng của đúng khoảnh khắc báo động lại cho thấy hiện trường yên bình,
   * không quầng sáng, không chấm REC. Đó lại là tấm ảnh quan trọng nhất.
   *
   * Trả null nếu chụp lỗi (canvas bị nhiễm bẩn bởi ảnh cross-origin — không xảy ra với canvas
   * tự vẽ, nhưng sẽ xảy ra nếu sau này nạp luồng hình từ máy chủ khác).
   */
  function grabFrame(zoneId) {
    const cam = cams[zoneId];
    if (!cam) return null;
    try {
      draw(cam, zoneId);
      return cam.canvas.toDataURL("image/jpeg", 0.7);
    } catch (err) {
      console.warn(`Không chụp được khung hình vùng ${zoneId}:`, err);
      return null;
    }
  }

  return { mount, setStatus, grabFrame };
})();
