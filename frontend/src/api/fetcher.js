// frontend/src/api/fetcher.js
// Robust fetch helper:
// - If path is absolute (http:// or https://) it is used unchanged.
// - If path already starts with /api it is used unchanged.
// - Otherwise /api is prepended so calls like "/auto_assign/..." hit the backend proxy.
// - Handles JSON and FormData bodies.
// - Safer error handling to avoid reading properties of null.

function normalizePath(path) {
  if (!path) throw new Error("apiFetch: missing path");
  // absolute url -> return unchanged
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // already points to api -> use as-is
  if (path.startsWith("/api")) return path;
  // path starts with "/" but not "/api" -> prefix "/api"
  if (path.startsWith("/")) return `/api${path}`;
  // no leading slash -> prefix "/api/"
  return `/api/${path}`;
}

export async function apiFetch(path, { method = "GET", body = null, token = null } = {}) {
  const url = normalizePath(path);

  const headers = {};
  const isFormData = body instanceof FormData;
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const options = { method, headers };
  if (body != null) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    // Network-level error (CORS, backend down, etc.)
    console.error("apiFetch network error:", networkErr, { url, options });
    const e = new Error("Network error while calling API. Is the backend running?");
    e.cause = networkErr;
    throw e;
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; }
  catch (e) { data = text; } // non-JSON response -> keep raw text

  if (!res.ok) {
    // Build a helpful message without assuming data is an object
    let errMsg;
    if (data && typeof data === "object") {
      // DRF typical shape: { detail: "..."} or validation errors
      if (data.detail) errMsg = data.detail;
      else errMsg = JSON.stringify(data);
    } else if (data) {
      errMsg = String(data);
    } else {
      errMsg = res.statusText || `HTTP ${res.status}`;
    }
    const e = new Error(errMsg);
    e.status = res.status;
    e.response = data;
    console.error("apiFetch HTTP error", { url, status: res.status, response: data });
    throw e;
  }

  return data;
}
