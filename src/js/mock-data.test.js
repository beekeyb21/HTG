/**
 * mock-data.test.js — kiểm chứng bộ mô phỏng.
 *
 * Chạy: node src/js/mock-data.test.js
 *
 * Nạp thẳng src/js/mock-data.js vào một sandbox với setInterval/setTimeout bị stub, rồi tua tay
 * từng tick. Test chạy trên file thật, không phải bản sao chép logic.
 *
 * Bốn tính chất được khóa chặt ở đây, mỗi cái tương ứng một lỗi đã từng mắc:
 *
 *   1. NỀN KHÔNG TRÔI       — random walk không hồi quy từng kéo nền từ 0.2 lên 1.0 µSv/h và
 *                             kẹt cảnh báo vĩnh viễn sau 2 phút.
 *   2. MÀN HÌNH YÊN TĨNH    — đo ở MỨC MÀN HÌNH ("có ít nhất 1 vùng đang hú"), không phải mức
 *                             từng-vùng-từng-lần-đọc. Thước đo cũ báo 91% xanh trong khi còi
 *                             thực tế kêu 23% thời lượng buổi nói.
 *   3. SỰ CỐ ĐỦ DÀI         — đỉnh spike đặt sát ngưỡng khiến bấm "Đỏ" xong 2 giây là tụt vàng.
 *   4. CÁC VÙNG ĐỘC LẬP     — forceAlert() từng gọi emit() có tắt dần spike, nên bấm nút vùng 1
 *                             lại làm vùng 2 đang đỏ tự khỏi.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const TICKS = 900; // 900 x 2s = 30 phút
const TICK_SECONDS = 2;
const SOURCE = path.join(__dirname, "mock-data.js");

// --- Nạp mock-data.js với timer bị stub để tua tay ---------------------------
let intervalFn = null;
const realMath = Math;
const sandbox = {
  setInterval: (fn) => {
    intervalFn = fn;
    return 1;
  },
  setTimeout: () => 0, // bỏ qua phát-ngay-lúc-tải, ta tự tua
  clearInterval: () => {},
  Math,
  Date,
  Number,
  Array,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SOURCE, "utf8"), sandbox, { filename: SOURCE });

// `const HtgDataSource` ở top-level nằm trong global lexical scope, không thành thuộc tính của
// sandbox — lấy ra bằng một biểu thức chạy trong cùng context. (Trình duyệt cũng chia sẻ scope
// này giữa các thẻ <script> cổ điển, nên app.js thấy được HtgDataSource.)
const HtgDataSource = vm.runInContext("HtgDataSource", sandbox);

/**
 * Chạy `fn` với Math.random bị ghim cứng — cho ra kịch bản TẤT ĐỊNH và là trường hợp XẤU NHẤT:
 *   roll = 0.01  → lớn hơn mọi ngưỡng spike tự phát, nên không có sự cố ngẫu nhiên xen vào
 *   peak = MIN + 0.01 * RANGE  → đỉnh spike thấp nhất, tức sự cố ngắn nhất
 *   noise = (0.01 - 0.5) * biên  → nhiễu âm, kéo suất liều xuống thêm
 * Nhờ vậy phép đo cung bậc sự cố không bị spike ngẫu nhiên làm nhiễu (đã từng khiến test này
 * báo FAIL sai 47% số lần chạy).
 */
function withFixedRandom(fn) {
  const stub = Object.create(realMath);
  stub.random = () => 0.01;
  sandbox.Math = stub;
  try {
    return fn();
  } finally {
    sandbox.Math = realMath;
  }
}

const failures = [];
const fail = (msg) => failures.push(msg);

// ============================================================================
// 1 & 2. Chạy 20 phiên demo 30 phút: nền không trôi, màn hình yên tĩnh
// ============================================================================
//
// Đo trên NHIỀU phiên chứ không một phiên. Cảnh báo tự phát là quá trình ngẫu nhiên: một phiên
// đơn lẻ có thể bốc trúng 9 đợt thay vì 5, và một test khẳng định trên đúng một mẫu sẽ trượt
// ngẫu nhiên ~5% số lần chạy — đúng kiểu test hay bị bỏ qua vì "chắc lại flaky".
// Khẳng định trên phân phối thì tất định; phiên xấu nhất được in ra để người đọc thấy cái đuôi.

const SESSIONS = 20;

const sessions = [];
const doseByZone = [[], [], []];

HtgDataSource.start();
if (typeof intervalFn !== "function") {
  console.error("FAIL: start() không đăng ký vòng lặp qua setInterval");
  process.exit(1);
}

