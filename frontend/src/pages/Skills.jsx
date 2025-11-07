// frontend/src/pages/Skills.jsx
import React, { useEffect, useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";

export default function SkillsPage() {
  const { auth } = useAuth(); // use the hook (keeps AuthProvider unchanged)
  const token = auth?.access ?? null;
  const { theme } = useTheme();

  // theme-aware classes
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = theme === "dark" ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900";
  const panelBorder = theme === "dark" ? "border-slate-700" : "border-gray-200";
  const mutedText = theme === "dark" ? "text-slate-300" : "text-slate-500";
  const titleText = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const inputBg = theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-white text-slate-900";
  const hoverItem = theme === "dark" ? "hover:bg-slate-700/50" : "hover:bg-slate-50";
  const btnPrimary = theme === "dark" ? "bg-indigo-600 text-white" : "bg-indigo-600 text-white";
  const btnBorder = theme === "dark" ? "border-slate-600" : "border-slate-200";
  const btnSubtle = theme === "dark" ? "border-slate-600 text-slate-100 hover:bg-slate-700/40" : "border-slate-200 hover:bg-slate-50";

  const [skills, setSkills] = useState([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // ensure data-theme is set so shared CSS variables apply
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      // ignore (SSR)
    }
  }, [theme]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/skills/", { token });
      setSkills(Array.isArray(data) ? data : data.results ?? []);
    } catch (err) {
      console.error("Failed to load skills:", err);
      setError(err?.message ?? "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function createSkill(e) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/skills/", {
        method: "POST",
        token,
        body: { name: name.trim(), code: code.trim() },
      });
      setName("");
      setCode("");
      await load();
    } catch (err) {
      console.error("Create skill error:", err);
      setError(err?.message ?? "Failed to create skill");
    } finally {
      setBusy(false);
    }
  }

  async function removeSkill(id) {
    if (!confirm("Delete skill?")) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/skills/${id}/`, { method: "DELETE", token });
      await load();
    } catch (err) {
      console.error("Delete skill error:", err);
      setError(err?.message ?? "Failed to delete skill");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${pageBg} min-h-[60vh] p-6`}>
      <div className="flex items-center justify-between mb-6">
        <h2 className={`text-2xl font-semibold ${titleText}`}>Skills</h2>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading || busy}
            className={`px-3 py-1 rounded border ${btnBorder} ${btnSubtle}`}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 text-sm text-rose-500">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Create form */}
        <div className={`${cardBg} shadow-sm rounded-lg p-4 border ${panelBorder}`}>
          <form onSubmit={createSkill} className="space-y-3">
            <div>
              <label className={`text-sm block ${mutedText}`}>Name</label>
              <input
                className={`mt-1 w-full border rounded px-3 py-2 ${inputBg} border ${panelBorder}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div>
              <label className={`text-sm block ${mutedText}`}>Code</label>
              <input
                className={`mt-1 w-full border rounded px-3 py-2 ${inputBg} border ${panelBorder}`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className={`px-3 py-1 rounded ${btnPrimary} disabled:opacity-60`}
                disabled={busy}
              >
                {busy ? "Saving…" : "Create"}
              </button>
            </div>
          </form>
        </div>

        {/* List */}
        <div className={`${cardBg} shadow-sm rounded-lg p-4 border ${panelBorder}`}>
          {loading ? (
            <div className={`p-6 text-center ${mutedText}`}>Loading…</div>
          ) : skills.length === 0 ? (
            <div className={`p-6 text-center ${mutedText}`}>No skills yet.</div>
          ) : (
            <ul className="space-y-2">
              {skills.map((s) => (
                <li
                  key={s.id}
                  className={`flex items-center justify-between border rounded p-3 transition ${hoverItem} border ${panelBorder}`}
                >
                  <div>
                    <div className={`font-medium ${titleText}`}>{s.name}</div>
                    <div className={`text-sm ${mutedText}`}>{s.code}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => removeSkill(s.id)}
                      className={`px-2 py-1 text-sm rounded border ${btnBorder} ${btnSubtle}`}
                      disabled={busy}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
