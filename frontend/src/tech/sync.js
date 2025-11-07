// src/tech/sync.js
import { cacheJobs, getOutbox, removeOutboxItem } from "./idb";
import { getDeviceId } from "./device";
import { apiFetch } from "../api/fetcher";

/**
 * Pull assigned jobs for technician (techId can be "me")
 * Returns server response (object with { server_ts, jobs })
 */
export async function pullAssignedJobs(techId, token, since = null) {
  const path = `/api/tech/${techId}/jobs/` + (since ? `?since=${encodeURIComponent(since)}` : "");
  const res = await apiFetch(path, { method: "GET", token });
  const jobs = res.jobs || res;
  if (Array.isArray(jobs)) {
    await cacheJobs(jobs);
  }
  return res;
}

/**
 * Push local outbox to server. Removes items on success.
 * Returns { pushed: number, response }
 */
export async function pushOutbox(token) {
  const outbox = await getOutbox();
  if (!outbox || outbox.length === 0) return { pushed: 0 };

  const events = outbox.map(it => ({
    event: it.event,
    payload: it.payload,
    client_ts: it.client_ts || it.queued_at,
  }));

  const payload = {
    device_id: getDeviceId(),
    last_synced_at: new Date().toISOString(),
    events,
  };

  const res = await apiFetch("/api/sync/", { method: "POST", body: payload, token });
  if (res && res.result) {
    // best-effort: remove all outbox items if server responded
    for (const item of outbox) {
      try {
        await removeOutboxItem(item.cid);
      } catch (e) {
        // non-fatal
        console.warn("Failed to remove outbox item", item, e);
      }
    }
  }
  return { pushed: outbox.length, response: res };
}
