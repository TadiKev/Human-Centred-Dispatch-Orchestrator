// frontend/src/pages/TechDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { apiFetch } from "../api/fetcher";
import { Link, useNavigate } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider";

/* Optional progressive imports (same as your original file) */
let pullAssignedJobs, pushOutbox, getAllJobs, putJob, queueEvent;
(async () => {
  try {
    const sync = await import("../tech/sync");
    pullAssignedJobs = sync.pullAssignedJobs;
    pushOutbox = sync.pushOutbox;
  } catch (e) {}
  try {
    const idb = await import("../tech/idb");
    getAllJobs = idb.getAllJobs;
    putJob = idb.putJob;
    queueEvent = idb.queueEvent;
  } catch (e) {}
})();

export default function TechDashboard() {
  const { auth } = useAuth();
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(false);

  // UI state
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(new Set()); // multi-select
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("updated_desc"); // updated_desc, updated_asc, sla_asc, sla_desc
  const [view, setView] = useState("grid"); // grid or list
  const [pageSize, setPageSize] = useState(9);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [selectAllOnPage, setSelectAllOnPage] = useState(false);

  const techId = "me";
  const navigate = useNavigate();

  const { theme } = useTheme();

  // persist theme to root so descendant components / CSS can rely on it
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  // Theme-aware utility classes (used to replace literal bg-white / text-slate-* etc)
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const panelBg = theme === "dark" ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200";
  const panelText = theme === "dark" ? "text-slate-100" : "text-slate-900";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const smallMuted = theme === "dark" ? "text-slate-400" : "text-slate-500";
  const hoverBg = theme === "dark" ? "hover:bg-slate-700/30" : "hover:bg-slate-50";
  const cardItemClass = theme === "dark" ? "bg-slate-800 border border-slate-700 text-slate-100" : "bg-white border border-gray-200 text-slate-900";
  const inputWrapper = theme === "dark" ? "bg-slate-800 border border-slate-700" : "bg-white border border-gray-200";
  const inputText = theme === "dark" ? "text-slate-100" : "text-slate-900";
  const btnPrimary = theme === "dark" ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-indigo-600 text-white hover:bg-indigo-700";
  const btnGhost = theme === "dark" ? "border border-slate-600 text-slate-100 hover:bg-slate-700/20" : "border border-gray-200 text-slate-700 hover:bg-slate-50";

  function normalizeJobsResponse(res) {
    if (!res) return [];
    if (Array.isArray(res)) return res;
    if (res.jobs && Array.isArray(res.jobs)) return res.jobs;
    if (res.results && Array.isArray(res.results)) return res.results;
    return [];
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (typeof getAllJobs === "function") {
        try {
          const cached = await getAllJobs();
          setJobs(cached || []);
        } catch (e) {
          console.warn("Failed to load cached jobs:", e);
        }
      } else {
        setJobs(null);
      }

      let pulled = null;
      if (typeof pullAssignedJobs === "function" && auth?.access) {
        try {
          const res = await pullAssignedJobs(techId, auth.access, null);
          pulled = normalizeJobsResponse(res);
        } catch (err) {
          console.log("pullAssignedJobs failed:", err);
        }
      }

      if ((!pulled || pulled.length === 0) && auth?.access) {
        try {
          const res = await apiFetch("/api/jobs/assigned/", { method: "GET", token: auth.access });
          pulled = normalizeJobsResponse(res);
        } catch (e) {
          console.log("Legacy assigned endpoint fetch failed:", e);
        }
      }

      if (pulled && Array.isArray(pulled)) {
        setJobs(pulled);
        if (typeof putJob === "function") {
          for (const j of pulled) {
            try { await putJob(j); } catch (err) { /* ignore */ }
          }
        }
      } else {
        if (jobs === null) setJobs([]);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.access]);

  async function startJob(job) {
    const updated = { ...job, status: "in_progress", updated_at: new Date().toISOString() };
    setJobs(prev => (Array.isArray(prev) ? prev.map(j => (j.id === job.id ? updated : j)) : [updated]));
    if (typeof putJob === "function") {
      try { await putJob(updated); } catch (e) { console.warn("putJob failed", e); }
    }
    if (typeof queueEvent === "function") {
      try { await queueEvent({ event: "start_job", payload: { job_id: job.id }, client_ts: new Date().toISOString() }); } catch (e) {}
    }
    if (typeof pushOutbox === "function" && auth?.access) {
      try { await pushOutbox(auth.access); } catch (e) { console.log("pushOutbox failed", e); }
    } else {
      try {
        if (auth?.access) {
          await apiFetch(`/api/jobs/${job.id}/`, { method: "PATCH", token: auth.access, body: { status: "in_progress" }});
        }
      } catch (e) {}
    }
  }

  async function completeJob(job) {
    const updated = { ...job, status: "done", updated_at: new Date().toISOString() };
    setJobs(prev => (Array.isArray(prev) ? prev.map(j => (j.id === job.id ? updated : j)) : [updated]));
    if (typeof putJob === "function") {
      try { await putJob(updated); } catch (e) { console.warn("putJob failed", e); }
    }
    if (typeof queueEvent === "function") {
      try { await queueEvent({ event: "complete_job", payload: { job_id: job.id }, client_ts: new Date().toISOString() }); } catch (e) {}
    }
    if (typeof pushOutbox === "function" && auth?.access) {
      try { await pushOutbox(auth.access); } catch (e) { console.log("pushOutbox failed", e); }
    } else {
      try {
        if (auth?.access) {
          await apiFetch(`/api/jobs/${job.id}/`, { method: "PATCH", token: auth.access, body: { status: "done" }});
        }
      } catch (e) {}
    }
  }

  async function manualSync() {
    setLoading(true);
    try {
      if (typeof pushOutbox === "function" && auth?.access) {
        await pushOutbox(auth?.access);
      }

      let pulled = null;
      if (typeof pullAssignedJobs === "function" && auth?.access) {
        try {
          const res = await pullAssignedJobs(techId, auth.access, null);
          pulled = normalizeJobsResponse(res);
        } catch (e) {
          console.log("pullAssignedJobs failed on manualSync:", e);
        }
      }

      if ((!pulled || pulled.length === 0) && auth?.access) {
        try {
          const res = await apiFetch("/api/jobs/assigned/", { method: "GET", token: auth.access });
          pulled = normalizeJobsResponse(res);
        } catch (e) {
          console.log("Legacy assigned endpoint failed on manualSync:", e);
        }
      }

      if (pulled && pulled.length >= 0) {
        setJobs(pulled);
        if (typeof putJob === "function") {
          for (const j of pulled) {
            try { await putJob(j); } catch (err) {}
          }
        }
      } else {
        if (typeof getAllJobs === "function") {
          try {
            const cached = await getAllJobs();
            setJobs(cached || []);
          } catch (err) {}
        }
      }
    } catch (err) {
      console.error("manualSync failed", err);
    } finally {
      setLoading(false);
    }
  }

  // status colors — adapt to theme so badges are legible in dark mode
  const statusColor = useMemo(() => {
    if (theme === "dark") {
      return {
        pending: "bg-amber-600/20 text-amber-300",
        assigned: "bg-indigo-600/20 text-indigo-300",
        in_progress: "bg-sky-600/20 text-sky-300",
        done: "bg-emerald-600/20 text-emerald-300",
        cancelled: "bg-rose-600/20 text-rose-300",
      };
    }
    return {
      pending: "bg-yellow-100 text-yellow-800",
      assigned: "bg-indigo-100 text-indigo-800",
      in_progress: "bg-blue-100 text-blue-800",
      done: "bg-green-100 text-green-800",
      cancelled: "bg-red-100 text-red-800",
    };
  }, [theme]);

  // Filtering & sorting
  const processed = useMemo(() => {
    if (!Array.isArray(jobs)) return [];

    const q = query.trim().toLowerCase();
    let list = jobs.slice();

    // text search
    if (q) {
      list = list.filter(j => {
        return (j.customer_name || j.title || "").toLowerCase().includes(q) ||
               (j.address || j.description || "").toLowerCase().includes(q) ||
               String(j.id).includes(q);
      });
    }

    // status filter (multi)
    if (statusFilter.size > 0) {
      list = list.filter(j => statusFilter.has(String(j.status)));
    }

    // date range filter based on updated_at (if provided)
    if (dateFrom) {
      const from = new Date(dateFrom);
      list = list.filter(j => j.updated_at ? new Date(j.updated_at) >= from : false);
    }
    if (dateTo) {
      // include the whole day
      const to = new Date(dateTo);
      to.setHours(23,59,59,999);
      list = list.filter(j => j.updated_at ? new Date(j.updated_at) <= to : false);
    }

    // sort
    list.sort((a, b) => {
      if (sortBy === "updated_desc") {
        return (new Date(b.updated_at || 0)) - (new Date(a.updated_at || 0));
      }
      if (sortBy === "updated_asc") {
        return (new Date(a.updated_at || 0)) - (new Date(b.updated_at || 0));
      }
      if (sortBy === "sla_asc") {
        const sa = a.sla ?? "";
        const sb = b.sla ?? "";
        return (sa > sb) ? 1 : (sa < sb) ? -1 : 0;
      }
      if (sortBy === "sla_desc") {
        const sa = a.sla ?? "";
        const sb = b.sla ?? "";
        return (sa < sb) ? 1 : (sa > sb) ? -1 : 0;
      }
      return 0;
    });

    return list;
  }, [jobs, query, statusFilter, dateFrom, dateTo, sortBy]);

  // pagination
  const pageCount = Math.max(1, Math.ceil(processed.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return processed.slice(start, start + pageSize);
  }, [processed, page, pageSize]);

  // selection helpers
  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    if (selectAllOnPage) {
      // unselect page items
      setSelected(prev => {
        const next = new Set(prev);
        pageItems.forEach(i => next.delete(i.id));
        return next;
      });
      setSelectAllOnPage(false);
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        pageItems.forEach(i => next.add(i.id));
        return next;
      });
      setSelectAllOnPage(true);
    }
  }

  useEffect(() => {
    // keep selectAllOnPage consistent when page items change
    const allSelected = pageItems.length > 0 && pageItems.every(i => selected.has(i.id));
    setSelectAllOnPage(allSelected);
  }, [pageItems, selected]);

  // bulk actions
  async function bulkStart() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      const job = (jobs || []).find(j => j.id === id);
      if (job && job.status !== "in_progress" && job.status !== "done") {
        await startJob(job);
      }
    }
    setSelected(new Set());
  }

  async function bulkComplete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    for (const id of ids) {
      const job = (jobs || []).find(j => j.id === id);
      if (job && job.status !== "done") {
        await completeJob(job);
      }
    }
    setSelected(new Set());
  }

  // CSV export (client-side)
  function exportCSV(list = processed) {
    if (!Array.isArray(list)) return;
    const columns = ["id","customer_name","address","status","updated_at","sla","customer_contact","description"];
    const rows = list.map(j => columns.map(c => {
      const v = j[c];
      if (v === undefined || v === null) return "";
      // escape quotes
      return (`"${String(v).replace(/"/g, '""')}"`);
    }).join(","));
    const csv = [columns.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobs_export_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // small helper to toggle status filter values
  function toggleStatusFilter(value) {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  }

  if (!auth?.access) {
    return (
      <div className={`${pageBg} p-6`}>
        <h2 className="text-2xl font-semibold">Technician Dashboard</h2>
        <p className={`mt-3 ${muted}`}>You must <Link to="/auth" className="text-indigo-600">sign in</Link> to see assigned jobs.</p>
      </div>
    );
  }

  return (
    <div className={`${pageBg} p-6`}>
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Technician Dashboard</h1>
          <p className={`text-sm mt-1 ${muted}`}>Welcome back, <strong className={panelText}>{auth?.user?.username}</strong> — <span className="italic">{auth?.user?.profile?.role ?? auth?.user?.role}</span></p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center ${inputWrapper} rounded-lg shadow-sm p-2`}>
            <input
              aria-label="Search jobs"
              className={`w-56 px-2 py-1 outline-none text-sm ${inputText} bg-transparent`}
              placeholder="Search by name, address or ID"
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1); }}
            />
            <button onClick={() => { setQuery(""); setPage(1); }} className={`ml-2 px-2 py-1 rounded ${btnGhost}`} title="Clear search">Clear</button>
          </div>

          <div className="flex items-center gap-2">
            <button className={`px-3 py-1 rounded ${btnGhost}`} onClick={manualSync} disabled={loading}>
              {loading ? "Syncing…" : "Sync"}
            </button>
            <button className={`px-3 py-1 rounded ${btnPrimary}`} onClick={() => navigate("/me/itinerary")}>My itinerary</button>
          </div>
        </div>
      </div>

      {/* Filters / controls */}
      <div className={`${panelBg} rounded-xl p-4 mb-6 shadow-sm`}>
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Status filters */}
            <div className="flex items-center gap-2">
              <label className={`text-sm font-medium ${muted} mr-2`}>Status</label>
              {["pending","assigned","in_progress","done","cancelled"].map(s => (
                <button
                  key={s}
                  onClick={() => { toggleStatusFilter(s); setPage(1); }}
                  className={`px-3 py-1 rounded-full text-sm border ${statusFilter.has(s) ? "bg-slate-800 text-white" : `${theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white text-slate-700"}`}`}
                >
                  {s}
                </button>
              ))}
              {statusFilter.size > 0 && <button className="ml-2 text-sm text-indigo-600" onClick={() => setStatusFilter(new Set())}>Clear</button>}
            </div>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <label className={`text-sm ${muted}`}>Updated</label>
              <input className={`text-sm rounded px-2 py-1 ${inputWrapper} ${inputText}`} style={{ borderRadius: 6 }} type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
              <span className={`text-sm ${smallMuted}`}>—</span>
              <input className={`text-sm rounded px-2 py-1 ${inputWrapper} ${inputText}`} style={{ borderRadius: 6 }} type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className={`text-sm ${muted}`}>Sort</label>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className={`text-sm rounded px-2 py-1 ${inputWrapper} ${inputText}`}>
                <option value="updated_desc">Updated (new → old)</option>
                <option value="updated_asc">Updated (old → new)</option>
                <option value="sla_asc">SLA (A → Z)</option>
                <option value="sla_desc">SLA (Z → A)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className={`text-sm ${muted}`}>View</label>
              <button className={`px-3 py-1 rounded ${view === "grid" ? "bg-slate-800 text-white" : `${theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white"}`}`} onClick={() => setView("grid")}>Grid</button>
              <button className={`px-3 py-1 rounded ${view === "list" ? "bg-slate-800 text-white" : `${theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white"}`}`} onClick={() => setView("list")}>List</button>
            </div>

            <div className="flex items-center gap-2">
              <label className={`text-sm ${muted}`}>Page size</label>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className={`text-sm rounded px-2 py-1 ${inputWrapper} ${inputText}`}>
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
                <option value={20}>20</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => exportCSV(processed)} className={`px-3 py-1 rounded ${btnGhost} text-sm`}>Export CSV</button>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={selectAllOnPage} onChange={toggleSelectAllOnPage} />
            <span className={`text-sm ${muted}`}>Select page ({pageItems.length})</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={bulkStart}
              disabled={selected.size === 0}
              className={`px-3 py-1 rounded ${selected.size === 0 ? "opacity-50 cursor-not-allowed" : "bg-indigo-600 text-white"}`}
            >
              Bulk Start
            </button>
            <button
              onClick={bulkComplete}
              disabled={selected.size === 0}
              className={`px-3 py-1 rounded ${selected.size === 0 ? "opacity-50 cursor-not-allowed" : "border"}`}
            >
              Bulk Complete
            </button>
            <button onClick={() => { setSelected(new Set()); setSelectAllOnPage(false); }} className={`px-2 py-1 rounded border text-sm ${hoverBg}`}>Clear selection</button>
          </div>
        </div>

        <div className={`text-sm ${muted}`}>
          Showing <strong className={panelText}>{processed.length}</strong> jobs • Page {page}/{pageCount}
        </div>
      </div>

      {/* Job grid / list */}
      {jobs === null && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className={`${cardItemClass} p-4 rounded-2xl shadow-sm animate-pulse h-40`}></div>
          ))}
        </div>
      )}

      {Array.isArray(jobs) && jobs.length === 0 && (
        <div className={muted}>No assigned jobs</div>
      )}

      {Array.isArray(jobs) && jobs.length > 0 && (
        <>
          {view === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pageItems.map(j => (
                <article
                  key={j.id}
                  className={`${cardItemClass} rounded-2xl shadow-md p-5 transition-shadow duration-200 ${selected.has(j.id) ? "ring-2 ring-indigo-200" : ""} ${hoverBg}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center" style={{ background: theme === "dark" ? "linear-gradient(90deg,#0f172a,#0b1220)" : "linear-gradient(90deg,#eef2ff,#e0e7ff)" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <path d="M12 2v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M5 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold truncate">{j.customer_name || j.title || `Job ${j.id}`}</div>
                          <div className={`text-sm mt-1 ${smallMuted} truncate`}>{j.address || j.description || "No address provided"}</div>
                        </div>

                        <div className="text-right">
                          <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${statusColor[j.status] || (theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800")}`}>
                            <svg className="w-3 h-3 mr-2" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="4" cy="4" r="3" fill="currentColor" />
                            </svg>
                            {j.status}
                          </div>

                          <div className={`text-xs mt-1 ${smallMuted}`}>Updated: {j.updated_at ? new Date(j.updated_at).toLocaleString() : "—"}</div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className={`flex items-center justify-between text-xs ${smallMuted}`}>
                          <div>{j.sla ? `SLA: ${j.sla}` : "—"}</div>
                          <div>ID: <span className={`font-medium ${panelText}`}>{j.id}</span></div>
                        </div>

                        <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: theme === "dark" ? "rgba(148,163,184,0.08)" : undefined }}>
                          <div
                            className={`h-2 rounded-full transition-all duration-300`}
                            style={{
                              width: j.status === 'done' ? '100%' : j.status === 'in_progress' ? '50%' : '20%',
                              background: j.status === 'done' ? 'linear-gradient(90deg,#16a34a,#86efac)' : j.status === 'in_progress' ? 'linear-gradient(90deg,#0ea5e9,#60a5fa)' : 'linear-gradient(90deg,#f59e0b,#fbd38d)'
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleSelect(j.id)} />

                      {j.status !== "in_progress" && j.status !== "done" && (
                        <button onClick={() => startJob(j)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 3v18l15-9L5 3z" fill="currentColor"/></svg>
                          Start
                        </button>
                      )}

                      {j.status !== "done" && (
                        <button onClick={() => completeJob(j)} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${hoverBg}`}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          Complete
                        </button>
                      )}

                      <Link to={`/jobs/${j.id}`} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"} ${hoverBg}`}>
                        Details
                      </Link>
                    </div>

                    <div className={`text-xs ${smallMuted}`}>Customer: <span className={`font-medium ${panelText}`}>{j.customer_contact || '—'}</span></div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {pageItems.map(j => (
                <div key={j.id} className={`${cardItemClass} rounded-lg p-3 shadow-sm flex justify-between items-center ${selected.has(j.id) ? "ring-2 ring-indigo-200" : ""} ${hoverBg}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggleSelect(j.id)} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{j.customer_name || j.title || `Job ${j.id}`}</div>
                      <div className={`text-xs truncate ${smallMuted}`}>{j.address || j.description || "No address provided"}</div>
                    </div>
                    <div className={`ml-4 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusColor[j.status] || (theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800")}`}>
                      {j.status}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className={`text-xs ${smallMuted} mr-4`}>Updated: {j.updated_at ? new Date(j.updated_at).toLocaleString() : "—"}</div>
                    <Link to={`/jobs/${j.id}`} className={`text-sm ${theme === "dark" ? "text-slate-200" : "text-slate-700"} ${hoverBg}`}>Details</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Pagination */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button className={`px-3 py-1 rounded ${btnGhost}`} onClick={() => setPage(1)} disabled={page === 1}>First</button>
          <button className={`px-3 py-1 rounded ${btnGhost}`} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
          <div className={`px-3 py-1 rounded text-sm ${muted}`}>Page {page} of {pageCount}</div>
          <button className={`px-3 py-1 rounded ${btnGhost}`} onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page === pageCount}>Next</button>
          <button className={`px-3 py-1 rounded ${btnGhost}`} onClick={() => setPage(pageCount)} disabled={page === pageCount}>Last</button>
        </div>

        <div className={`text-sm ${muted}`}>Export: <button className="ml-2 text-sm text-indigo-600" onClick={() => exportCSV(processed)}>All filtered</button></div>
      </div>
    </div>
  );
}
