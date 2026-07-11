/**
 * mock-data.js
 *
 * Mô phỏng dữ liệu từ thân thiết bị HTG (3 đầu đo phóng xạ + cảm biến môi trường)
 * cho đến khi kết nối phần cứng thật.
 *
 * Khi tích hợp phần cứng: thay module này bằng một nguồn dữ liệu thật
 * (REST polling hoặc WebSocket) miễn là nó cung cấp cùng interface:
 *   HtgDataSource.onUpdate(callback)
 *   callback(reading) nhận: { zones: [...], env: {...} }
 */

const HtgDataSource = (() => {
  const ZONE_COUNT = 3;
  const YELLOW_THRESHOLD = 0.5; // µSv/h
  const RED_THRESHOLD = 1.2;    // µSv/h
  const UPDATE_INTERVAL_MS = 2000;

  let listeners = [];
  let baseline = Array.from({ length: ZONE_COUNT }, () => 0.15 + Math.random() * 0.1);

  function classify(dose) {
    if (dose >= RED_THRESHOLD) return "red";
    if (dose >= YELLOW_THRESHOLD) return "yellow";
    return "green";
  }

  function nextReading() {
    // Small random walk per zone, with an occasional simulated spike
    // so the alert flow (yellow/red, siren, snapshot capture) can be observed.
    const zones = baseline.map((base, i) => {
      const spikeChance = Math.random();
      let dose = base + (Math.random() - 0.5) * 0.05;

      if (spikeChance > 0.96) {
        dose = RED_THRESHOLD + Math.random() * 0.6; // simulate red spike
      } else if (spikeChance > 0.88) {
        dose = YELLOW_THRESHOLD + Math.random() * 0.3; // simulate yellow spike
      }

      dose = Math.max(0.05, dose);
      baseline[i] = baseline[i] * 0.7 + dose * 0.3; // drift baseline slowly

      return {
        zoneId: i + 1,
        label: `Vị trí ${i + 1}`,
        doseRate: Number(dose.toFixed(3)),
        unit: "µSv/h",
        status: classify(dose),
      };
    });

    const env = {
      temperature: Number((25 + Math.random() * 4).toFixed(1)),
      humidity: Number((55 + Math.random() * 10).toFixed(1)),
      pressure: Number((1008 + Math.random() * 6).toFixed(1)),
    };

    return { zones, env, timestamp: new Date() };
  }

  function start() {
    setInterval(() => {
      const reading = nextReading();
      listeners.forEach((cb) => cb(reading));
    }, UPDATE_INTERVAL_MS);

    // Emit one immediately so the UI isn't empty on load.
    setTimeout(() => {
      const reading = nextReading();
      listeners.forEach((cb) => cb(reading));
    }, 200);
  }

  function onUpdate(callback) {
    listeners.push(callback);
  }

  return { onUpdate, start, ZONE_COUNT, YELLOW_THRESHOLD, RED_THRESHOLD };
})();
