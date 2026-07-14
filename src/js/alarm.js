/**
 * alarm.js
 *
 * Còi cảnh báo — yêu cầu ở mục 5 và 6 tài liệu thiết kế ("còi cảnh báo khi có cảnh báo").
 *
 * Dùng Web Audio API sinh tiếng trực tiếp, không cần thêm file âm thanh vào repo.
 *   Vàng — bíp ngắt quãng 660 Hz, một nhịp mỗi giây.
 *   Đỏ   — hú liên tục quét 800↔1200 Hz.
 *
 * QUAN TRỌNG: trình duyệt chặn phát âm thanh cho tới khi trang nhận được thao tác thật của
 * người dùng (autoplay policy). Vì vậy giao diện BẮT BUỘC có nút bật tiếng gọi unlock() từ
 * trong trình xử lý sự kiện click — nếu không, demo sẽ câm trước mặt khách.
 *
 * Interface:
 *   HtgAlarm.unlock()            mở AudioContext (phải gọi từ trong sự kiện click)
 *   HtgAlarm.setLevel(status)    'green' | 'yellow' | 'red' — mức nghiêm trọng cao nhất
 *   HtgAlarm.setMuted(bool)      tắt/bật tiếng khi đang thuyết trình
 *   HtgAlarm.isReady() / isMuted()
 *   HtgAlarm.onChange(cb)        báo cho giao diện cập nhật nút
 */

const HtgAlarm = (() => {
  const YELLOW_FREQ = 660; // Hz
  const RED_LOW = 800;
  const RED_HIGH = 1200;
  const SWEEP_SECONDS = 0.7; // một chu kỳ hú lên-xuống
  const VOLUME = 0.09; // để mức vừa phải — đủ nghe trong phòng họp, không chói

  let ctx = null;
  let osc = null;
  let gain = null;
  let level = "green";
  let muted = false;
  let unlocked = false; // người dùng đã bấm nút bật tiếng chưa
  let patternTimer = null;
  let listeners = [];

  function isReady() {
    return ctx !== null && ctx.state === "running";
  }

  /**
   * Người dùng đã bấm nút bật tiếng chưa — KHÁC với isReady().
   *
   * Safari tạo AudioContext ở trạng thái "suspended" ngay cả khi new AudioContext() nằm trong
   * trình xử lý click; chỉ vài chục ms sau, khi resume() resolve, nó mới thành "running". Nếu
   * giao diện suy ra "đã bấm chưa" từ isReady(), thì trong khe thời gian đó nút vẫn hiện "bấm
   * để bật tiếng", người trình bày bấm lần nữa và cú bấm thứ hai lại rơi vào nhánh TẮT TIẾNG.
   */
  function isUnlocked() {
    return unlocked;
  }

  function isMuted() {
    return muted;
  }

  function onChange(cb) {
    listeners.push(cb);
  }

  function notify() {
    listeners.forEach((cb) => cb({ ready: isReady(), unlocked, muted, level }));
  }

  /**
   * Mở AudioContext. Phải được gọi từ bên trong một trình xử lý sự kiện của người dùng.
   *
   * Chrome/Edge đặt state = "running" ĐỒNG BỘ khi có user activation, nên gọi applyPattern()
   * ngay sau đó là chạy được. Safari thì KHÔNG: context sinh ra ở "suspended" và chỉ chuyển sang
   * "running" khi resume() resolve. Gọi applyPattern() ngay lập tức ở đó sẽ rơi vào nhánh
   * `!isReady()` và thoát sớm — còi câm suốt cả sự cố, vì setLevel() cũng thoát sớm khi mức
   * không đổi. Vì vậy applyPattern PHẢI được nối vào .then() của resume, không chỉ notify.
   *
   * Đây chính là lỗi mà kiểm chứng bằng Chrome không thể phát hiện được.
   */
  function unlock() {
    unlocked = true;

    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) {
        console.warn("Trình duyệt không hỗ trợ Web Audio API — còi sẽ không kêu.");
        notify();
        return false;
      }
      ctx = new AudioCtor();

      gain = ctx.createGain();
      gain.gain.value = 0; // im lặng cho tới khi có cảnh báo
      gain.connect(ctx.destination);

      osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = YELLOW_FREQ;
      osc.connect(gain);
      osc.start(); // chạy suốt phiên; điều khiển tiếng bằng gain, không tạo/hủy oscillator
    }

    if (ctx.state === "running") {
      applyPattern();
      notify();
    } else {
      ctx
        .resume()
        .then(() => {
          applyPattern(); // chỉ chạy được SAU khi context thật sự "running"
          notify();
        })
        .catch((err) => {
          // Firefox có thể từ chối thẳng nếu người dùng chặn autoplay ở cấp trình duyệt.
          console.warn("Không mở được AudioContext — còi sẽ câm:", err);
          unlocked = false; // trả nút về trạng thái khóa để người dùng bấm lại
          notify();
        });
    }

    return true;
  }

  function stopPattern() {
    if (patternTimer !== null) {
      clearInterval(patternTimer);
      patternTimer = null;
    }
    if (ctx && gain && osc) {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      osc.frequency.cancelScheduledValues(t);
    }
  }

  /** Một nhịp bíp ngắn (cảnh báo vàng). */
  function beep() {
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(YELLOW_FREQ, t);
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(VOLUME, t + 0.02); // ramp thay vì bật đột ngột, tránh tiếng "cạch"
    gain.gain.setValueAtTime(VOLUME, t + 0.14);
    gain.gain.linearRampToValueAtTime(0, t + 0.18);
  }

  /** Một chu kỳ hú lên-xuống (cảnh báo đỏ), tiếng phát liên tục. */
  function sweep() {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(VOLUME, t);
    osc.frequency.cancelScheduledValues(t);
    osc.frequency.setValueAtTime(RED_LOW, t);
    osc.frequency.linearRampToValueAtTime(RED_HIGH, t + SWEEP_SECONDS / 2);
    osc.frequency.linearRampToValueAtTime(RED_LOW, t + SWEEP_SECONDS);
  }

  function applyPattern() {
    stopPattern();
    if (!isReady() || muted || level === "green") return;

    if (level === "yellow") {
      osc.type = "square";
      beep();
      patternTimer = setInterval(beep, 1000);
    } else {
      osc.type = "sawtooth"; // gắt hơn square — hợp với cảnh báo mức cao
      sweep();
      patternTimer = setInterval(sweep, SWEEP_SECONDS * 1000);
    }
  }

  /**
   * Đặt mức còi theo trạng thái nghiêm trọng nhất trong 3 vùng.
   * Không làm gì nếu mức không đổi — nếu khởi động lại nhịp mỗi lần đọc dữ liệu (2 giây/lần)
   * thì tiếng bíp sẽ bị giật cục.
   */
  function setLevel(status) {
    if (status === level) return;
    level = status;
    applyPattern();
    notify();
  }

  function setMuted(value) {
    muted = value;
    applyPattern();
    notify();
  }

  return { unlock, setLevel, setMuted, isReady, isUnlocked, isMuted, onChange };
})();
