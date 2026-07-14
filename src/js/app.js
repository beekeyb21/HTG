/**
 * app.js
 *
 * Điều phối: nhận dữ liệu từ HtgDataSource, hiển thị 3 vùng, điều khiển đèn/còi, chụp và
 * lưu ảnh camera mỗi 10 giây khi có cảnh báo (mục 6 tài liệu thiết kế).
 *
 * app.js KHÔNG biết hình ảnh đến từ canvas mô phỏng hay camera thật (HtgCameraSource), và
 * KHÔNG biết tiếng còi là oscillator hay file âm thanh (HtgAlarm). Khi cắm phần cứng thật,
 * thay ruột các module đó mà không phải sửa file này.
 *
 * Lưu ý về render: khung 3 thẻ vùng được dựng MỘT LẦN lúc khởi động, sau đó mỗi lần có dữ
 * liệu chỉ cập nhật phần thay đổi. Bản trước ghi đè innerHTML mỗi 2 giây, làm canvas camera
 * bị xóa và dựng lại liên tục — không thể gắn hình ảnh vào thẻ vùng theo cách đó.
 */

const SNAPSHOT_INTERVAL_MS = 10_000;
const MAX_SNAPSHOTS = 60; // giữ 60 ảnh gần nhất; demo 30 phút có thể sinh hàng trăm ảnh
const MAX_LOG_ENTRIES = 50;
const SEVERITY = { green: 0, yellow: 1, red: 2 };

const dom = {
  zones: document.getElementById("zones"),
  controls: document.getElementById("zone-controls"),
  soundBtn: document.getElementById("sound-btn"),
  resetBtn: document.getElementById("reset-btn"),
  logList: document.getElementById("log-list"),
  gallery: document.getElementById("gallery"),
  galleryEmpty: document.getElementById("gallery-empty"),
  galleryNote: document.getElementById("gallery-note"),
  envTemp: document.getElementById("env-temp"),
  envHumidity: document.getElementById("env-humidity"),
  envPressure: document.getElementById("env-pressure"),
  modal: document.getElementById("modal"),
  modalImage: document.getElementById("modal-image"),
  modalCaption: document.getElementById("modal-caption"),
  modalClose: document.getElementById("modal-close"),
};

const zoneEls = {}; // zoneId -> { card, doseValue, statusLabel, snapCount }
const zoneState = {}; // zoneId -> { status, captureTimer, snapshotCount }

let latestReading = null;
let alertLog = [];
let snapshotCountTotal = 0;
let snapshotsShown = 0;
let built = false;

function statusText(status) {
  if (status === "red") return "Cảnh báo cao";
  if (status === "yellow") return "Cảnh báo thấp";
  return "Bình thường";
}

// --- Dựng khung (chạy một lần) ----------------------------------------------

function buildZoneCards(zones) {
  zones.forEach((zone) => {
    const card = document.createElement("article");
    card.className = "zone-card status-green";

    const header = document.createElement("div");
    header.className = "zone-header";
    const title = document.createElement("h2");
    title.textContent = zone.label;
    const light = document.createElement("span");
    light.className = "status-light";
    light.title = "Đèn trạng thái";
    header.append(title, light);

    const feed = document.createElement("div");
    feed.className = "camera-feed";

    const dose = document.createElement("div");
    dose.className = "dose-value";
    const doseValue = document.createElement("span");
    const doseUnit = document.createElement("span");
    doseUnit.className = "dose-unit";
    doseUnit.textContent = zone.unit;
    dose.append(doseValue, doseUnit);

    const footer = document.createElement("div");
    footer.className = "zone-footer";
    const statusLabel = document.createElement("span");
    statusLabel.className = "status-label";
    const snapCount = document.createElement("span");
    snapCount.className = "snapshot-count";
    footer.append(statusLabel, snapCount);

    card.append(header, feed, dose, footer);
    dom.zones.appendChild(card);

    zoneEls[zone.zoneId] = { card, doseValue, statusLabel, snapCount };
    zoneState[zone.zoneId] = { status: "green", captureTimer: null, snapshotCount: 0 };

    HtgCameraSource.mount(zone.zoneId, feed);
  });
}

function buildZoneControls(zones) {
  zones.forEach((zone) => {
    const group = document.createElement("div");
    group.className = "control-group";

    const label = document.createElement("span");
    label.className = "control-label";
    label.textContent = zone.label;
    group.appendChild(label);

    [
      { level: "yellow", text: "Vàng" },
      { level: "red", text: "Đỏ" },
    ].forEach(({ level, text }) => {
      const btn = document.createElement("button");
      btn.className = `ctrl-btn ctrl-${level}`;
      btn.textContent = text;
      btn.addEventListener("click", () => HtgDataSource.forceAlert(zone.zoneId, level));
      group.appendChild(btn);
    });

    dom.controls.appendChild(group);
  });
}

