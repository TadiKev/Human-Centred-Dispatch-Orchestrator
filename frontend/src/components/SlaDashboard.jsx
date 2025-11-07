// frontend/src/components/SlaDashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, Tooltip } from "recharts";
import { useTheme } from "../theme/ThemeProvider";

/**
 * SlaDashboard (theme-aware)
 *
 * - Uses the global useTheme hook to pick classes & inline styles so dark mode text stays readable (white).
 * - Adds a small scoped <style> block that relies on the [data-theme] CSS variables (ManagerLayout sets data-theme)
 *   so any tables / <pre> inside will pick up correct colors even if they don't receive Tailwind classes.
 * - Keeps original behavior and features (server/client paging, run check, mitigation modal, exports).
 */

const RISK_ORDER = { high: 2, medium: 1, low: 0 };

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function formatIso(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function riskPill(level, theme) {
  const l = (level || "low").toLowerCase();
  // In dark mode pick darker tinted backgrounds with light text, in light mode pick pale backgrounds with darker text
  if (l === "high") {
    return theme === "dark"
      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "#7f1d1d", color: "#fee2e2" }}>HIGH</span>
      : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800">HIGH</span>;
  }
  if (l === "medium") {
    return theme === "dark"
      ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "#713f12", color: "#ffedd5" }}>MED</span>
      : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">MED</span>;
  }
  return theme === "dark"
    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={{ background: "#065f46", color: "#d1fae5" }}>LOW</span>
    : <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">LOW</span>;
}

/* small table row component */
function Row({ it, checked, onToggle, onOpen, theme }) {
  return (
    <tr className={theme === "dark" ? "hover:bg-slate-800" : "hover:bg-gray-50"}>
      <td className="px-4 py-3 text-sm">
        <input type="checkbox" checked={checked} onChange={() => onToggle(it)} aria-label={`select job ${it.job_id}`} />
      </td>
      <td className="px-4 py-3 text-sm font-semibold">{`#${it.job_id}`}</td>
      <td className="px-4 py-3 text-sm">{it.recommended_action || "—"}</td>
      <td className="px-4 py-3 text-sm">
        {riskPill(it.risk_level, theme)}
        <span className="ml-2 text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>
          {(it.risk_score || 0).toFixed(2)}
        </span>
      </td>
      <td className="px-4 py-3 text-sm">{it.suggested_technician?.username || "—"}</td>
      <td className="px-4 py-3 text-sm">{formatIso(it.created_at)}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-2">
          <button onClick={() => onOpen(it)} className="px-2 py-1 bg-indigo-600 text-white rounded text-sm">Mitigate</button>
          <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(it.meta || {}))} className="px-2 py-1 border rounded text-sm">Diag</button>
        </div>
      </td>
    </tr>
  );
}

