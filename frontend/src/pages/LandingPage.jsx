// frontend/src/pages/LandingPage.jsx
import React, { useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
// Import the hook from ThemeProvider with capital T
import { useTheme } from "../theme/ThemeProvider";

// Import the button
import ThemeToggleBtn from "../components/ThemeToggleBtn";

/**
 * LandingPage.jsx (uses global theme)
 * - Uses useTheme() instead of local theme state
 * - Keeps starfield in dark mode and flipping book visuals
 *
 * Replace your existing frontend/src/pages/LandingPage.jsx with this file.
 */

export default function LandingPage() {
  const navigate = useNavigate();
  const { auth } = useAuth();
  const user = auth?.user ?? null;

  // use global theme
  const { theme } = useTheme();

  function handleCard(nextPath, role) {
    const myRole = (user?.profile?.role ?? user?.role ?? "").toString().trim().toUpperCase();
    if (user && myRole === role) {
      navigate(nextPath);
      return;
    }
    navigate(`/auth?role=${encodeURIComponent(role)}&next=${encodeURIComponent(nextPath)}`);
  }

  const cards = useMemo(() => ([
    {
      id: "customer",
      title: "Customer Portal",
      subtitle: "Request & track service visits",
      bullets: ["Create and update requests", "Real-time status & ETA"],
      role: "CUSTOMER",
      next: "/jobs",
      accentFrom: "#059669",
      accentTo: "#10b981",
      cta: "Access Portal",
      tag: "For customers",
    },
    {
      id: "manager",
      title: "Manager Dashboard",
      subtitle: "Dispatch, monitor & analyse",
      bullets: ["Smart assignment & rules", "SLA & KPI visibility"],
      role: "DISPATCHER",
      next: "/manager",
      accentFrom: "#065f46",
      accentTo: "#10b981",
      cta: "Manager Login",
      tag: "For operations",
    },
    {
      id: "technician",
      title: "Technician Mobile",
      subtitle: "Field-ready, offline-capable",
      bullets: ["Offline sync & outbox", "Optimized routing & notes"],
      role: "TECHNICIAN",
      next: "/tech",
      accentFrom: "#0ea5e9",
      accentTo: "#06b6d4",
      cta: "Technician Login",
      tag: "For field teams",
    },
  ]), []);

  // Canvas starfield references (dark mode only)
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const starsRef = useRef([]);
  const lastRef = useRef(0);

  useEffect(() => {
    if (theme !== "dark") {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    let mounted = true;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = canvas.clientWidth * canvas.clientHeight;
      const count = Math.max(40, Math.min(220, Math.round(area / 8000)));
      const arr = [];
      for (let i = 0; i < count; i++) {
        const size = 0.6 + Math.random() * 1.6;
        arr.push({
          x: Math.random() * canvas.clientWidth,
          y: Math.random() * canvas.clientHeight,
          r: size,
          alpha: 0.2 + Math.random() * 0.85,
          twinkleSpeed: 0.5 + Math.random() * 1.8,
          vx: (Math.random() - 0.5) * 0.03,
          vy: -0.02 - Math.random() * 0.08,
          phase: Math.random() * Math.PI * 2,
        });
      }
      starsRef.current = arr;
    }

    function draw(now) {
      if (!mounted) return;
      const dt = Math.min(40, now - (lastRef.current || now));
      lastRef.current = now;

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // subtle nebula wash
      const g = ctx.createLinearGradient(0, 0, canvas.clientWidth, canvas.clientHeight);
      g.addColorStop(0, "rgba(6, 10, 14, 0.06)");
      g.addColorStop(1, "rgba(2, 6, 12, 0.06)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      const sarr = starsRef.current;
      for (let i = 0; i < sarr.length; i++) {
        const s = sarr[i];
        s.x += s.vx * (dt / 16);
        s.y += s.vy * (dt / 16);
        s.phase += 0.02 * (dt / 16) * s.twinkleSpeed;
        const a = Math.max(0, Math.min(1, s.alpha * (0.6 + Math.sin(s.phase) * 0.4)));
        if (s.y < -10) s.y = canvas.clientHeight + 10;
        if (s.x < -10) s.x = canvas.clientWidth + 10;
        if (s.x > canvas.clientWidth + 10) s.x = -10;

        const r = Math.max(0.4, s.r);
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 6);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.18, `rgba(255,255,255,${a * 0.75})`);
        grad.addColorStop(1, `rgba(255,255,255,0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(s.x - r * 6, s.y - r * 6, r * 12, r * 12);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    resize();
    rafRef.current = requestAnimationFrame(draw);
    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", onResize);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [theme]);

  // Book pages content (professional labels)
  const bookPages = [
    "Routing Optimization",
    "Offline-first Sync",
    "Automated Assignment",
    "Fatigue & Safety Monitoring",
  ];

  return (
    <div className={`${theme === "dark" ? "bg-slate-900 text-slate-100" : "bg-white text-slate-900"} min-h-screen relative antialiased`}>
      {/* canvas starfield (dark mode only) */}
      <div className="absolute inset-0 -z-10">
        {theme === "dark" ? (
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", background: "linear-gradient(180deg,#ffffff,#f8fafc)" }} />
        )}
      </div>

      <style>{`
        /* Book visuals */
        .book-scene { perspective: 1000px; display:flex; align-items:center; justify-content:center; }
        .book { width: 300px; height: 180px; position: relative; transform-style: preserve-3d; }
        .book-base {
          position: absolute;
          inset: 0;
          border-radius: 8px;
          box-shadow: 0 16px 40px rgba(2,6,23,0.10);
          transform: translateZ(-8px) rotateX(1deg);
        }

        .page {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          transform-origin: left center;
          transform-style: preserve-3d;
          backface-visibility: hidden;
          border-radius: 6px;
          overflow: hidden;
          display:flex;
          align-items:center;
          justify-content:center;
          padding: 18px;
          text-align:center;
        }

        .page-edge {
          position:absolute;
          left: -6px;
          top: 0;
          width: 6px;
          height: 100%;
          background: linear-gradient(180deg, rgba(0,0,0,0.02), rgba(0,0,0,0.05));
        }

        .page-front { box-shadow: 0 6px 18px rgba(2,6,23,0.06) inset; font-weight:700; font-size:16px; line-height:1.1; }
        .page-back  { transform: rotateY(180deg); font-weight:600; font-size:13px; opacity:0.95; }

        /* flipping sequence & staggered delays */
        .p0 { z-index: 50; animation: flip 6.8s infinite linear; animation-delay: 0s; }
        .p1 { z-index: 40; animation: flip 6.8s infinite linear; animation-delay: 1.6s; }
        .p2 { z-index: 30; animation: flip 6.8s infinite linear; animation-delay: 3.2s; }
        .p3 { z-index: 20; animation: flip 6.8s infinite linear; animation-delay: 4.8s; }
        @keyframes flip {
          0% { transform: rotateY(0deg); opacity:1 }
          22% { transform: rotateY(0deg); opacity:1 }
          38% { transform: rotateY(-180deg); opacity:0.98 }
          100% { transform: rotateY(-180deg); opacity:0.98 }
        }

        /* subtle texture for back face (no text) */
        .back-texture {
          background-image:
            linear-gradient(135deg, rgba(255,255,255,0.02) 10%, transparent 10%),
            linear-gradient(315deg, rgba(255,255,255,0.02) 10%, transparent 10%);
          background-size: 8px 8px;
          opacity: 0.9;
        }

        /* role cards / CTA shadows and hover */
        .role-card { transition: transform .18s cubic-bezier(.2,.9,.3,1), box-shadow .18s; border-radius: 12px; }
        .role-card:hover { transform: translateY(-8px); box-shadow: 0 28px 60px rgba(2,6,23,0.14); }

        .cta-text-btn { border: none; background: transparent; cursor: pointer; transition: transform .16s ease, box-shadow .16s ease; }
        .cta-text-btn:focus { outline: 3px solid rgba(16,185,129,0.14); outline-offset: 4px; }
        .cta-text-btn:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(2,6,23,0.12); }

        .primary-btn { transition: transform .12s ease, box-shadow .12s ease; box-shadow: 0 14px 40px rgba(2,6,23,0.12); }
        .primary-btn:hover { transform: translateY(-3px); box-shadow: 0 22px 56px rgba(2,6,23,0.18); }

        .focus-ring:focus { outline: 3px solid rgba(16,185,129,0.12); outline-offset: 4px; }

        @media (max-width: 640px) { .book { width: 240px; height: 140px; } .page { font-size: 14px; padding: 14px; } }
      `}</style>

      {/* Top navigation */}
      <header className={`w-full ${theme === "dark" ? "border-b border-slate-800" : "border-b border-slate-100"}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-xl font-bold tracking-tight">HOF-SMART</div>
            <div className="hidden sm:block text-sm text-slate-400">Human-aware · Offline-first field service</div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-500 mr-2 hidden sm:block">Theme</div>

            {/* use the global toggle component */}
            <ThemeToggleBtn />

            <button
              onClick={() => navigate("/auth")}
              className={`px-3 py-2 rounded-md text-sm primary-btn focus-ring`}
              style={{
                background: theme === "dark" ? "#0b1220" : "#ffffff",
                border: theme === "dark" ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(2,6,23,0.06)",
                color: theme === "dark" ? "#f8fafc" : "#071422",
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left: Hero */}
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">Dispatch smarter. Respect people.</h1>
            <p className="mt-4 text-lg text-slate-500 max-w-prose">
              HOF-SMART pairs compact, explainable AI with resilient offline-first mobile workflows.
              Reduce travel time, increase first-time fixes and keep technicians safe — with transparent auditability for dispatchers.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => navigate("/auth")}
                className="px-6 py-3 rounded-md text-white font-semibold primary-btn focus-ring"
                style={{ background: "linear-gradient(90deg,#059669,#10b981)" }}
              >
                Get started
              </button>

              <button
                onClick={() => document.getElementById("role-cards")?.scrollIntoView({ behavior: "smooth" })}
                className={`px-5 py-3 rounded-md border focus-ring`}
                style={{
                  background: theme === "dark" ? "#071022" : "#ffffff",
                  border: theme === "dark" ? "1px solid rgba(255,255,255,0.04)" : "1px solid rgba(2,6,23,0.06)",
                  color: theme === "dark" ? "#f8fafc" : "#071422",
                }}
              >
                Explore roles
              </button>
            </div>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg ${theme === "dark" ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className="font-medium">Explainable decisions</div>
                <div className="text-sm text-slate-400 mt-1">Per-decision scores and audit trails for operator confidence.</div>
              </div>
              <div className={`p-4 rounded-lg ${theme === "dark" ? "bg-slate-800" : "bg-white"} shadow-sm`}>
                <div className="font-medium">Offline reliability</div>
                <div className="text-sm text-slate-400 mt-1">Local cache & outbox keep technicians productive in low-connectivity areas.</div>
              </div>
            </div>
          </div>

          {/* Right: Role cards (equal sizes) */}
          <div id="role-cards">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {cards.map((c) => (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCard(c.next, c.role)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCard(c.next, c.role); }}
                  className="card-equal rounded-xl p-6 cursor-pointer focus-ring role-card"
                  style={{
                    background: theme === "dark" ? "#071022" : "#ffffff",
                    border: theme === "dark" ? "1px solid rgba(255,255,255,0.03)" : "1px solid rgba(2,6,23,0.04)",
                  }}
                >
                  <div className="flex items-start gap-4">
                    {/* initials as gradient text only (no filled background) */}
                    <div style={{
                      fontSize: 20,
                      fontWeight: 800,
                      background: `linear-gradient(90deg, ${c.accentFrom}, ${c.accentTo})`,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                      lineHeight: 1,
                    }}>
                      {c.title.split(" ").map(s => s[0]).slice(0,2).join("")}
                    </div>

                    <div className="min-w-0">
                      <div className="text-base font-semibold">{c.title}</div>
                      <div className="text-sm text-slate-400">{c.subtitle}</div>
                    </div>
                  </div>

                  <ul className="mt-4 text-sm text-slate-400 space-y-1 flex-1">
                    {c.bullets.map((b, i) => (
                      <li key={i} className="leading-snug">• {b}</li>
                    ))}
                  </ul>

                  <div className="mt-4 flex items-center justify-between">
                    {/* CTA: gradient text only (no filled background) but with shadow to show clickability */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCard(c.next, c.role); }}
                      className="cta-text-btn focus-ring"
                      style={{ paddingLeft: 0, paddingRight: 0 }}
                    >
                      <span style={{
                        background: `linear-gradient(90deg, ${c.accentFrom}, ${c.accentTo})`,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                        fontWeight: 700,
                        filter: theme === "light" ? "drop-shadow(0 2px 6px rgba(6,95,70,0.10))" : "drop-shadow(0 2px 6px rgba(0,0,0,0.12))",
                      }}>{c.cta}</span>
                    </button>

                    <div className="text-xs text-slate-400">{c.tag}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 text-sm text-slate-400">Choose your role — you'll be prompted to sign in if required.</div>
          </div>
        </div>

        {/* Flipping book (centered) */}
        <div className="mt-12 flex justify-center">
          <div className="book-scene" aria-hidden>
            <div className="book" role="img" aria-label="Product highlights book">
              <div
                className="book-base"
                style={{
                  background: theme === "dark"
                    ? "linear-gradient(180deg, rgba(2,6,23,0.48), rgba(2,6,23,0.28))"
                    : "linear-gradient(180deg, rgba(6,11,13,0.04), rgba(6,11,13,0.02))",
                }}
              />

              {bookPages.map((label, i) => {
                const frontStyle = theme === "dark"
                  ? { background: "#041018", color: "#10b981", boxShadow: "0 8px 28px rgba(2,6,23,0.28) inset" }
                  : { background: "#ffffff", color: "#065f46", boxShadow: "0 6px 14px rgba(2,6,23,0.04) inset" };

                const backStyle = theme === "dark"
                  ? { background: "#08131a", color: "#0b4f2e", opacity: 0.9 }
                  : { background: "#f6f7f8", color: "#0b4f2e", opacity: 0.95 };

                return (
                  <div key={i} className={`page p${i}`} style={{ left: `${i * 1}px` }}>
                    <div className="page-front" style={{ ...frontStyle, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, padding: 18, textAlign: "center" }}>
                      <div>{label}</div>
                      <div className="page-edge" />
                    </div>

                    <div className="page-back back-texture" style={{ ...backStyle, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13, padding: 12, textAlign: "center" }}>
                      <div aria-hidden style={{ width: "100%", height: "100%" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <footer className={`py-8 text-center text-sm ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`}>
        HOF-SMART — Human-Aware Offline-First Field Service Management
      </footer>
    </div>
  );
}