// --- Cập nhật theo từng lần đọc ---------------------------------------------

function updateZones(zones) {
  zones.forEach((zone) => {
    const els = zoneEls[zone.zoneId];
    els.card.className = `zone-card status-${zone.status}`;
    els.doseValue.textContent = zone.doseRate.toFixed(3);
    els.statusLabel.textContent = statusText(zone.status);
    HtgCameraSource.setStatus(zone.zoneId, zone.status);
  });
}

function updateEnv(env) {
  dom.envTemp.textContent = `${env.temperature} °C`;
  dom.envHumidity.textContent = `${env.humidity} %RH`;
  dom.envPressure.textContent = `${env.pressure} hPa`;
}

function highestSeverity(zones) {
  return zones.reduce(
    (worst, zone) => (SEVERITY[zone.status] > SEVERITY[worst] ? zone.status : worst),
    "green"
  );
}

// --- Nhật ký cảnh báo -------------------------------------------------------

function logAlert(zone, timestamp) {
  alertLog.unshift({
    zoneLabel: zone.label,
    status: zone.status,
    doseRate: zone.doseRate,
    unit: zone.unit,
    time: timestamp,
  });
  alertLog = alertLog.slice(0, MAX_LOG_ENTRIES);
  renderLog();
}

function renderLog() {
  dom.logList.textContent = "";

  if (alertLog.length === 0) {
    const empty = document.createElement("p");
    empty.className = "log-empty";
    empty.textContent = "Chưa có cảnh báo nào.";
    dom.logList.appendChild(empty);
    return;
  }

  alertLog.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `log-entry level-${entry.status}`;

    const what = document.createElement("span");
    what.textContent = `${entry.zoneLabel} — ${statusText(entry.status)} (${entry.doseRate} ${entry.unit})`;

    const when = document.createElement("span");
    when.textContent = entry.time.toLocaleTimeString("vi-VN");

    row.append(what, when);
    dom.logList.appendChild(row);
  });
}

// --- Chụp và lưu bằng chứng -------------------------------------------------

/**
 * Chụp ảnh camera của một vùng kèm giá trị đo TẠI THỜI ĐIỂM CHỤP.
 *
 * Tra cứu suất liều từ lần đọc mới nhất chứ không giữ tham chiếu tới object zone lúc cảnh
 * báo bắt đầu — tài liệu thiết kế yêu cầu "lưu trữ giá trị đo suất liều cùng với hình ảnh
 * tại từng thời điểm". Bản trước đóng băng giá trị đo của lúc cảnh báo mới nổ, nên mọi ảnh
 * sau đó đều ghi sai số đo.
 */
function captureSnapshot(zoneId) {
  const zone = latestReading && latestReading.zones.find((z) => z.zoneId === zoneId);
  if (!zone) return;

  // Ảnh có thể chụp hỏng (canvas bị nhiễm bẩn bởi nguồn cross-origin). Vẫn ghi lại số đo —
  // mất ảnh thì thà giữ được số liệu còn hơn mất cả hai.
  const image = HtgCameraSource.grabFrame(zoneId);

  addSnapshotToGallery({
    zoneLabel: zone.label,
    doseRate: zone.doseRate,
    unit: zone.unit,
    status: zone.status,
    time: new Date(),
    image,
  });

  const state = zoneState[zoneId];
  state.snapshotCount++;
  zoneEls[zoneId].snapCount.textContent = `${state.snapshotCount} ảnh đã lưu`;
}

function addSnapshotToGallery(snap) {
  snapshotCountTotal++;

  if (dom.galleryEmpty) dom.galleryEmpty.hidden = true;

  const item = document.createElement("figure");
  item.className = `snapshot level-${snap.status}`;

  if (snap.image) {
    const img = document.createElement("img");
    img.src = snap.image;
    img.alt = `${snap.zoneLabel} lúc ${snap.time.toLocaleTimeString("vi-VN")}`;
    item.appendChild(img);
    item.addEventListener("click", () => openModal(snap));
  } else {
    const failed = document.createElement("div");
    failed.className = "snapshot-failed";
    failed.textContent = "Không chụp được ảnh";
    item.appendChild(failed);
  }

  const caption = document.createElement("figcaption");
  const dose = document.createElement("strong");
  dose.textContent = `${snap.doseRate} ${snap.unit}`;
  const meta = document.createElement("span");
  meta.textContent = `${snap.zoneLabel} · ${snap.time.toLocaleTimeString("vi-VN")}`;
  caption.append(dose, meta);
  item.appendChild(caption);

  dom.gallery.prepend(item);
  snapshotsShown++;

  // Chặn phình bộ nhớ: mỗi ảnh data URL cỡ 25 KB, demo dài có thể sinh hàng trăm ảnh.
  while (snapshotsShown > MAX_SNAPSHOTS) {
    dom.gallery.removeChild(dom.gallery.lastElementChild);
    snapshotsShown--;
  }

  const dropped = snapshotCountTotal - snapshotsShown;
  dom.galleryNote.textContent =
    dropped > 0
      ? `Hiện ${snapshotsShown} ảnh gần nhất — còn ${dropped} ảnh cũ hơn đã lược bớt khỏi bộ nhớ demo.`
      : `Đã lưu ${snapshotCountTotal} ảnh.`;
}