export default function SlaDashboard({
  apiBaseUrl = "/api",
  getAuthToken = null,
  pollInterval = 60_000,
  runTaskUrl = null,
}) {
  const { theme } = useTheme();

  // theme shortcuts
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const mutedClass = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const cardBg = theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900";
  const panelSurface = theme === "dark" ? "bg-slate-700" : "bg-white";
  const smallBtn = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-gray-100 text-slate-900";
  const tableHeadClass = theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-slate-50 text-slate-800";

  // data states
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [polling, setPolling] = useState(true);
  const [error, setError] = useState(null);

  // filters & UI
  const [search, setSearch] = useState("");
  const [filterRisk, setFilterRisk] = useState("all");
  const [sortBy, setSortBy] = useState("risk");
  const [sortDir, setSortDir] = useState("desc");

  // selection & modal
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // toast
  const [toast, setToast] = useState(null);

  // pagination
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [serverPaging, setServerPaging] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);

  // selection map
  const [selectedMap, setSelectedMap] = useState({});

  // token & headers
  const token = useCallback(() => {
    if (typeof getAuthToken === "function") return getAuthToken();
    return localStorage.getItem("access") || null;
  }, [getAuthToken]);

  const defaultHeaders = useCallback(() => {
    const h = { "Content-Type": "application/json" };
    const t = token();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }, [token]);

  const normalizeResponse = useCallback((json) => {
    if (!json) return { items: [], count: 0, serverPaging: false };
    if (Array.isArray(json)) return { items: json, count: json.length, serverPaging: false };
    if (Array.isArray(json.results)) {
      return { items: json.results, count: json.count ?? json.results.length, serverPaging: true };
    }
    if (Array.isArray(json.items)) return { items: json.items, count: json.items.length, serverPaging: false };
    return { items: json.items || [], count: json.count || 0, serverPaging: Boolean(json.next || json.previous) };
  }, []);

  const fetchOverview = useCallback(async (opts = {}) => {
    const { page: p = page, pageSize: ps = pageSize, signal = null } = opts;
    setLoading(true);
    setError(null);
    try {
      const base = apiBaseUrl.replace(/\/$/, "");
      const url = new URL(`${base}/sla/overview/`, window.location.origin);
      if (p && ps) {
        url.searchParams.set("page", String(p));
        url.searchParams.set("page_size", String(ps));
      }
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: defaultHeaders(),
        signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Server ${res.status}: ${txt}`);
      }
      const json = await res.json().catch(() => ({}));
      const { items: newItems, count, serverPaging: isServer } = normalizeResponse(json);
      setServerPaging(isServer);
      setTotalCount(count ?? (newItems?.length ?? 0));
      setItems(newItems.map((it) => ({ ...it, meta: it.meta || {} })));
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("fetchOverview error", err);
        setError(err.message || "Failed to load SLA overview");
      }
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, defaultHeaders, page, pageSize, normalizeResponse]);

  // initial load + polling
  useEffect(() => {
    const ctl = new AbortController();
    fetchOverview({ page, pageSize, signal: ctl.signal });
    let t = null;
    if (polling) {
      t = setInterval(() => fetchOverview({ page, pageSize }).catch(() => {}), pollInterval);
    }
    return () => {
      ctl.abort();
      if (t) clearInterval(t);
    };
  }, [fetchOverview, polling, pollInterval, page, pageSize]);

  // derived data
  const processed = useMemo(() => {
    let arr = Array.isArray(items) ? items.slice() : [];
    const q = (search || "").trim().toLowerCase();
    if (!serverPaging) {
      if (filterRisk !== "all") arr = arr.filter(it => (it.risk_level || "low").toLowerCase() === filterRisk);
      if (q) {
        arr = arr.filter(it =>
          String(it.job_id).includes(q) ||
          (it.reason || "").toLowerCase().includes(q) ||
          (it.suggested_technician?.username || "").toLowerCase().includes(q)
        );
      }
    }
    arr.sort((a, b) => {
      let v = 0;
      if (sortBy === "risk") {
        v = (RISK_ORDER[b.risk_level] || 0) - (RISK_ORDER[a.risk_level] || 0);
        if (v === 0) v = (b.risk_score || 0) - (a.risk_score || 0);
      } else if (sortBy === "created") {
        v = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      } else if (sortBy === "job") {
        v = (a.job_id || 0) - (b.job_id || 0);
      }
      return sortDir === "asc" ? -v : v;
    });

    if (serverPaging) {
      return { rows: arr, total: totalCount };
    }
    const total = arr.length;
    const start = (page - 1) * pageSize;
    const rows = arr.slice(start, start + pageSize);
    return { rows, total };
  }, [items, search, filterRisk, sortBy, sortDir, page, pageSize, serverPaging, totalCount]);

  const kpis = useMemo(() => {
    if (serverPaging) {
      const high = items.filter(i => i.risk_level === "high").length;
      const medium = items.filter(i => i.risk_level === "medium").length;
      const low = items.filter(i => i.risk_level === "low").length;
      const avgRisk = items.length ? items.reduce((s, it) => s + (it.risk_score || 0), 0) / items.length : 0;
      return { total: totalCount, high, medium, low, avgRisk };
    }
    const total = items.length;
    const high = items.filter(i => i.risk_level === "high").length;
    const medium = items.filter(i => i.risk_level === "medium").length;
    const low = items.filter(i => i.risk_level === "low").length;
    const avgRisk = items.length ? items.reduce((s, it) => s + (it.risk_score || 0), 0) / items.length : 0;
    return { total, high, medium, low, avgRisk };
  }, [items, serverPaging, totalCount]);

  const riskChartData = useMemo(() => [
    { label: "High", count: kpis.high },
    { label: "Medium", count: kpis.medium },
    { label: "Low", count: kpis.low },
  ], [kpis.high, kpis.medium, kpis.low]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const runCheckNow = useCallback(async () => {
    if (!runTaskUrl) {
      setToast({ type: "info", text: "Refreshing data..." });
      await fetchOverview({ page, pageSize }).catch(() => {});
      return;
    }
    setRunLoading(true);
    try {
      const res = await fetch(runTaskUrl, { method: "POST", headers: defaultHeaders() });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Run task failed ${res.status}: ${txt}`);
      }
      setToast({ type: "success", text: "Background SLA re-check started" });
      setTimeout(() => fetchOverview({ page, pageSize }).catch(() => {}), 800);
    } catch (err) {
      console.error("runCheckNow error", err);
      setToast({ type: "error", text: err.message || "Failed to run check" });
    } finally {
      setRunLoading(false);
    }
  }, [runTaskUrl, defaultHeaders, fetchOverview, page, pageSize]);

  // mitigate (POST)
  const postMitigate = useCallback(async (body) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/sla/mitigate/`, {
        method: "POST",
        headers: defaultHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.detail || `Server ${res.status}`);
      }
      setToast({ type: "success", text: "Action applied" });
      await fetchOverview({ page, pageSize }).catch(() => {});
      setShowModal(false);
      setSelected(null);
      return json;
    } catch (err) {
      console.error("postMitigate error", err);
      setToast({ type: "error", text: err.message || "Failed to apply action" });
      throw err;
    } finally {
      setActionLoading(false);
    }
  }, [apiBaseUrl, defaultHeaders, fetchOverview, page, pageSize]);

  const handleAssignCandidate = async (candidate) => {
    if (!selected || !candidate) return;
    try {
      await postMitigate({ job_id: selected.job_id, action: "reassign", target_technician_id: candidate.technician_id });
    } catch {}
  };

  const handleForceReassign = async () => {
    if (!selected) return setToast({ type: "error", text: "No job selected" });
    if (!overrideReason || overrideReason.trim().length < 3) return setToast({ type: "error", text: "Provide override reason (min 3 chars)" });
    try {
      await postMitigate({ job_id: selected.job_id, action: "reassign", override: true, override_reason: overrideReason.trim() });
      setOverrideReason("");
    } catch {}
  };

  const handleNotify = async () => {
    if (!selected) return;
    try {
      await postMitigate({ job_id: selected.job_id, action: "notify", message: "Dispatcher notification" });
    } catch {}
  };

  const exportJson = () => {
    const data = items;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla_items_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const data = items;
    if (!data || data.length === 0) {
      setToast({ type: "info", text: "No items to export" });
      return;
    }
    const cols = ["id","job_id","recommended_action","risk_level","risk_score","created_at","suggested_technician"];
    const rows = data.map(it => [
      it.id, it.job_id, it.recommended_action, it.risk_level, it.risk_score, it.created_at,
      it.suggested_technician?.username || ""
    ]);
    const csv = [cols.join(","), ...rows.map(r => r.map(c => `"${String(c||"").replace(/"/g,'""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla_items_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // bulk notify
  const bulkNotify = async () => {
    const selectedList = Object.values(selectedMap).filter(Boolean);
    if (selectedList.length === 0) return setToast({ type: "info", text: "No items selected" });
    setActionLoading(true);
    try {
      for (const it of selectedList) {
        await fetch(`${apiBaseUrl.replace(/\/$/, "")}/sla/mitigate/`, {
          method: "POST",
          headers: defaultHeaders(),
          body: JSON.stringify({ job_id: it.job_id, action: "notify" }),
        }).catch(() => {});
      }
      setToast({ type: "success", text: `Notified ${selectedList.length} jobs` });
      await fetchOverview({ page, pageSize }).catch(() => {});
      setSelectedMap({});
    } finally {
      setActionLoading(false);
    }
  };

  const toggleRow = (it) => {
    setSelectedMap(prev => {
      const next = { ...prev };
      const key = it.id ?? `${it.job_id}-${it.created_at}`;
      if (next[key]) delete next[key];
      else next[key] = it;
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const visible = processed.rows || [];
    const allSelected = visible.every(it => selectedMap[it.id ?? `${it.job_id}-${it.created_at}`]);
    if (allSelected) {
      const next = { ...selectedMap };
      visible.forEach(it => delete next[it.id ?? `${it.job_id}-${it.created_at}`]);
      setSelectedMap(next);
    } else {
      const next = { ...selectedMap };
      visible.forEach(it => next[it.id ?? `${it.job_id}-${it.created_at}`] = it);
      setSelectedMap(next);
    }
  };

  const totalPages = Math.max(1, Math.ceil((processed.total || 0) / pageSize));
  const gotoPage = (p) => {
    const np = Math.max(1, Math.min(p, totalPages));
    setPage(np);
    if (serverPaging) {
      (async () => {
        setPageLoading(true);
        await fetchOverview({ page: np, pageSize }).catch(() => {});
        setPageLoading(false);
      })();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  const openModal = (it) => { setSelected(it); setShowModal(true); };

  const rows = processed.rows || [];

  // top risk job for display
  const topRiskJobId = useMemo(() => {
    const top = (items || []).reduce((m, it) => (it.risk_score > (m?.risk_score || 0) ? it : m), null) || {};
    return top.job_id ?? "—";
  }, [items]);

  return (
    <div className={`${theme === "dark" ? "bg-slate-900" : "bg-slate-50"} p-4 max-w-7xl mx-auto`}>
      {/* Scoped theme CSS for tables / pre so child outputs keep good contrast */}
      <style>{`
        [data-theme="dark"] {
          --muted-2: #cbd5e1;
        }
        [data-theme] table {
          color: var(--text);
        }
        [data-theme] pre, [data-theme] code {
          color: var(--text);
          background: var(--panel-bg);
        }
      `}</style>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${titleClass}`}>SLA Risk & Mitigation</h1>
          <p className={`text-sm ${mutedClass} mt-1`}>View vulnerable jobs, apply mitigations (reassign / notify) and keep SLAs healthy.</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={runCheckNow} disabled={runLoading} className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60">
            {runLoading ? "Running…" : "Run check now"}
          </button>

          <button onClick={() => { setPolling(p => !p); setToast({ type: "info", text: polling ? "Polling paused" : "Polling resumed" }); }} className={`px-3 py-2 border rounded ${theme === "dark" ? "text-slate-100" : ""}`}>
            {polling ? "Pause polling" : "Resume polling"}
          </button>

          <button onClick={() => fetchOverview({ page, pageSize }).catch(()=>{})} className={`px-3 py-2 border rounded ${theme === "dark" ? "text-slate-100" : ""}`}>Refresh</button>

          <div className={`px-3 py-2 border rounded ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white"}`}>
            <button onClick={exportCsv} className="text-sm mr-2">Export CSV</button>
            <button onClick={exportJson} className="text-sm">Export JSON</button>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className={`${cardBg} p-4 rounded-lg shadow`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Vulnerable jobs</div>
          <div className="text-2xl font-semibold mt-1">{kpis.total}</div>
          <div className="text-xs mt-2" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>High: {kpis.high} · Medium: {kpis.medium} · Low: {kpis.low}</div>
        </div>

        <div className={`${cardBg} p-4 rounded-lg shadow`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Avg risk score</div>
          <div className="text-2xl font-semibold mt-1">{(kpis.avgRisk || 0).toFixed(2)}</div>
          <div className="text-xs mt-2" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Normalized 0–1</div>
        </div>

        <div className={`${cardBg} p-4 rounded-lg shadow`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Top-risk job</div>
          <div className="text-2xl font-semibold mt-1">{topRiskJobId}</div>
          <div className="text-xs mt-2" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>ID with highest score (current page/area)</div>
        </div>

        <div className={`${cardBg} p-4 rounded-lg shadow`}>
          <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Risk distribution</div>
          <div style={{ width: "100%", height: 64 }} className="mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskChartData} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                <XAxis dataKey="label" hide />
                <Tooltip wrapperStyle={{ color: theme === "dark" ? "#000" : undefined }} />
                <Bar dataKey="count" fill={theme === "dark" ? "#fb7185" : "#FB7185"} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Risk</label>
          <select value={filterRisk} onChange={(e) => setFilterRisk(e.target.value)} className={`px-2 py-1 border rounded text-sm ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
            <option value="all">All</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Search</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Job ID, reason, technician..." className={`px-3 py-1 border rounded text-sm w-72 ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Sort</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className={`px-2 py-1 border rounded text-sm ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
            <option value="risk">Risk</option>
            <option value="created">Created</option>
            <option value="job">Job</option>
          </select>

          <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} className={`px-2 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>
            {sortDir === "asc" ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Table + bulk actions */}
      <div className={`${cardBg} rounded-lg shadow overflow-hidden`}>
        <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: theme === "dark" ? "rgba(148,163,184,0.08)" : undefined }}>
          <div className="flex items-center gap-2">
            <input type="checkbox" onChange={toggleSelectAllVisible} aria-label="select all visible" />
            <span className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Select visible</span>
          </div>

          <div className="ml-4 flex items-center gap-2">
            <button disabled={actionLoading} onClick={bulkNotify} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Bulk notify</button>
            <button disabled={actionLoading} onClick={() => { setSelectedMap({}); setToast({ type: "info", text: "Selection cleared" }); }} className={`px-3 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>Clear selection</button>
          </div>

          <div className="ml-auto text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Showing {rows.length} of {processed.total} items</div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y" aria-describedby="sla-table">
            <thead className={`${tableHeadClass}`}>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium">Sel</th>
                <th className="px-4 py-3 text-left text-xs font-medium cursor-pointer" onClick={() => toggleSort("job")}>Job {sortBy === "job" && (sortDir === "asc" ? "▲" : "▼")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium cursor-pointer" onClick={() => toggleSort("risk")}>Risk {sortBy === "risk" && (sortDir === "asc" ? "▲" : "▼")}</th>
                <th className="px-4 py-3 text-left text-xs font-medium">Suggested</th>
                <th className="px-4 py-3 text-left text-xs font-medium cursor-pointer" onClick={() => toggleSort("created")}>Created {sortBy === "created" && (sortDir === "asc" ? "▲" : "▼")}</th>
                <th className="px-4 py-3 text-right text-xs font-medium">Manage</th>
              </tr>
            </thead>

            <tbody className={theme === "dark" ? "bg-slate-900 divide-y divide-slate-700" : "bg-white divide-y divide-gray-100"}>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Loading…</td></tr>
              )}

              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>No vulnerable jobs found.</td></tr>
              )}

              {!loading && rows.map(it => (
                <Row
                  key={it.id ?? `${it.job_id}-${it.created_at}`}
                  it={it}
                  checked={Boolean(selectedMap[it.id ?? `${it.job_id}-${it.created_at}`])}
                  onToggle={toggleRow}
                  onOpen={openModal}
                  theme={theme}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="px-4 py-3 border-t flex items-center justify-between gap-3" style={{ borderColor: theme === "dark" ? "rgba(148,163,184,0.08)" : undefined }}>
          <div className="flex items-center gap-2">
            <button onClick={() => gotoPage(1)} disabled={page === 1 || pageLoading} className={`px-3 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>First</button>
            <button onClick={() => gotoPage(page - 1)} disabled={page === 1 || pageLoading} className={`px-3 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>Prev</button>

            <div className="px-3 py-1 border rounded text-sm" style={{ background: theme === "dark" ? "transparent" : undefined }}>
              Page <strong className="mx-1">{page}</strong> of <strong>{totalPages}</strong>
            </div>

            <button onClick={() => gotoPage(page + 1)} disabled={page === totalPages || pageLoading} className={`px-3 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>Next</button>
            <button onClick={() => gotoPage(totalPages)} disabled={page === totalPages || pageLoading} className={`px-3 py-1 border rounded text-sm ${theme === "dark" ? "text-slate-100" : ""}`}>Last</button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Per page</label>
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className={`px-2 py-1 border rounded text-sm ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}>
              {[10,20,50,100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"} w-full max-w-3xl rounded-lg shadow-lg p-4`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Mitigate SLA — Job #{selected.job_id}</h3>
                <p className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>{selected.reason}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setShowModal(false); setSelected(null); }} className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Close</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Diagnostics</div>
                <div className={`${panelSurface} p-3 rounded mt-2 text-sm`}>
                  <div><strong>Predicted arrival:</strong> {formatIso(selected.meta?.diag?.predicted_arrival_iso)}</div>
                  <div><strong>Travel (min):</strong> {Number(selected.meta?.diag?.travel_minutes || 0).toFixed(1)}</div>
                  <div><strong>Queue (min):</strong> {Number(selected.meta?.diag?.queue_minutes || 0).toFixed(1)}</div>
                </div>

                <div className="mt-3">
                  <div className="flex gap-2">
                    <button disabled={actionLoading} onClick={handleNotify} className="px-3 py-1 border rounded text-sm">Notify customer</button>
                    <button disabled={actionLoading} onClick={() => postMitigate({ job_id: selected.job_id, action: "reassign" })} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm">Auto-reassign</button>
                    <button disabled={actionLoading} onClick={() => { navigator.clipboard?.writeText(JSON.stringify(selected.meta || {})); setToast({ type: "info", text: "Diagnostics copied" }); }} className="px-3 py-1 border rounded text-sm">Copy diag</button>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Candidates</div>
                <div className="mt-2 space-y-2">
                  {selected.meta?.candidates && selected.meta.candidates.length > 0 ? selected.meta.candidates.map(c => (
                    <div key={c.technician_id} className={`${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white"} flex items-center justify-between p-2 border rounded`}>
                      <div>
                        <div className="font-medium">{c.username} <span className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#9ca3af" }}>#{c.technician_id}</span></div>
                        <div className="text-xs" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>score: {Number(c.score || 0).toFixed(2)}</div>
                      </div>
                      <div>
                        <button disabled={actionLoading} onClick={() => handleAssignCandidate(c)} className="px-2 py-1 border rounded text-sm">Assign</button>
                      </div>
                    </div>
                  )) : <div className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>No candidates available</div>}
                </div>

                <div className="mt-3">
                  <div className="text-sm" style={{ color: theme === "dark" ? "var(--muted-2)" : "#6b7280" }}>Force reassign</div>
                  <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason for forced override (required)" className={`w-full mt-2 p-2 border rounded text-sm ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`} rows={3} />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => setOverrideReason("")} className="px-3 py-1 border rounded text-sm">Clear</button>
                    <button disabled={actionLoading} onClick={handleForceReassign} className="px-3 py-1 bg-red-600 text-white rounded text-sm">Force reassign</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setShowModal(false); setSelected(null); }} className="px-3 py-1 border rounded">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className={cls(
          "fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg",
          toast.type === "error" ? "bg-rose-50 text-rose-800" : toast.type === "success" ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-700"
        )} role="status">
          {toast.text}
        </div>
      )}

      {/* error */}
      {error && <div className="mt-4 text-sm text-rose-600">{error}</div>}
    </div>
  );
}
