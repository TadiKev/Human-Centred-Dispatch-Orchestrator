// frontend/src/pages/Jobs.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";

/** Small presentational badge (theme-aware) */
function Badge({ children, className = "", theme }) {
  const base = "inline-block text-xs px-2 py-0.5 rounded-full border";
  const themeCls =
    theme === "dark"
      ? "bg-slate-700 text-slate-100 border-slate-600"
      : "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`${base} ${themeCls} ${className}`}>{children}</span>;
}

function JobRow({ job, theme }) {
  const hoverRow = theme === "dark" ? "hover:bg-slate-700/40" : "hover:bg-slate-50";
  const rowBg = theme === "dark" ? "bg-transparent" : "";
  const textColor = theme === "dark" ? "text-slate-100" : "text-slate-900";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-500";

  return (
    <tr className={`${hoverRow} ${rowBg} ${textColor}`}>
      <td className="px-4 py-2 border">{job.id}</td>
      <td className="px-4 py-2 border">{job.customer_name}</td>
      <td className={`px-4 py-2 border ${muted}`}>{job.address || "—"}</td>
      <td className={`px-4 py-2 border capitalize ${textColor}`}>{job.status}</td>
      <td className="px-4 py-2 border">{job.estimated_duration_minutes ?? "—"}</td>
      <td className="px-4 py-2 border">
        {(job.required_skills || []).length === 0 ? (
          <span className={`text-sm ${muted}`}>—</span>
        ) : (
          (job.required_skills || []).map((s) => (
            <Badge key={s.id} className="mr-2" theme={theme}>
              {s.name}
            </Badge>
          ))
        )}
      </td>
    </tr>
  );
}

