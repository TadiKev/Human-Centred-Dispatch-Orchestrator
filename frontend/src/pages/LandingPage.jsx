import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useTheme } from "../theme/ThemeProvider";
import ThemeToggleBtn from "../components/ThemeToggleBtn";

/**
 * LandingPage.jsx — modern, professional, responsive
 * - Mobile-first, accessible, and fully responsive
 * - Horizontal role scroller on small screens (tap-friendly)
 * - Grid layout on md+ screens
 * - Full-width CTAs on mobile; compact on desktop
 * - Uses Tailwind CSS utility classes
 */

export default function LandingPage() {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const user = auth?.user ?? null;
  const { theme } = useTheme();

  function handleCard(nextPath, role) {
    const myRole = (user?.profile?.role ?? user?.role ?? "").toString().trim().toUpperCase();
    if (user && myRole === role) {
      navigate(nextPath);
      return;
    }
    navigate(`/auth?role=${encodeURIComponent(role)}&next=${encodeURIComponent(nextPath)}`);
  }

  const roles = useMemo(
    () => [
      {
        id: "customer",
        title: "Customer",
        subtitle: "Request & track service",
        description: "Create requests, view ETA and accept quotes — simple and mobile-friendly.",
        role: "CUSTOMER",
        next: "/jobs",
        accent: "from-emerald-500 to-emerald-400",
        cta: "Open Customer Portal",
        tag: "For customers",
      },
      {
        id: "manager",
        title: "Manager",
        subtitle: "Dispatch & analytics",
        description: "Smart assignment, SLA tracking and operational insights in one place.",
        role: "DISPATCHER",
        next: "/manager",
        accent: "from-green-800 to-emerald-500",
        cta: "Open Manager Dashboard",
        tag: "For operations",
      },
      {
        id: "technician",
        title: "Technician",
        subtitle: "Field mobile app",
        description: "Offline-first, easy forms, route guidance and safety checks for teams.",
        role: "TECHNICIAN",
        next: "/tech",
        accent: "from-sky-400 to-cyan-400",
        cta: "Open Technician App",
        tag: "For field teams",
      },
    ],
    []
  );

  return (
    <div className={`${theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"} min-h-screen flex flex-col`}> 
      {/* Header */}
      <header className="w-full border-b" style={{ borderColor: theme === "dark" ? "rgba(148,163,184,0.06)" : "rgba(15,23,42,0.04)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-gradient-to-r from-emerald-500 to-cyan-400 p-1">
              <div className="px-3 py-1 rounded text-sm font-bold bg-white/5 backdrop-blur-sm">HOF</div>
            </div>
            <div className="flex flex-col leading-tight">
              <div className="text-base sm:text-lg font-semibold tracking-tight">HOF-SMART</div>
              <div className="text-xs text-slate-400 hidden sm:block">Human-aware · Offline-first field service</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-400">
              <span>Theme</span>
              <ThemeToggleBtn />
            </div>

            <button
              onClick={() => navigate('/auth')}
              className="px-3 py-2 rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-300"
              style={{
                background: theme === "dark" ? "rgba(255,255,255,0.04)" : "white",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(2,6,23,0.06)",
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          {/* Left: Hero */}
          <section className="space-y-5">
            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">Dispatch smarter. Respect people.</h1>
            <p className="text-base sm:text-lg text-slate-500 max-w-prose">HOF-SMART pairs explainable AI with resilient offline-first mobile workflows — reduce travel time, increase first-time fixes and keep teams safe, with transparent audit trails for managers.</p>

            <div className="flex flex-col sm:flex-row gap-3 mt-4">
              <button
                onClick={() => navigate('/auth')}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-300"
                style={{ background: 'linear-gradient(90deg,#059669,#10b981)', color: 'white' }}
              >
                Get started
              </button>

              <button
                onClick={() => document.getElementById('role-cards')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full sm:w-auto px-4 py-3 rounded-md border focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-200"
                style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'white' }}
              >
                Explore roles
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800">
                <div className="font-medium">Explainable decisions</div>
                <div className="text-sm text-slate-400 mt-1">Per-decision scores and audit trails for operator confidence.</div>
              </div>
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800">
                <div className="font-medium">Offline reliability</div>
                <div className="text-sm text-slate-400 mt-1">Local cache & outbox keep technicians productive in low-connectivity areas.</div>
              </div>
            </div>
          </section>

          {/* Right: Role selector */}
          <aside id="role-cards" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg sm:text-xl font-semibold">Choose your role</h3>
                <p className="text-sm text-slate-400">Select the workflow that fits you — you'll be prompted to sign in if required.</p>
              </div>
            </div>

            {/* MOBILE: horizontal scroll list with snap + desktop: grid */}
            <div className="block md:hidden">
              <div className="-mx-4 px-4 overflow-x-auto scroll-smooth snap-x snap-mandatory flex gap-4 pb-2">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCard(r.next, r.role)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCard(r.next, r.role); }}
                    className="snap-start w-72 flex-shrink-0 rounded-xl p-4 cursor-pointer border transition-transform transform hover:-translate-y-1 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    style={{ borderColor: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(2,6,23,0.06)', background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'white' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br ${r.accent} flex items-center justify-center text-white font-bold`}>
                        {r.title[0]}
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{r.title}</div>
                        <div className="text-xs text-slate-400">{r.tag}</div>
                        <div className="text-sm text-slate-500 mt-1">{r.subtitle}</div>
                        <div className="text-sm text-slate-400 mt-2 line-clamp-3">{r.description}</div>

                        <div className="mt-4">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCard(r.next, r.role); }}
                            className="w-full inline-flex items-center justify-center px-3 py-2 rounded-md font-semibold focus:outline-none"
                            style={{ background: 'linear-gradient(90deg,#059669,#10b981)', color: 'white' }}
                          >
                            {r.cta}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-400 mt-1 ml-2">Swipe horizontally to pick a role</div>
            </div>

            {/* DESKTOP: grid */}
            <div className="hidden md:grid md:grid-cols-1 gap-4">
              {roles.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCard(r.next, r.role)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCard(r.next, r.role); }}
                  className="relative rounded-xl p-5 cursor-pointer border transition-transform transform hover:-translate-y-1 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  style={{ borderColor: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(2,6,23,0.06)', background: theme === 'dark' ? 'rgba(255,255,255,0.02)' : 'white' }}
                >
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br ${r.accent} flex items-center justify-center text-white font-bold`}> 
                      {r.title[0]}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-base font-semibold truncate">{r.title}</div>
                        <div className="text-xs text-slate-400">{r.tag}</div>
                      </div>
                      <div className="text-sm text-slate-500 mt-1">{r.subtitle}</div>
                      <div className="text-sm text-slate-400 mt-2">{r.description}</div>

                      <div className="mt-4 flex items-center justify-between">
                        <div className="text-xs text-slate-400">Role-based access</div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCard(r.next, r.role); }}
                          className="inline-flex items-center gap-2 text-sm font-semibold focus:outline-none"
                        >
                          <span className={`inline-flex items-center px-3 py-1 rounded-md bg-gradient-to-r ${r.accent} text-white`}>{r.cta}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 text-sm text-slate-400">If you're unsure which role fits you, start as a customer and we'll guide you.</div>
          </aside>
        </div>

        {/* Key capabilities grid: responsive */}
        <section className="mt-10">
          <h4 className="text-lg font-semibold">Key capabilities</h4>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {[
              'Routing optimization',
              'Offline-first sync',
              'Automated assignment',
              'Safety monitoring'
            ].map((t) => (
              <div key={t} className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 text-sm">{t}</div>
            ))}
          </div>
        </section>
      </main>

      <footer className={`py-6 text-center text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
        HOF-SMART — Human-Aware Offline-First Field Service Management
      </footer>
    </div>
  );
}
