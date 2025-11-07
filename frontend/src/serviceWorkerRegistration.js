// src/serviceWorkerRegistration.js
export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        console.log("ServiceWorker registered", reg.scope);
      } catch (e) {
        console.warn("ServiceWorker registration failed", e);
      }
    });
  }
}
