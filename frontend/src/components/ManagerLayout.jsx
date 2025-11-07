// frontend/src/components/ManagerLayout.jsx
import React, { useState, useEffect } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider"; // <-- global theme hook

export default function ManagerLayout() {
  const { auth, logout } = useAuth();
  const user = auth?.user;
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();

  // theme wiring (minimal — keeps layout behavior unchanged)
  const { theme } = useTheme();
  const pageBg = theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-green-50 text-slate-900";
  const asideBg = theme === "dark" ? "bg-slate-800 border-slate-700" : "bg-white border-green-100";
  const contentBg = theme === "dark" ? "bg-slate-800" : "bg-white";
  const headingColor = theme === "dark" ? "text-slate-100" : "text-slate-800";
  const metaColor = theme === "dark" ? "text-slate-300" : "text-slate-600";

  function doLogout() {
    logout();
    navigate("/auth");
  }

  // keep a data-theme attribute on this wrapper so any descendant (tables, charts) can be targeted
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {
      // ignore in SSR
    }
  }, [theme]);

  return (
    <div data-theme={theme} className={`${pageBg} min-h-screen flex`}>

      {/* scoped theming for elements (tables, pre, links) to ensure good contrast in dark mode */}
      <style>{`
        /* theme-aware CSS variables */
        [data-theme="dark"] {
          --page-bg: #0f172a;
          --panel-bg: #0b1220;
          --surface: #0f172a;
          --text: #e6eef7; /* bright text for dark mode */
          --muted: #94a3b8;
          --muted-2: #cbd5e1;
          --accent: #16a34a;
          --table-head: #0b1220;
          --table-row: #0b1220;
          --table-border: #334155;
        }

        [data-theme="light"] {
          --page-bg: #f0fdf4;
          --panel-bg: #ffffff;
          --surface: #ffffff;
          --text: #0f172a;
          --muted: #475569;
          --muted-2: #64748b;
          --accent: #16a34a;
          --table-head: #f8faf5;
          --table-row: #ffffff;
          --table-border: #e6f4ea;
        }

        /* apply variable-driven colors to text and backgrounds inside the manager layout */
        [data-theme] .manager-content,
        [data-theme] .manager-aside,
        [data-theme] .manager-main {
          color: var(--text);
        }

        /* table theming — covers tables rendered in <Outlet /> too */
        [data-theme] table {
          background: var(--table-row);
          color: var(--text);
          border-collapse: collapse;
          width: 100%;
        }
        [data-theme] table thead th {
          background: var(--table-head);
          color: var(--text);
          font-weight: 600;
          padding: 0.75rem 0.9rem;
          border-bottom: 1px solid var(--table-border);
        }
        [data-theme] table tbody td {
          padding: 0.75rem 0.9rem;
          border-bottom: 1px solid var(--table-border);
        }
        [data-theme] table tbody tr:nth-child(odd) {
          background: rgba(255,255,255,0.01);
        }
        [data-theme="light"] table tbody tr:nth-child(odd) {
          background: rgba(0,0,0,0.02);
        }
        [data-theme] table tbody tr:hover {
          background: rgba(255,255,255,0.02);
        }

        /* pre / code styling inside layout */
        [data-theme] pre, [data-theme] code {
          background: var(--panel-bg);
          color: var(--text);
        }

        /* ensure links are visible */
        [data-theme] a { color: var(--accent); }
      `}</style>

      <aside className={`transition-all duration-200 manager-aside ${asideBg} border-r ${collapsed ? "w-20" : "w-64"}`}>
        <div className="h-16 flex items-center px-4 border-b">
          <div className="flex-1">
            <Link to="/manager" className="text-lg font-bold" style={{ color: "var(--accent)" }}>
              {!collapsed ? "Manager" : "M"}
            </Link>
          </div>
          {/* collapse button: theme-aware hover so dark mode doesn't show white hover */}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`p-1 rounded ${theme === "dark" ? "hover:bg-slate-700/50" : "hover:bg-green-50"}`}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <span className={theme === "dark" ? "text-slate-100" : "text-slate-700"}>{collapsed ? "→" : "←"}</span>
          </button>
        </div>

        <nav className="p-3 space-y-1">
          {/* manager-scoped routes (pass theme so SidebarLink can use theme-aware hover styles) */}
          <SidebarLink to="/manager/jobs" label="Jobs" collapsed={collapsed} theme={theme} />
          <SidebarLink to="/manager/technicians" label="Technicians" collapsed={collapsed} theme={theme} />
          <SidebarLink to="/manager/skills" label="Skills" collapsed={collapsed} theme={theme} />
          <SidebarLink to="/manager/sla" label="SLA" collapsed={collapsed} theme={theme} />
          <SidebarLink to="/manager/analytics" label="Analytics" collapsed={collapsed} theme={theme} />
        </nav>

        <div className="mt-auto p-3 border-t">
          <div className={`text-sm ${metaColor} ${collapsed ? "text-center" : ""}`}>Signed in as</div>
          <div className={`text-sm font-medium ${collapsed ? "text-center" : ""}`}>{!collapsed ? (user?.username || user?.email) : (user?.username?.[0] || "U")}</div>
          <div className="mt-3">
            <button onClick={doLogout} className="w-full px-3 py-1 rounded bg-green-600 text-white">Logout</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 p-6 manager-main">
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h1 className={`text-2xl font-semibold ${headingColor}`}>Manager console</h1>
            <div className={`text-sm ${metaColor}`}>Welcome, {user?.username || user?.email}</div>
          </div>
        </div>

        <div className={`${contentBg} manager-content rounded-lg shadow-sm p-4`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

/** SidebarLink — receives theme to apply theme-aware hover / icon styles */
function SidebarLink({ to, label, collapsed, theme }) {
  // hover background: dark -> subtle slate, light -> pale green
  const hoverBg = theme === "dark" ? "hover:bg-slate-700/60 hover:text-slate-100" : "hover:bg-green-50 hover:text-slate-900";
  // icon background: dark -> slate-700, light -> green-100
  const iconClasses = collapsed
    ? `w-8 h-8 rounded-full flex items-center justify-center font-semibold ${theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-green-100 text-green-700"}`
    : `w-8 h-8 rounded-full flex items-center justify-center font-semibold ${theme === "dark" ? "bg-slate-700 text-slate-100" : "bg-green-100 text-green-700"}`;

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 p-2 rounded ${hoverBg} ${collapsed ? "justify-center" : ""}`}
      style={{ color: "var(--text)" }}
    >
      <div className={iconClasses}>{label[0]}</div>
      {!collapsed && <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>}
    </Link>
  );
}
