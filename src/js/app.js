/**
 * app.js
 *
 * Hiển thị dữ liệu 3 vùng, quản lý trạng thái đèn/còi, và mô phỏng chụp ảnh
 * camera mỗi 10s khi có cảnh báo (theo mô tả thiết kế: mục "Phần mềm trên máy tính").
 *
 * Nguồn dữ liệu (HtgDataSource) được tách riêng khỏi phần hiển thị này,
 * nên khi thay bằng dữ liệu thật, chỉ cần đảm bảo HtgDataSource.onUpdate
 * trả về cùng cấu trúc { zones, env, timestamp }.
 */

const zonesContainer = document.getElementById("zones");
const logList = document.getElementById("log-list");
const envTemp = document.getElementById("env-temp");
const envHumidity = document.getElementById("env-humidity");
const envPressure = document.getElementById("env-pressure");

const SNAPSHOT_INTERVAL_MS = 10_000;
const zoneState = {}; // zoneId -> { status, captureTimer, snapshots: [] }
let alertLog = [];

function renderZoneCard(zone) {
  return `
    <article class="zone-card status-${zone.status}" data-zone-id="${zone.zoneId}">
      <div class="zone-header">
        <h2>${zone.label}</h2>
        <span class="status-light" title="Trạng thái"></span>
      </div>
      <div class="camera-feed ${zone.status !== "green" ? "recording" : ""}">
        Camera ${zone.zoneId} — chưa kết nối nguồn hình ảnh thật
      </div>
      <div class="dose-value">
        ${zone.doseRate}<span class="dose-unit">${zone.unit}</span>
      </div>
      <div class="zone-footer">
        <span class="status-label">${statusText(zone.status)}</span>
        <span class="snapshot-count" id="snap-count-${zone.zoneId}"></span>
      </div>
    </article>
  `;
}

function statusText(status) {
  if (status === "red") return "Cảnh báo cao";
  if (status === "yellow") return "Cảnh báo thấp";
  return "Bình thường";
}

function renderZones(zones) {
  zonesContainer.innerHTML = zones.map(renderZoneCard).join("");
}

function updateEnv(env) {
  envTemp.textContent = `${env.temperature} °C`;
  envHumidity.textContent = `${env.humidity} %RH`;
  envPressure.textContent = `${env.pressure} hPa`;
}

function logAlert(zone, timestamp) {
  alertLog.unshift({
    zoneLabel: zone.label,
    status: zone.status,
    doseRate: zone.doseRate,
    unit: zone.unit,
    time: timestamp,
  });
  alertLog = alertLog.slice(0, 50); // keep last 50 entries
  renderLog();
}

function renderLog() {
  if (alertLog.length === 0) {
    logList.innerHTML = `<p class="log-empty">Chưa có cảnh báo nào.</p>`;
    return;
  }
  logList.innerHTML = alertLog
    .map(
      (entry) => `
      <div class="log-entry level-${entry.status}">
        <span>${entry.zoneLabel} — ${statusText(entry.status)} (${entry.doseRate} ${entry.unit})</span>
        <span>${entry.time.toLocaleTimeString("vi-VN")}</span>
      </div>
    `
    )
    .join("");
}

function ensureZoneState(zoneId) {
  if (!zoneState[zoneId]) {
    zoneState[zoneId] = { status: "green", captureTimer: null, snapshots: [] };
  }
  return zoneState[zoneId];
}

/**
 * Simulate periodic camera-image capture while a zone is in alert state,
 * matching the design spec: "chụp lại hình ảnh camera ... theo chu kỳ 10s/1 hình ảnh".
 * Replace captureSnapshot() with a real call to the camera/API when hardware is connected.
 */
function captureSnapshot(zone) {
  const state = ensureZoneState(zone.zoneId);
  state.snapshots.push({
    time: new Date(),
    doseRate: zone.doseRate,
    // placeholder: in production, store the actual image blob/URL from the camera feed
    imageRef: `snapshot-zone${zone.zoneId}-${Date.now()}.jpg (mô phỏng)`,
  });

  const countEl = document.getElementById(`snap-count-${zone.zoneId}`);
  if (countEl) countEl.textContent = `${state.snapshots.length} ảnh đã lưu`;
}

function handleZoneStatusChange(zone, timestamp) {
  const state = ensureZoneState(zone.zoneId);
  const enteringAlert = zone.status !== "green" && state.status === "green";
  const leavingAlert = zone.status === "green" && state.status !== "green";

  if (enteringAlert) {
    logAlert(zone, timestamp);
    captureSnapshot(zone); // capture immediately on alert start
    state.captureTimer = setInterval(() => captureSnapshot(zone), SNAPSHOT_INTERVAL_MS);
  } else if (leavingAlert && state.captureTimer) {
    clearInterval(state.captureTimer);
    state.captureTimer = null;
  } else if (zone.status !== "green" && zone.status !== state.status) {
    // severity changed (e.g. yellow -> red) — log it too
    logAlert(zone, timestamp);
  }

  state.status = zone.status;
}

function handleReading(reading) {
  renderZones(reading.zones);
  updateEnv(reading.env);
  reading.zones.forEach((zone) => handleZoneStatusChange(zone, reading.timestamp));
}

HtgDataSource.onUpdate(handleReading);
HtgDataSource.start();