for (let s = 0; s < SESSIONS; s++) {
  const readings = [];
  const stop = HtgDataSource.onUpdate((r) => readings.push(r));
  for (let t = 0; t < TICKS; t++) intervalFn();
  stop(); // BẮT BUỘC gỡ listener, nếu không các phiên sẽ ghi đè dữ liệu lẫn nhau

  let screenAlertTicks = 0; // tick có ÍT NHẤT MỘT vùng cảnh báo — đây là thứ khách nghe thấy
  let events = 0; // số ĐỢT cảnh báo (đếm lần chuyển từ yên tĩnh sang cảnh báo)
  let wasAlerting = false;

  readings.forEach((r) => {
    r.zones.forEach((z) => doseByZone[z.zoneId - 1].push(z.doseRate));
    const alerting = r.zones.some((z) => z.status !== "green");
    if (alerting) screenAlertTicks++;
    if (alerting && !wasAlerting) events++;
    wasAlerting = alerting;
  });

  sessions.push({ alertPct: (screenAlertTicks / readings.length) * 100, events });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanAlertPct = mean(sessions.map((s) => s.alertPct));
const meanEvents = mean(sessions.map((s) => s.events));
const worstAlertPct = Math.max(...sessions.map((s) => s.alertPct));
const worstEvents = Math.max(...sessions.map((s) => s.events));

/** Sàn yên tĩnh = bách phân vị 10. Trung vị trên cửa sổ nhỏ có thể trúng lúc spike đang tắt dần
 *  và báo drift giả; bách phân vị 10 đo đúng mức nền lúc không có spike. */
const quietFloor = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.1)];
const half = Math.floor(doseByZone[0].length / 2);
const drift = doseByZone.map((d) => ({
  first: quietFloor(d.slice(0, half)),
  last: quietFloor(d.slice(half)),
}));

console.log(`Tua ${SESSIONS} phiên x 30 phút (${SESSIONS * TICKS} tick)\n`);

console.log("Trôi nền (sàn yên tĩnh, µSv/h — đầu 10 phiên so với cuối 10 phiên):");
drift.forEach((d, i) =>
  console.log(`  Vùng ${i + 1}: ${d.first.toFixed(3)}  →  ${d.last.toFixed(3)}`)
);
console.log();

console.log("Mức màn hình — thứ khách thật sự nhìn và nghe, tính trên mỗi phiên 30 phút:");
console.log(`  còi tự kêu   trung bình ${meanAlertPct.toFixed(1)}% thời lượng   (phiên ồn nhất: ${worstAlertPct.toFixed(1)}%)`);
console.log(`  đợt cảnh báo trung bình ${meanEvents.toFixed(1)} đợt          (phiên ồn nhất: ${worstEvents} đợt)\n`);

drift.forEach((d, i) => {
  if (d.last > d.first * 1.2) {
    fail(`Vùng ${i + 1} trôi nền: ${d.first.toFixed(3)} → ${d.last.toFixed(3)} µSv/h`);
  }
});

// Người trình bày phải cầm được nhịp. Cấu hình cũ để còi tự kêu 23% thời lượng — cứ mỗi phút lại
// cắt ngang một lần. (Thước đo cũ vẫn báo "91% xanh" vì nó đo từng-vùng-từng-lần-đọc, không phải
// mức màn hình. Sai thước đo thì con số đẹp cũng vô nghĩa.)
if (meanAlertPct > 6) {
  fail(`Còi tự kêu trung bình ${meanAlertPct.toFixed(1)}% thời lượng (cần < 6%) — cướp nhịp người trình bày`);
}
if (worstAlertPct > 15) {
  fail(`Phiên ồn nhất có còi kêu ${worstAlertPct.toFixed(1)}% thời lượng (cần < 15%) — cái đuôi quá xấu`);
}
if (meanEvents > 8) {
  fail(`Trung bình ${meanEvents.toFixed(1)} đợt cảnh báo mỗi 30 phút (cần <= 8) — quá ồn để thuyết trình`);
}
if (meanEvents < 1) {
  fail(`Trung bình chỉ ${meanEvents.toFixed(1)} đợt cảnh báo mỗi 30 phút — hệ thống trông như đã chết`);
}

// ============================================================================
// 3. Cung bậc thời gian của một sự cố bị ép bằng nút demo
// ============================================================================

const MIN_RED_TICKS = 4; // >= 8 giây đèn đỏ
const MIN_TOTAL_ALERT_TICKS = 8; // >= 16 giây cảnh báo, đủ chụp ít nhất 2 ảnh ở chu kỳ 10s

