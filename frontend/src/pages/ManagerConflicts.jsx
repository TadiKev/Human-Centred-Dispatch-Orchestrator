import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import { Link } from "react-router-dom";

export default function ManagerConflicts() {
  const { auth } = useAuth();
  const token = auth?.access;
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch("/api/sync/conflicts/", { token });
      setConflicts(res.conflicts || []);
    } catch (e) {
      console.error("Failed to load conflicts", e);
      setConflicts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line
  }, [token]);

  async function resolveConflict(id, resolution, apply_change = null) {
    setResolving(id);
    try {
      const body = { resolution };
      if (apply_change) body.apply_change = apply_change;
      await apiFetch(`/api/sync/conflicts/${id}/resolve/`, { method: "POST", token, body });
      // reload
      await load();
    } catch (e) {
      console.error("resolve failed", e);
      alert("Resolve failed: " + (e.message || "unknown"));
    } finally {
      setResolving(null);
    }
  }

  if (!token) {
    return <div className="p-6">Sign in as manager to view conflicts. <Link to="/auth">Sign in</Link></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Sync Conflicts</h2>
        <div>
          <button className="px-3 py-1 border rounded" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {conflicts.length === 0 && !loading && <div className="text-sm text-slate-500">No outstanding conflicts.</div>}

      <ul className="space-y-4">
        {conflicts.map((c) => (
          <li key={c.id} className="p-4 border rounded bg-white">
            <div className="flex justify-between">
              <div className="pr-4">
                <div className="font-medium">Conflict #{c.id} — {c.event}</div>
                <div className="text-xs text-slate-600">Device: {c.device_id} • User: {c.user_username || c.user_id}</div>
                <div className="mt-2 text-sm">
                  <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(c.payload, null, 2)}</pre>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  className="px-3 py-1 rounded bg-slate-100 text-sm"
                  onClick={() => resolveConflict(c.id, "server")}
                  disabled={resolving === c.id}
                >
                  Keep server
                </button>

                <button
                  className="px-3 py-1 rounded bg-emerald-600 text-white text-sm"
                  onClick={() => {
                    const clientChange = c.payload && c.payload.client_change ? c.payload.client_change : null;
                    if (!clientChange && !window.confirm("No client change found in payload. Resolve as 'client' anyway?")) return;
                    resolveConflict(c.id, "client", clientChange);
                  }}
                  disabled={resolving === c.id}
                >
                  Apply client change
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
