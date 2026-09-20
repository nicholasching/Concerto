import { PACKET_SYMBOLS, SYMBOL_MS, calibrationPacket, colorAt } from "./packet.js";

const colors = { red: "#FF0000", blue: "#0066FF" };
const setup = document.querySelector("#setup");
const flash = document.querySelector("#flash");
const status = document.querySelector("#status");
const deviceIdInput = document.querySelector("#device-id");
const runTagInput = document.querySelector("#run-tag");
const holdColorInput = document.querySelector("#hold-color");
const qr = document.querySelector("#qr");
const address = document.querySelector("#address");

let startedAt = null;
let frame = null;

function boundedInput(input, maximum) {
  const value = Number(input.value);
  const bounded = Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.trunc(value))) : 0;
  input.value = String(bounded);
  return bounded;
}

function settings() {
  return {
    deviceId: boundedInput(deviceIdInput, 2047),
    runTag: boundedInput(runTagInput, 255),
    holdColor: colors[holdColorInput.value],
  };
}

function stop() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  startedAt = null;
  flash.hidden = true;
  setup.hidden = false;
  document.documentElement.style.backgroundColor = "#101317";
}

function paint(now, currentSettings, packet) {
  if (startedAt === null) return;
  const elapsedMs = now - startedAt;
  const packetDurationMs = PACKET_SYMBOLS * SYMBOL_MS;
  flash.style.backgroundColor = colorAt(elapsedMs, currentSettings.holdColor, packet);
  status.textContent = elapsedMs < packetDurationMs
    ? `Running OTC packet for device ${currentSettings.deviceId}, tag ${currentSettings.runTag}`
    : `Holding ${holdColorInput.value}`;
  frame = requestAnimationFrame(nextNow => paint(nextNow, currentSettings, packet));
}

function start() {
  const currentSettings = settings();
  const packet = calibrationPacket(currentSettings.deviceId, currentSettings.runTag);
  void document.documentElement.requestFullscreen?.().catch(() => {});
  if (frame !== null) cancelAnimationFrame(frame);
  setup.hidden = true;
  flash.hidden = false;
  startedAt = performance.now();
  frame = requestAnimationFrame(now => paint(now, currentSettings, packet));
}

async function loadQr() {
  try {
    const response = await fetch("/qr.svg", { cache: "no-store" });
    if (!response.ok) throw new Error("QR request failed");
    const image = await response.blob();
    qr.src = URL.createObjectURL(image);
    address.textContent = response.headers.get("X-Debug-Phone-Url") ?? "Scan this QR code from the public address.";
  } catch {
    address.textContent = "Could not generate a QR code. Refresh the page after starting the debug server.";
  }
}

document.querySelector("#start").addEventListener("click", start);
document.querySelector("#restart").addEventListener("click", start);
document.querySelector("#stop").addEventListener("click", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && startedAt !== null) stop();
});

void loadQr();
