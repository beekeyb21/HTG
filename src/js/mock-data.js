/**
 * mock-data.js
 *
 * Mô phỏng dữ liệu từ thân thiết bị HTG (3 đầu đo phóng xạ + cảm biến môi trường)
 * cho đến khi kết nối phần cứng thật.
 *
 * Khi tích hợp phần cứng: thay module này bằng một nguồn dữ liệu thật
 * (REST polling hoặc WebSocket) miễn là nó cung cấp cùng interface:
 *   HtgDataSource.onUpdate(callback)
 *   callback(reading) nhận: { zones: [...], env: {...}, timestamp }
 *
 * Mô hình suất liều:
 *   suất_liều = nền_cố_định + nhiễu_nhỏ + biên_độ_spike
 *   biên_độ_spike *= SPIKE_DECAY mỗi tick  →  spike tự tắt dần về nền
 *
 * Nền là hằng số, không bị spike kéo lên. Đây là điểm khác biệt so với bản trước
 * (random walk không hồi quy) — bản đó bị trôi lên và kẹt cảnh báo sau vài phút.
 */

const HtgDataSource = (() => {
  const ZONE_COUNT = 3;
  const YELLOW_THRESHOLD = 0.5; // µSv/h
  const RED_THRESHOLD = 1.2; // µSv/h
  const UPDATE_INTERVAL_MS = 2000;

  // Nền phông tự nhiên của từng vùng (µSv/h) — cố định, không trôi.
  const BASELINE = [0.18, 0.14, 0.16];
  const NOISE_AMPLITUDE = 0.04;

  const SPIKE_DECAY = 0.85; // spike giảm 15% mỗi tick
  const SPIKE_FLOOR = 0.01; // dưới mức này coi như hết spike

  // Đỉnh của một sự cố, tính bằng µSv/h. Đặt CAO HƠN HẲN ngưỡng chứ không sát ngưỡng:
  // với decay 0.85/tick, một spike đỏ chỉ 1.3 µSv/h sẽ rơi xuống dưới ngưỡng đỏ ngay ở tick
  // kế tiếp — bấm nút "Đỏ" thì còi hú được đúng 2 giây rồi tụt xuống vàng, vô dụng khi demo.
  //
  // Ở các mức dưới đây, một sự cố đỏ có cung bậc thời gian tử tế:
  //   đỏ ~10 giây  →  tắt dần qua vàng ~14 giây  →  về xanh.  Tổng ~25 giây.
  const RED_PEAK_MIN = 2.4;
  const RED_PEAK_RANGE = 0.9; // đỉnh 2.4 - 3.3 µSv/h
  const YELLOW_PEAK_MIN = 0.85;
  const YELLOW_PEAK_RANGE = 0.25; // đỉnh 0.85 - 1.10 µSv/h, an toàn dưới ngưỡng đỏ

  // Xác suất tự phát sinh spike MỖI VÙNG MỖI TICK. Đặt rất thấp có chủ đích.
  //
  // Thước đo đúng không phải "bao nhiêu % lần đọc của một vùng là xanh" mà là "bao nhiêu % thời
  // gian màn hình đang có ít nhất một vùng hú" — đó là thứ khách nghe thấy. Với 3 vùng và một
  // sự cố đỏ kéo dài ~12 tick, xác suất 0.008/0.003 từng khiến còi tự kêu 27 lần trong 30 phút,
  // chiếm 23% thời lượng buổi nói: người trình bày mất hẳn quyền cầm nhịp.
  //
  // Ở mức dưới đây, 30 phút có ~4 sự cố tự phát và màn hình yên tĩnh >95% thời gian. Kịch bản
  // do người trình bày cầm lái bằng thanh điều khiển; cảnh báo ngẫu nhiên chỉ để chứng minh hệ
  // thống vẫn đang sống.
  const YELLOW_SPIKE_CHANCE = 0.0012;
  const RED_SPIKE_CHANCE = 0.0004;

  let listeners = [];
  let spikes = new Array(ZONE_COUNT).fill(0);
  let timerId = null;
  const env = { temperature: 26.4, humidity: 58.0, pressure: 1011.2 };

  function classify(dose) {
    if (dose >= RED_THRESHOLD) return "red";
    if (dose >= YELLOW_THRESHOLD) return "yellow";
    return "green";
  }

  /** Biên độ spike cần cộng vào nền để vùng `i` đạt đỉnh của mức `level`, kèm chút ngẫu nhiên. */
  function spikeAmplitudeFor(i, level) {
    const peak =
      level === "red"
        ? RED_PEAK_MIN + Math.random() * RED_PEAK_RANGE
        : YELLOW_PEAK_MIN + Math.random() * YELLOW_PEAK_RANGE;
    return Math.max(0, peak - BASELINE[i]);
  }

  /**
   * Sinh một lần đọc.
   *
   * `advance` = một nhịp THỜI GIAN thật sự đã trôi qua. Chỉ khi đó spike mới được tắt dần và
   * spike mới mới được phép tự phát sinh.
   *
   * Lý do phải tách: forceAlert() và resetAll() cũng phát ra một lần đọc tức thì để giao diện
   * phản hồi ngay. Nếu những lần đọc ngoài nhịp đó cũng tắt dần spike, thì mỗi cú bấm nút demo
   * lại tặng một nhịp decay cho CẢ BA vùng — bấm nút của vùng 1 làm vùng 2 đang đỏ tụt xuống
   * vàng, đèn đổi màu và còi hạ giọng cho một vùng không ai động tới.
   */
  function nextReading(advance) {
    const zones = BASELINE.map((base, i) => {
      // Spike tự phát sinh ngẫu nhiên (đỏ hiếm hơn vàng) — chỉ khi thời gian thật sự trôi.
      if (advance) {
        const roll = Math.random();
        if (roll < RED_SPIKE_CHANCE) {
          spikes[i] = Math.max(spikes[i], spikeAmplitudeFor(i, "red"));
        } else if (roll < RED_SPIKE_CHANCE + YELLOW_SPIKE_CHANCE) {
          spikes[i] = Math.max(spikes[i], spikeAmplitudeFor(i, "yellow"));
        }
      }

      const noise = (Math.random() - 0.5) * NOISE_AMPLITUDE;
      const dose = Math.max(0.05, base + noise + spikes[i]);

      if (advance) {
        spikes[i] *= SPIKE_DECAY;
        if (spikes[i] < SPIKE_FLOOR) spikes[i] = 0;
      }

      return {
        zoneId: i + 1,
        label: `Vị trí ${i + 1}`,
        doseRate: Number(dose.toFixed(3)),
        unit: "µSv/h",
        status: classify(dose),
      };
    });

    return { zones, env: nextEnv(advance), timestamp: new Date() };
  }

  /**
   * Cảm biến môi trường đi bộ ngẫu nhiên từng bước nhỏ quanh giá trị hiện tại, không nhảy loạn
   * toàn dải mỗi 2 giây. Nhiệt độ phòng không thể giật ±4°C giữa hai lần đọc — chi tiết phi vật
   * lý đó là thứ lộ rõ nhất rằng dữ liệu đang được bịa ra.
   */
  function nextEnv(advance) {
    if (advance) {
      env.temperature = drift(env.temperature, 0.08, 24.5, 28.5);
      env.humidity = drift(env.humidity, 0.2, 52, 68);
      env.pressure = drift(env.pressure, 0.15, 1006, 1016);
    }
    return {
      temperature: Number(env.temperature.toFixed(1)),
      humidity: Number(env.humidity.toFixed(1)),
      pressure: Number(env.pressure.toFixed(1)),
    };
  }

  function drift(value, step, min, max) {
    const next = value + (Math.random() - 0.5) * 2 * step;
    return Math.min(max, Math.max(min, next));
  }

  function emit(advance) {
    const reading = nextReading(advance);
    listeners.forEach((cb) => cb(reading));
  }

  function start() {
    if (timerId !== null) return; // tránh chạy hai vòng lặp nếu gọi start() hai lần
    timerId = setInterval(() => emit(true), UPDATE_INTERVAL_MS);
    setTimeout(() => emit(true), 200); // phát ngay một lần để giao diện không trống lúc mới tải
  }

  /** Đăng ký nhận dữ liệu. Trả về hàm hủy đăng ký — gọi nó để gỡ listener ra. */
  function onUpdate(callback) {
    listeners.push(callback);
    return () => {
      listeners = listeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * Ép một vùng vào trạng thái cảnh báo ngay lập tức (dùng cho thanh điều khiển demo).
   * Spike vẫn tắt dần theo nhịp thời gian như spike tự nhiên, nên vùng tự hồi phục sau ~25 giây.
   *
   * emit(false): phát ra một lần đọc tức thì nhưng KHÔNG tiêu một nhịp decay — nếu không, mỗi cú
   * bấm nút lại rút ngắn cảnh báo của các vùng khác.
   */
  function forceAlert(zoneId, level) {
    const i = zoneId - 1;
    if (i < 0 || i >= ZONE_COUNT) return;
    spikes[i] = spikeAmplitudeFor(i, level);
    emit(false);
  }

  /** Đưa cả ba vùng về bình thường ngay lập tức. */
  function resetAll() {
    spikes = new Array(ZONE_COUNT).fill(0);
    emit(false);
  }

  return {
    onUpdate,
    start,
    forceAlert,
    resetAll,
    ZONE_COUNT,
    YELLOW_THRESHOLD,
    RED_THRESHOLD,
  };
})();
