// frontend/src/components/AnalyticsDashboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  LineChart,
} from "recharts";
import { useTheme } from "../theme/ThemeProvider"; // use the global theme hook

/*
  Redesigned AnalyticsDashboard.jsx
  - Respects the global theme hook and keeps text readable in dark mode (white/light text).
  - Uses the theme variable to pick Tailwind classes so dark mode text stays white.
  - Keeps functionality (fetching, CSV export, charts) unchanged.
*/

function Spinner({ size = 28 }) {
  return (
    <svg
      className="animate-spin"
      style={{ width: size, height: size }}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

function numberOrNA(v, decimals = 0) {
  if (v === null || v === undefined) return "N/A";
  if (typeof v === "number") return decimals ? v.toFixed(decimals) : v;
  const n = Number(v);
  return Number.isFinite(n) ? (decimals ? n.toFixed(decimals) : n) : "N/A";
}

/* Small sparkline used inside KPI cards */
function MiniSpark({ data = [], dataKey = "value", theme }) {
  if (!data || data.length === 0) {
    return (
      <div className={`text-xs ${theme === "dark" ? "text-slate-300" : "text-slate-400"}`}>
        no history
      </div>
    );
  }
  // choose stroke that contrasts in both themes
  const stroke = theme === "dark" ? "#34d399" : "#16a34a";
  return (
    <div style={{ width: 120, height: 48 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey={dataKey} stroke={stroke} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function AnalyticsDashboard({ apiBase = "/api", getAuthToken }) {
  // theme hook
  const { theme } = useTheme();

  // theme-aware classes (use these everywhere so dark mode remains readable)
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const mutedClass = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const cardClass = theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900";
  const panelClass = theme === "dark" ? "bg-slate-700" : "bg-white";
  const subtleBtn = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-gray-100 text-slate-900";
  const smallBtn = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-gray-100 text-slate-900";
  const tableHead = theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-slate-50 text-slate-800";
  const tableBodyBg = theme === "dark" ? "bg-slate-900" : "bg-white";
  const tableCellText = theme === "dark" ? "text-slate-100" : "text-slate-700";
  const preClass = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white text-slate-800";
  const chipYes = theme === "dark" ? "text-green-300 font-semibold" : "text-green-700 font-semibold";
  const chipNo = theme === "dark" ? "text-red-300 font-semibold" : "text-red-600 font-semibold";

  const [kpis, setKpis] = useState(null);
  const [traces, setTraces] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const now = new Date();
  const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [rangeFrom, setRangeFrom] = useState(defaultFrom.toISOString());
  const [rangeTo, setRangeTo] = useState(now.toISOString());

  const token = (getAuthToken && getAuthToken()) || localStorage.getItem("access");

  const fetchOverview = useCallback(
    async (p = 1) => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(`${apiBase}/analytics/overview/`, window.location.origin);
        if (rangeFrom) url.searchParams.set("from", rangeFrom);
        if (rangeTo) url.searchParams.set("to", rangeTo);
        url.searchParams.set("page", p);
        url.searchParams.set("page_size", pageSize);

        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const resp = await fetch(url.toString(), { headers });
        if (!resp.ok) {
          const txt = await resp.text();
          throw new Error(`Server ${resp.status}: ${txt}`);
        }
        const data = await resp.json();
        setKpis(data.kpis || { total_jobs: 0, on_time_rate: null, avg_travel_km: null, sla_breaches: 0 });
        setTraces(data.traces || []);
        setPage(data.pagination?.page ?? p);
      } catch (err) {
        console.error("Analytics fetch error", err);
        setError(err.message || String(err));
        setKpis({ total_jobs: 0, on_time_rate: null, avg_travel_km: null, sla_breaches: 0 });
        setTraces([]);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, rangeFrom, rangeTo, pageSize, token]
  );

  useEffect(() => {
    fetchOverview(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOverview]);

  // convenience: create chart-friendly series from traces (group by day)
  const analyticsSeries = useMemo(() => {
    if (!traces || traces.length === 0) return [];
    const buckets = {};
    for (const t of traces) {
      const dt = t.assignment_time ? new Date(t.assignment_time) : new Date();
      const day = dt.toISOString().slice(0, 10);
      if (!buckets[day]) buckets[day] = { day, travel_sum: 0, travel_count: 0, on_time_sum: 0, jobs: 0 };
      if (typeof t.travel_km === "number") {
        buckets[day].travel_sum += t.travel_km;
        buckets[day].travel_count += 1;
      }
      buckets[day].on_time_sum += t.on_time ? 1 : 0;
      buckets[day].jobs += 1;
    }
    const arr = Object.values(buckets)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((b) => ({
        day: b.day,
        avg_travel_km: b.travel_count ? b.travel_sum / b.travel_count : 0,
        on_time_rate: b.jobs ? b.on_time_sum / b.jobs : 0,
        jobs: b.jobs,
      }));
    return arr;
  }, [traces]);

  function applyPreset(days) {
    if (!days) {
      setRangeFrom(new Date(0).toISOString()); // very early = all
    } else {
      setRangeFrom(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    }
    setRangeTo(new Date().toISOString());
    setTimeout(() => fetchOverview(1), 50);
  }

  function exportCsv() {
    if (!traces || traces.length === 0) {
      alert("No traces to export.");
      return;
    }
    const cols = ["job_id", "customer_name", "assigned_technician", "assignment_time", "travel_km", "on_time", "sla_flags_count"];
    const rows = traces.map((t) => [
      t.job_id,
      `"${String(t.customer_name || "").replace(/"/g, '""')}"`,
      `"${String(t.assigned_technician || "").replace(/"/g, '""')}"`,
      t.assignment_time || "",
      t.travel_km == null ? "" : Number(t.travel_km).toFixed(3),
      t.on_time === true ? "1" : t.on_time === false ? "0" : "",
      (t.sla_flags || []).length,
    ]);
    const csv = [cols.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_traces_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const [expanded, setExpanded] = useState(null);

  return (
    <div className={`${theme === "dark" ? "bg-slate-900" : "bg-slate-50"} p-6 min-h-[60vh]`}>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${titleClass}`}>Analytics dashboard</h1>
          <p className={`text-sm ${mutedClass} mt-1`}>
            KPIs and audit traces for supervisors — on-time, travel, SLA breaches and per-job trace logs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`${subtleBtn} flex items-center gap-2 px-3 py-2 rounded shadow-sm`}>
            <label className={`text-xs ${mutedClass}`}>From</label>
            <input
              type="datetime-local"
              value={rangeFrom?.slice(0, 16) || ""}
              onChange={(e) => setRangeFrom(new Date(e.target.value).toISOString())}
              className={`${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"} text-sm px-2 py-1 border rounded`}
            />
            <label className={`text-xs ${mutedClass}`}>To</label>
            <input
              type="datetime-local"
              value={rangeTo?.slice(0, 16) || ""}
              onChange={(e) => setRangeTo(new Date(e.target.value).toISOString())}
              className={`${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"} text-sm px-2 py-1 border rounded`}
            />
            <button
              onClick={() => fetchOverview(1)}
              className="ml-2 px-3 py-1 rounded text-sm"
              style={{ background: "#16a34a", color: "white" }}
            >
              Apply
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => applyPreset(7)} className={`px-3 py-1 rounded text-sm ${smallBtn}`}>7d</button>
            <button onClick={() => applyPreset(30)} className={`px-3 py-1 rounded text-sm ${smallBtn}`}>30d</button>
            <button onClick={() => applyPreset(90)} className={`px-3 py-1 rounded text-sm ${smallBtn}`}>90d</button>
            <button onClick={() => applyPreset(null)} className={`px-3 py-1 rounded text-sm ${smallBtn}`}>All</button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className={`${cardClass} p-4 rounded-xl shadow`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-xs ${mutedClass}`}>Total jobs</div>
              <div className="text-2xl font-semibold">{numberOrNA(kpis?.total_jobs)}</div>
            </div>
            <div className="text-green-500 text-xl font-bold">📁</div>
          </div>
          <div className="mt-3">
            <MiniSpark data={analyticsSeries.slice(-12).map((s) => ({ value: s.jobs }))} dataKey="value" theme={theme} />
          </div>
        </div>

        <div className={`${cardClass} p-4 rounded-xl shadow`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-xs ${mutedClass}`}>On-time rate</div>
              <div className="text-2xl font-semibold">
                {kpis?.on_time_rate != null ? (kpis.on_time_rate * 100).toFixed(1) + "%" : "N/A"}
              </div>
            </div>
            <div className="text-green-500 text-xl font-bold">⏱️</div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <MiniSpark data={analyticsSeries.slice(-12).map((s) => ({ value: s.on_time_rate }))} dataKey="value" theme={theme} />
            <div className={`text-xs ${mutedClass} text-right`}>
              {analyticsSeries.length ? `Last ${analyticsSeries.length} days` : "No history"}
            </div>
          </div>
        </div>

        <div className={`${cardClass} p-4 rounded-xl shadow`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-xs ${mutedClass}`}>Avg travel (km)</div>
              <div className="text-2xl font-semibold">
                {kpis?.avg_travel_km != null ? Number(kpis.avg_travel_km).toFixed(2) : "N/A"}
              </div>
            </div>
            <div className="text-green-500 text-xl font-bold">🧭</div>
          </div>
          <div className="mt-3">
            <MiniSpark data={analyticsSeries.slice(-12).map((s) => ({ value: s.avg_travel_km }))} dataKey="value" theme={theme} />
          </div>
        </div>

        <div className={`${cardClass} p-4 rounded-xl shadow`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-xs ${mutedClass}`}>SLA breaches</div>
              <div className="text-2xl font-semibold">{numberOrNA(kpis?.sla_breaches)}</div>
            </div>
            <div className="text-red-400 text-xl font-bold">⚠️</div>
          </div>
          <div className={`mt-3 text-xs ${mutedClass}`}>High & medium breach suggestions that need mitigation</div>
        </div>
      </div>

      {/* Charts */}
      <div className={`${cardClass} p-4 rounded-xl shadow mb-6`}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className={`font-medium text-lg ${titleClass}`}>Trends</h3>
            <div className={`text-sm ${mutedClass}`}>Avg travel (bars) and on-time rate (area)</div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className={`px-3 py-1 rounded text-sm ${smallBtn}`}>Export CSV</button>
            <button onClick={() => fetchOverview(1)} className="px-3 py-1 rounded text-sm" style={{ background: "#16a34a", color: "white" }}>
              Refresh
            </button>
          </div>
        </div>

        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analyticsSeries}>
              <defs>
                <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme === "dark" ? "#334155" : "#e6edf3"} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={theme === "dark" ? "#94a3b8" : "#475569"} />
              <YAxis yAxisId="left" orientation="left" tickFormatter={(v) => v} stroke={theme === "dark" ? "#94a3b8" : "#475569"} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => (v * 100).toFixed(0) + "%"} stroke={theme === "dark" ? "#94a3b8" : "#475569"} />
              <Tooltip
                wrapperStyle={{ color: theme === "dark" ? "#111827" : undefined }}
                contentStyle={{ background: theme === "dark" ? "#0b1220" : "#fff", color: theme === "dark" ? "#fff" : "#111827" }}
                formatter={(val, name) => {
                  if (name === "on_time_rate") return [(val * 100).toFixed(1) + "%", "On-time rate"];
                  if (name === "avg_travel_km") return [Number(val).toFixed(2) + " km", "Avg travel"];
                  return [val, name];
                }}
              />
              <Bar yAxisId="left" dataKey="avg_travel_km" name="Avg travel (km)" barSize={18} fill={theme === "dark" ? "#60a5fa" : "#60a5fa"} />
              <Area yAxisId="right" type="monotone" dataKey="on_time_rate" name="On-time rate" stroke="#10b981" fill="url(#og)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Traces table */}
      <div className={`${cardClass} p-4 rounded-xl shadow`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`font-medium ${titleClass}`}>Recent job traces</h3>
          <div className={`text-sm ${mutedClass}`}>Showing page {page} • {traces.length ?? 0} rows</div>
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`${theme === "dark" ? "bg-slate-900/80" : "bg-white/80"} p-6 rounded shadow flex items-center gap-3`}>
              <div style={{ color: theme === "dark" ? "#fff" : "#111827" }}>
                <Spinner />
              </div>
              <div className={theme === "dark" ? "text-slate-100" : "text-slate-700"}>Loading analytics…</div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className={`min-w-full text-sm ${theme === "dark" ? "divide-y divide-slate-700" : "divide-y divide-gray-200"}`}>
            <thead className={`${tableHead}`}>
              <tr>
                <th className="px-4 py-3 text-left">Job</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Tech</th>
                <th className="px-4 py-3 text-left">Assigned at</th>
                <th className="px-4 py-3 text-right">Travel (km)</th>
                <th className="px-4 py-3 text-left">On-time</th>
                <th className="px-4 py-3 text-left">SLA flags</th>
                <th className="px-4 py-3 text-center">Details</th>
              </tr>
            </thead>
            <tbody className={`${tableBodyBg}`}>
              {(!traces || traces.length === 0) ? (
                <tr>
                  <td colSpan="8" className={`px-4 py-6 text-center ${mutedClass}`}>No traces in the selected range.</td>
                </tr>
              ) : traces.map((t) => {
                const isOpen = expanded === t.job_id;
                return (
                  <React.Fragment key={t.job_id}>
                    <tr className={`${theme === "dark" ? "hover:bg-slate-800" : "hover:bg-gray-50"}`}>
                      <td className={`px-4 py-3 font-medium ${tableCellText}`}>{t.job_id}</td>
                      <td className={`px-4 py-3 ${tableCellText}`}>{t.customer_name}</td>
                      <td className={`px-4 py-3 ${tableCellText}`}>{t.assigned_technician}</td>
                      <td className={`px-4 py-3 ${tableCellText}`}>{t.assignment_time ? new Date(t.assignment_time).toLocaleString() : "-"}</td>
                      <td className={`px-4 py-3 text-right ${tableCellText}`}>{t.travel_km == null ? "N/A" : Number(t.travel_km).toFixed(2)}</td>
                      <td className={`px-4 py-3 ${tableCellText}`}>
                        {t.on_time == null ? (
                          <span className={mutedClass}>N/A</span>
                        ) : (t.on_time ? (
                          <span className={chipYes}>Yes</span>
                        ) : (
                          <span className={chipNo}>No</span>
                        ))}
                      </td>
                      <td className={`px-4 py-3 ${tableCellText}`}>{(t.sla_flags || []).length}</td>
                      <td className={`px-4 py-3 text-center ${tableCellText}`}>
                        <button
                          onClick={() => setExpanded(isOpen ? null : t.job_id)}
                          className={`text-sm px-2 py-1 rounded ${smallBtn}`}
                        >
                          {isOpen ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>

                    {/* expanded details */}
                    {isOpen && (
                      <tr className={`${theme === "dark" ? "bg-slate-800" : "bg-slate-50"}`}>
                        <td colSpan="8" className="px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <div className={`text-xs ${mutedClass}`}>SLA flags</div>
                              {t.sla_flags && t.sla_flags.length ? (
                                <ul className="space-y-2 mt-2">
                                  {t.sla_flags.map((s, i) => (
                                    <li key={i} className={`${cardClass} text-sm p-2 rounded shadow-sm`}>
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <div className={`text-sm font-medium ${tableCellText}`}>{s.recommended_action || s.risk_level}</div>
                                          <div className={`text-xs ${mutedClass}`}>{s.created_at}</div>
                                        </div>
                                        <div className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-800">{s.risk_level}</div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : <div className={`text-sm ${mutedClass} mt-2`}>No SLA flags</div>}
                            </div>

                            <div>
                              <div className={`text-xs ${mutedClass}`}>Job meta</div>
                              <pre className={`${preClass} mt-2 text-xs p-2 rounded overflow-auto max-h-40`}>{JSON.stringify(t.meta || {}, null, 2)}</pre>
                            </div>

                            <div>
                              <div className={`text-xs ${mutedClass}`}>Raw trace</div>
                              <pre className={`${preClass} mt-2 text-xs p-2 rounded overflow-auto max-h-40`}>{JSON.stringify(t, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { if (page > 1) { fetchOverview(page - 1); setPage((p) => p - 1); } }}
              className={`px-3 py-1 rounded ${smallBtn}`}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <button
              onClick={() => { fetchOverview(page + 1); setPage((p) => p + 1); }}
              className={`px-3 py-1 rounded ${smallBtn}`}
              disabled={loading}
            >
              Next
            </button>
            <div className={`text-sm ${mutedClass}`}>Page {page}</div>
          </div>

          <div className="flex items-center gap-2">
            <label className={`text-sm ${mutedClass}`}>Page size</label>
            <select
              className={`text-sm border rounded px-2 py-1 ${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"}`}
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); fetchOverview(1); }}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>

        {error && <div className="mt-4 text-sm text-red-600">Error: {error}</div>}
      </div>
    </div>
  );
}