export default function JobsPage() {
  const { auth } = useAuth();
  const token = auth?.access ?? null;
  const { theme } = useTheme();

  // set data-theme so shared layout CSS variables apply for pages opened directly
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  // Raw data & states
  const [items, setItems] = useState([]); // server page or full list
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // pagination / search / sort
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [serverPaging, setServerPaging] = useState(false);

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("id"); // id | customer | status
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  // create modal
  const [showCreate, setShowCreate] = useState(false);
  const [skills, setSkills] = useState([]);

  // helper to normalize response shapes
  const normalizeResponse = useCallback((json) => {
    // Accepts:
    // - array: [...]
    // - DRF-style: { results: [...], count: N, next, previous }
    // - object with items: { items: [...] }
    if (!json) return { items: [], count: 0, serverPaging: false };
    if (Array.isArray(json)) {
      return { items: json, count: json.length, serverPaging: false };
    }
    if (Array.isArray(json.results)) {
      return { items: json.results, count: json.count ?? json.results.length, serverPaging: true };
    }
    if (Array.isArray(json.items)) {
      return { items: json.items, count: json.items.length, serverPaging: false };
    }
    // fallback
    return { items: json.items || [], count: json.count || 0, serverPaging: Boolean(json.next || json.previous) };
  }, []);

  // fetch function: will attempt server side pagination when page/pageSize provided
  async function fetchData({ page: p = 1, page_size: ps = pageSize, search = q } = {}) {
    if (!token) return;
    setLoading(true);
    setError(null);

    try {
      const base = "/api/jobs/";
      // attempt server-side pagination: set page & page_size and optional search param
      const url = new URL(base, window.location.origin);
      // only attach search param if present
      if (search && search.trim()) url.searchParams.set("q", search.trim());
      url.searchParams.set("page", String(p));
      url.searchParams.set("page_size", String(ps));

      const res = await apiFetch(url.pathname + url.search, { token });
      const { items: newItems, count, serverPaging: isServer } = normalizeResponse(res);
      setItems(newItems || []);
      setTotalCount(count ?? (newItems?.length ?? 0));
      setServerPaging(Boolean(isServer));
      setPage(p);
      // try to fetch skills (lightweight) if not loaded
      if (skills.length === 0) {
        const sres = await apiFetch("/api/skills/", { token }).catch(() => null);
        setSkills(Array.isArray(sres) ? sres : sres?.results ?? []);
      }
    } catch (err) {
      console.error("Load error:", err);
      // fallback: try a simple fetch without page params (client-side)
      try {
        const res2 = await apiFetch("/api/jobs/", { token });
        const { items: newItems, count } = normalizeResponse(res2);
        setItems(newItems || []);
        setTotalCount(count ?? (newItems?.length ?? 0));
        setServerPaging(false);
      } catch (err2) {
        console.error("Fallback load failed:", err2);
        setError(err2?.message ?? "Failed to load data");
      }
    } finally {
      setLoading(false);
    }
  }

  // load on mount and when token changes
  useEffect(() => {
    if (token) fetchData({ page: 1, page_size: pageSize, search: q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // processed rows (filter, search, sort, and client-side paging if necessary)
  const processed = useMemo(() => {
    let arr = Array.isArray(items) ? items.slice() : [];

    // client-side filtering/search (only if serverPaging is false)
    const searchLower = (q || "").trim().toLowerCase();
    if (!serverPaging) {
      if (filterStatus !== "all") {
        arr = arr.filter((it) => (it.status || "").toLowerCase() === filterStatus);
      }
      if (searchLower) {
        arr = arr.filter((it) =>
          String(it.id).includes(searchLower) ||
          (it.customer_name || "").toLowerCase().includes(searchLower) ||
          (it.address || "").toLowerCase().includes(searchLower)
        );
      }
    }

    // sorting (apply on both server and client pages for consistent UX)
    arr.sort((a, b) => {
      let v = 0;
      if (sortBy === "id") v = (a.id || 0) - (b.id || 0);
      if (sortBy === "customer") v = (a.customer_name || "").localeCompare(b.customer_name || "");
      if (sortBy === "status") v = ((a.status || "")).localeCompare((b.status || ""));
      return sortDir === "asc" ? v : -v;
    });

    // pagination
    if (serverPaging) {
      // items already correspond to current server page; totalCount shows full size
      return { rows: arr, total: totalCount };
    } else {
      const total = arr.length;
      const start = (page - 1) * pageSize;
      const rows = arr.slice(start, start + pageSize);
      return { rows, total };
    }
  }, [items, q, filterStatus, sortBy, sortDir, page, pageSize, serverPaging, totalCount]);

  // UI handlers
  const gotoPage = (p) => {
    const totalPages = Math.max(1, Math.ceil((processed.total || 0) / pageSize));
    const np = Math.max(1, Math.min(p, totalPages));
    setPage(np);
    if (serverPaging) {
      fetchData({ page: np, page_size: pageSize, search: q });
    }
  };

  const applySearch = () => {
    // reset to page 1 and try server-side first
    setPage(1);
    fetchData({ page: 1, page_size: pageSize, search: q });
  };

  const changePageSize = (size) => {
    setPageSize(size);
    setPage(1);
    if (serverPaging) fetchData({ page: 1, page_size: size, search: q });
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(col);
      setSortDir("asc");
    }
    // when serverPaging is active, try to fetch sorted page server-side if backend supports sort param
    if (serverPaging) {
      // attempt server request with sort params (best-effort; backend may ignore)
      const sortParam = (sortDir === "asc" ? "" : "-") + (col === "id" ? "id" : col === "customer" ? "customer_name" : "status");
      const url = new URL("/api/jobs/", window.location.origin);
      url.searchParams.set("page", String(1));
      url.searchParams.set("page_size", String(pageSize));
      url.searchParams.set("ordering", sortParam);
      if (q) url.searchParams.set("q", q);
      // use apiFetch directly and normalize like fetchData
      setLoading(true);
      apiFetch(url.pathname + url.search, { token })
        .then((res) => {
          const { items: newItems, count, serverPaging: isServer } = normalizeResponse(res);
          setItems(newItems || []);
          setTotalCount(count ?? (newItems?.length ?? 0));
          setServerPaging(Boolean(isServer));
          setPage(1);
        })
        .catch(() => {
          // ignore and leave client-side ordering intact
        })
        .finally(() => setLoading(false));
    }
  };

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const titleClass = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const muted = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const btnPrimary = "px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700";
  const btnBorder = theme === "dark" ? "px-3 py-1 rounded border border-slate-600 hover:bg-slate-700/40 text-slate-100" : "px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 text-slate-900";

  return (
    <div className={`${pageBg} p-6 min-h-[60vh]`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-2xl font-semibold ${titleClass}`}>Jobs</h2>

        <div className="flex items-center gap-2">
          <input
            placeholder="Search by id, customer or address"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`px-3 py-1 rounded border ${theme === "dark" ? "bg-slate-700 text-slate-100 border-slate-600" : "bg-white text-slate-900 border-gray-200"}`}
            onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
          />
          <button onClick={applySearch} className={btnBorder}>Search</button>
          <button onClick={() => { setQ(""); setFilterStatus("all"); setSortBy("id"); setSortDir("asc"); fetchData({ page: 1, page_size: pageSize, search: "" }); }} className={btnBorder}>Reset</button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label className={`text-sm ${muted}`}>Status</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={`px-2 py-1 rounded border ${theme === "dark" ? "bg-slate-700 text-slate-100 border-slate-600" : "bg-white text-slate-900 border-gray-200"}`}>
            <option value="all">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="assigned">Assigned</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className={`text-sm ${muted}`}>Sort</label>
          <button onClick={() => toggleSort("id")} className={btnBorder}>ID {sortBy === "id" && (sortDir === "asc" ? "▲" : "▼")}</button>
          <button onClick={() => toggleSort("customer")} className={btnBorder}>Customer {sortBy === "customer" && (sortDir === "asc" ? "▲" : "▼")}</button>
          <button onClick={() => toggleSort("status")} className={btnBorder}>Status {sortBy === "status" && (sortDir === "asc" ? "▲" : "▼")}</button>
        </div>
      </div>

      <div className={`${cardClass} shadow-sm rounded-lg overflow-auto`}>
        {loading ? (
          <div className={`p-6 text-center ${muted}`}>Loading…</div>
        ) : (
          <table className="min-w-full table-auto">
            <thead>
              <tr className={`${theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-slate-50 text-slate-600"} text-sm`}>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Address</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Duration (min)</th>
                <th className="px-4 py-3 text-left">Skills</th>
              </tr>
            </thead>

            <tbody>
              {processed.rows.length === 0 ? (
                <tr>
                  <td colSpan="6" className={`p-6 text-center ${muted}`}>No jobs found.</td>
                </tr>
              ) : (
                processed.rows.map((j) => <JobRow key={j.id} job={j} theme={theme} />)
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination & controls */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => gotoPage(1)} disabled={page === 1 || loading} className={btnBorder}>First</button>
          <button onClick={() => gotoPage(page - 1)} disabled={page === 1 || loading} className={btnBorder}>Prev</button>
          <div className={`px-3 py-1 border rounded ${theme === "dark" ? "border-slate-600" : "border-gray-200"}`}>
            Page <strong className="mx-1">{page}</strong> of <strong>{Math.max(1, Math.ceil((processed.total || 0) / pageSize))}</strong>
          </div>
          <button onClick={() => gotoPage(page + 1)} disabled={page >= Math.ceil((processed.total || 0) / pageSize) || loading} className={btnBorder}>Next</button>
          <button onClick={() => gotoPage(Math.ceil((processed.total || 0) / pageSize))} disabled={page >= Math.ceil((processed.total || 0) / pageSize) || loading} className={btnBorder}>Last</button>
        </div>

        <div className="flex items-center gap-2">
          <label className={`text-sm ${muted}`}>Per page</label>
          <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))} className={`px-2 py-1 rounded border ${theme === "dark" ? "bg-slate-700 text-slate-100 border-slate-600" : "bg-white text-slate-900 border-gray-200"}`}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Create modal & action */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className={btnPrimary}
        >
          Create job
        </button>
        <button
          onClick={() => fetchData({ page, page_size: pageSize, search: q })}
          className={`${btnBorder} ml-2`}
        >
          Refresh
        </button>
      </div>

      {showCreate && (
        <JobCreateModal
          skills={skills}
          onClose={() => {
            setShowCreate(false);
            // refresh after close to reflect created job
            // if serverPaging is active, fetch first page
            fetchData({ page: serverPaging ? 1 : page, page_size: pageSize, search: q });
          }}
          token={token}
          theme={theme}
        />
      )}
    </div>
  );
}

/* JobCreateModal — only theme wiring added, behavior unchanged */
function JobCreateModal({ skills = [], onClose, token, theme }) {
  const [customer_name, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [duration, setDuration] = useState("");
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function toggleSkill(id) {
    setSelectedSkills((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        customer_name,
        address,
        lat: lat ? parseFloat(lat) : null,
        lon: lon ? parseFloat(lon) : null,
        requested_window_start: start || null,
        requested_window_end: end || null,
        estimated_duration_minutes: duration ? parseInt(duration, 10) : null,
        required_skill_ids: selectedSkills,
      };

      await apiFetch("/api/jobs/", { method: "POST", body: payload, token });
      onClose();
    } catch (err) {
      console.error("Create job error:", err);
      let msg = err?.message ?? "Failed to create job";
      try {
        if (err?.payload) {
          msg = err.payload.detail ?? JSON.stringify(err.payload);
        }
      } catch {}
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  const panelClass = theme === "dark" ? "bg-slate-800 text-slate-100 border border-slate-700" : "bg-white text-slate-900 border border-gray-200";
  const inputCls = theme === "dark" ? "mt-1 w-full border rounded px-3 py-2 bg-slate-700 text-slate-100 border-slate-600" : "mt-1 w-full border rounded px-3 py-2 bg-white text-slate-900 border-gray-200";
  const badgeActive = theme === "dark" ? "bg-indigo-600 text-white border-indigo-600" : "bg-indigo-600 text-white border-indigo-600";
  const badgeInactive = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white text-slate-700";

  return (
    <div className="fixed inset-0 flex items-start justify-center p-6 z-50 bg-black/30">
      <div className={`${panelClass} shadow-lg rounded-lg w-full max-w-2xl p-6`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Create Job</h3>
          <button className={theme === "dark" ? "text-slate-200" : "text-slate-500"} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm block">Customer name</label>
            <input className={inputCls} value={customer_name} onChange={(e) => setCustomerName(e.target.value)} required />
          </div>

          <div>
            <label className="text-sm block">Address</label>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div>
            <label className="text-sm block">Latitude</label>
            <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>

          <div>
            <label className="text-sm block">Longitude</label>
            <input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>

          <div>
            <label className="text-sm block">Window start</label>
            <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>

          <div>
            <label className="text-sm block">Window end</label>
            <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>

          <div>
            <label className="text-sm block">Est. duration (minutes)</label>
            <input className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm block mb-2">Required skills</label>
            <div className="flex flex-wrap gap-2">
              {skills.length === 0 && (
                <div className="text-sm text-slate-500">No skills available — create some in Skills.</div>
              )}
              {skills.map((s) => {
                const active = selectedSkills.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSkill(s.id)}
                    className={`px-2 py-1 rounded-full border ${active ? badgeActive : badgeInactive}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="md:col-span-2 flex justify-end gap-2 mt-4">
            <button type="button" className="px-3 py-1 rounded border" onClick={onClose}>Cancel</button>
            <button type="submit" className="px-3 py-1 rounded bg-indigo-600 text-white" disabled={busy}>
              {busy ? "Creating…" : "Create job"}
            </button>
          </div>

          {err && <div className="text-sm text-rose-600 md:col-span-2">{err}</div>}
        </form>
      </div>
    </div>
  );
}