function openModal(snap) {
  dom.modalImage.src = snap.image;
  dom.modalCaption.textContent = `${snap.zoneLabel} — ${snap.doseRate} ${snap.unit} — ${snap.time.toLocaleString("vi-VN")}`;
  dom.modal.hidden = false;
}

function closeModal() {
  dom.modal.hidden = true;
  dom.modalImage.src = "";
}

// --- Chuyển trạng thái vùng -------------------------------------------------

function handleZoneStatusChange(zone, timestamp) {
  const state = zoneState[zone.zoneId];
  const wasAlerting = state.status !== "green";
  const isAlerting = zone.status !== "green";

  if (isAlerting && !wasAlerting) {
    // Bắt đầu cảnh báo: ghi log, chụp ngay một ảnh, rồi chụp đều mỗi 10 giây.
    logAlert(zone, timestamp);
    captureSnapshot(zone.zoneId);
    state.captureTimer = setInterval(() => captureSnapshot(zone.zoneId), SNAPSHOT_INTERVAL_MS);
  } else if (!isAlerting && wasAlerting) {
    // Hết cảnh báo: dừng chụp. Bắt buộc clear, nếu không timer tích tụ qua mỗi chu kỳ cảnh báo.
    clearInterval(state.captureTimer);
    state.captureTimer = null;
  } else if (isAlerting && zone.status !== state.status) {
    // Đổi mức nghiêm trọng (vàng → đỏ hoặc ngược lại) — ghi log, timer chụp vẫn chạy tiếp.
    logAlert(zone, timestamp);
  }

  state.status = zone.status;
}

// --- Vòng đời ---------------------------------------------------------------

function handleReading(reading) {
  latestReading = reading;

  if (!built) {
    buildZoneCards(reading.zones);
    buildZoneControls(reading.zones);
    built = true;
  }

  updateZones(reading.zones);
  updateEnv(reading.env);
  reading.zones.forEach((zone) => handleZoneStatusChange(zone, reading.timestamp));
  HtgAlarm.setLevel(highestSeverity(reading.zones));
}

function renderSoundButton({ unlocked, muted }) {
  if (!unlocked) {
    dom.soundBtn.textContent = "🔇 Bấm để bật tiếng";
    dom.soundBtn.className = "sound-btn locked";
  } else if (muted) {
    dom.soundBtn.textContent = "🔇 Đã tắt tiếng";
    dom.soundBtn.className = "sound-btn muted";
  } else {
    dom.soundBtn.textContent = "🔊 Đang bật tiếng";
    dom.soundBtn.className = "sound-btn on";
  }
}

// Trình duyệt chặn phát âm thanh cho tới khi người dùng thao tác thật — lần bấm đầu tiên mở
// AudioContext, các lần sau chuyển thành nút tắt/bật tiếng.
//
// Điều kiện phải là isUnlocked(), KHÔNG phải isReady(). Trên Safari, AudioContext còn ở trạng
// thái "suspended" vài chục ms sau cú bấm đầu tiên; nếu dựa vào isReady() thì trong khe đó nút
// vẫn báo "chưa bật", người trình bày bấm lần nữa và cú bấm ấy rơi vào nhánh TẮT TIẾNG.
dom.soundBtn.addEventListener("click", () => {
  if (!HtgAlarm.isUnlocked()) HtgAlarm.unlock();
  else HtgAlarm.setMuted(!HtgAlarm.isMuted());
});
HtgAlarm.onChange(renderSoundButton);
renderSoundButton({ unlocked: false, muted: false });

dom.resetBtn.addEventListener("click", () => HtgDataSource.resetAll());
dom.modalClose.addEventListener("click", closeModal);
dom.modal.addEventListener("click", (e) => {
  if (e.target === dom.modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dom.modal.hidden) closeModal();
});

HtgDataSource.onUpdate(handleReading);
HtgDataSource.start();
