// src/tech/device.js
export function getDeviceId() {
  let d = localStorage.getItem("device_id");
  if (!d) {
    d = `dev-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem("device_id", d);
  }
  return d;
}