function arcAfterForcedAlert(level) {
  return withFixedRandom(() => {
    HtgDataSource.resetAll();
    const arc = [];
    const stop = HtgDataSource.onUpdate((r) => arc.push(r.zones[0].status));
    try {
      HtgDataSource.forceAlert(1, level); // tự phát ra một lần đọc tức thì
      for (let t = 0; t < 40 && arc[arc.length - 1] !== "green"; t++) intervalFn();
      return arc;
    } finally {
      stop(); // BẮT BUỘC — listener sót lại từng làm các mảng arc ghi đè lẫn nhau
    }
  });
}

console.log("Cung bậc sự cố khi bấm nút demo (kịch bản tất định, trường hợp ngắn nhất):");
const arcs = {};
["red", "yellow"].forEach((level) => {
  const arc = arcAfterForcedAlert(level);
  const redTicks = arc.filter((s) => s === "red").length;
  const alertTicks = arc.filter((s) => s !== "green").length;
  arcs[level] = { arc, redTicks, alertTicks };
  console.log(
    `  ép ${level.toUpperCase().padEnd(6)} → đỏ ${redTicks} tick (${redTicks * TICK_SECONDS}s), ` +
      `cảnh báo tổng ${alertTicks} tick (${alertTicks * TICK_SECONDS}s), rồi về xanh`
  );
});
console.log();

if (arcs.red.redTicks < MIN_RED_TICKS) {
  fail(
    `Ép ĐỎ chỉ giữ đỏ ${arcs.red.redTicks} tick (${arcs.red.redTicks * TICK_SECONDS}s) — cần >= ` +
      `${MIN_RED_TICKS} tick để người xem kịp thấy đèn và nghe còi`
  );
}
if (arcs.red.alertTicks < MIN_TOTAL_ALERT_TICKS) {
  fail(
    `Ép ĐỎ chỉ cảnh báo ${arcs.red.alertTicks} tick — cần >= ${MIN_TOTAL_ALERT_TICKS} tick để chụp ` +
      `được ít nhất 2 ảnh ở chu kỳ 10 giây`
  );
}
if (arcs.yellow.arc.includes("red")) {
  fail("Ép VÀNG lại vọt lên mức đỏ — đỉnh spike vàng đang đặt quá sát ngưỡng đỏ");
}
if (arcs.yellow.alertTicks < 3) {
  fail(`Ép VÀNG chỉ cảnh báo ${arcs.yellow.alertTicks} tick — quá ngắn để thấy trên màn hình`);
}
["red", "yellow"].forEach((level) => {
  const arc = arcs[level].arc;
  if (arc[arc.length - 1] !== "green") {
    fail(`Ép ${level.toUpperCase()} không tự hồi phục về xanh trong 40 tick`);
  }
});

// ============================================================================
// 4. Các vùng phải độc lập với nhau
// ============================================================================
//
// Lỗi từng mắc: forceAlert() gọi emit() -> nextReading() -> tắt dần spike của CẢ BA vùng. Nên
// mỗi cú bấm nút là một nhịp decay tặng không cho các vùng khác. Bấm nút vùng 1 mười lần làm
// vùng 2 đang đỏ 3.08 µSv/h rơi xuống 0.71 vàng — đèn đổi màu, còi hạ từ hú xuống bíp, cho một
// vùng không ai động tới.

const zone2Trace = withFixedRandom(() => {
  HtgDataSource.resetAll();
  const seen = [];
  const stop = HtgDataSource.onUpdate((r) => seen.push(r.zones[1]));
  try {
    HtgDataSource.forceAlert(2, "red");
    const atStart = seen[seen.length - 1];
    for (let i = 0; i < 10; i++) HtgDataSource.forceAlert(1, "red"); // spam nút VÙNG KHÁC
    const afterSpam = seen[seen.length - 1];
    return { atStart, afterSpam };
  } finally {
    stop();
  }
});

console.log("Độc lập giữa các vùng — bấm nút Vùng 1 mười lần trong khi Vùng 2 đang ĐỎ:");
console.log(
  `  Vùng 2: ${zone2Trace.atStart.doseRate} µSv/h (${zone2Trace.atStart.status})  →  ` +
    `${zone2Trace.afterSpam.doseRate} µSv/h (${zone2Trace.afterSpam.status})\n`
);

if (zone2Trace.afterSpam.status !== "red") {
  fail(
    `Bấm nút Vùng 1 làm Vùng 2 tụt từ ĐỎ xuống ${zone2Trace.afterSpam.status.toUpperCase()} ` +
      `(${zone2Trace.atStart.doseRate} → ${zone2Trace.afterSpam.doseRate} µSv/h) — các vùng không độc lập`
  );
}

// ============================================================================

if (failures.length > 0) {
  console.error("FAIL:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log("PASS: nền không trôi, màn hình yên tĩnh, sự cố đủ dài rồi tự hồi phục, các vùng độc lập.");
