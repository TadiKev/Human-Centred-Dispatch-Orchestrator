import React, { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useNavigate, useLocation } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider"; // use the global theme hook

export default function AuthPage() {
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme(); // <-- global theme

  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "TECHNICIAN" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // read query params (role, next, mode)
  useEffect(() => {
    const qp = new URLSearchParams(location.search);
    const role = qp.get("role");
    const mode = qp.get("mode");
    if (role) setForm((f) => ({ ...f, role: role.toUpperCase() }));
    if (mode === "register") setIsRegister(true);
  }, [location.search]);

  const onChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        const r = await fetch("/api/auth/register/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: form.username,
            email: form.email,
            password: form.password,
            role: form.role,
          }),
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(txt || "Registration failed");
        }
        // fall-through to login
      }

      const loginRes = await fetch("/api/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password }),
      });
      if (!loginRes.ok) {
        const txt = await loginRes.text();
        throw new Error(txt || "Login failed");
      }
      const data = await loginRes.json();
      setAuth({ access: data.access, refresh: data.refresh, user: data.user });

      // after successful login, navigate to `next` if provided, otherwise sensible default
      const qp = new URLSearchParams(location.search);
      const next = qp.get("next");
      if (next) {
        navigate(next);
      } else {
        // route by role if no next
        const role = (data.user?.profile?.role ?? data.user?.role ?? "").toString().trim().toLowerCase();
        if (role === "technician") navigate("/tech");
        else if (role === "dispatcher" || role === "admin") navigate("/manager");
        else if (role === "customer") navigate("/portal");
        else navigate("/jobs");
      }
    } catch (err) {
      let msg = err.message || "Auth failed";
      try {
        const maybeJson = JSON.parse(msg);
        if (maybeJson.detail) msg = maybeJson.detail;
      } catch (_) {}
      setError(msg);
      setLoading(false);
    }
  }

  // theme-aware class helpers (keeps Tailwind usage simple)
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-slate-50 text-slate-900";
  const cardBg = theme === "dark" ? "bg-slate-800" : "bg-white";
  const inputBg = theme === "dark" ? "bg-slate-700 text-slate-100 placeholder-slate-300" : "bg-white text-slate-900 placeholder-slate-400";
  const borderCls = theme === "dark" ? "border-slate-700" : "border-slate-200";
  const mutedText = theme === "dark" ? "text-slate-300" : "text-slate-500";

  return (
    <div className={`${pageBg} min-h-screen flex items-center justify-center p-6`}>
      <div className={`w-full max-w-md ${cardBg} shadow rounded-lg p-6 border ${borderCls}`}>
        <h2 className="text-2xl font-semibold mb-1">{isRegister ? "Create account" : "Sign in"}</h2>
        <p className={`text-sm ${mutedText} mb-4`}>{isRegister ? "Register an account" : "Sign in to your account"}</p>
        {error && <div className="mb-3 text-red-400 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className={`block text-sm font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>Username</label>
            <input
              name="username"
              required
              value={form.username}
              onChange={onChange}
              className={`mt-1 block w-full rounded-md shadow-sm p-2 border ${borderCls} ${inputBg}`}
            />
          </div>

          {isRegister && (
            <div>
              <label className={`block text-sm font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={onChange}
                className={`mt-1 block w-full rounded-md shadow-sm p-2 border ${borderCls} ${inputBg}`}
                required
              />
            </div>
          )}

          <div>
            <label className={`block text-sm font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>Password</label>
            <input
              name="password"
              type="password"
              required
              value={form.password}
              onChange={onChange}
              className={`mt-1 block w-full rounded-md shadow-sm p-2 border ${borderCls} ${inputBg}`}
            />
          </div>

          {isRegister && (
            <div>
              <label className={`block text-sm font-medium ${theme === "dark" ? "text-slate-200" : "text-slate-700"}`}>Role</label>
              <select
                name="role"
                value={form.role}
                onChange={onChange}
                className={`mt-1 block w-full rounded-md p-2 border ${borderCls} ${inputBg}`}
              >
                <option value="TECHNICIAN">Technician</option>
                <option value="CUSTOMER">Customer</option>
              </select>
              <p className={`text-xs ${mutedText} mt-1`}>Admin/Dispatcher accounts must be created in admin.</p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded"
            >
              {loading ? "Please wait..." : (isRegister ? "Create account" : "Sign in")}
            </button>

            <button
              type="button"
              onClick={() => setIsRegister(!isRegister)}
              className={`text-sm ${theme === "dark" ? "text-green-300" : "text-green-600"}`}
            >
              {isRegister ? "Have account? Sign in" : "Need an account? Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
