import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../theme/ThemeProvider";

/**
 * JobCard (robust theme-aware 3D card)
 * - Uses inline JS styles derived from the current theme for deterministic results.
 * - Hover lift implemented with onMouseEnter/onMouseLeave (no external CSS dependencies).
 * - Preserves original behavior but now supports an `onView(job)` prop. If `onView`
 *   is provided the View button will call it (so parent can open an opaque modal).
 *   Otherwise it falls back to client-side navigation to `/requests/:id`.
 */

export default function JobCard({ job = {}, onView = null }) {
  const { theme } = useTheme();
  const [hover, setHover] = useState(false);
  const navigate = useNavigate();

  // ensure pages that rely on data-theme still get it (keeps compatibility)
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch (e) {}
  }, [theme]);

  // Theme-aware palette (fallbacks included)
  const pal = {
    light: {
      cardSurface: "#ffffff",
      cardBg: "#ffffff",
      text: "#0f1724",
      muted: "#475569",
      accent: "#16a34a",
      border: "rgba(2,6,23,0.06)",
      glass: "rgba(0,0,0,0.03)",
      shadow: "rgba(2,6,23,0.06)",
    },
    dark: {
      cardSurface: "#0f1724",
      cardBg: "#0b1220",
      text: "#e6eef7",
      muted: "#9aa7b8",
      accent: "#16a34a",
      border: "rgba(255,255,255,0.04)",
      glass: "rgba(255,255,255,0.03)",
      shadow: "rgba(2,6,23,0.14)",
    },
  }[theme === "dark" ? "dark" : "light"];

  // small helpers
  const safeText = (v) => (v == null ? "—" : String(v));
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

  // status mapping -> color cues (still bold labels)
  const statusMap = {
    new: { label: "Pending", bg: theme === "dark" ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)", color: pal.muted },
    assigned: { label: "Assigned", bg: "rgba(59,130,246,0.09)", color: "#2563eb" },
    in_progress: { label: "In progress", bg: "rgba(245,158,11,0.10)", color: "#b45309" },
    done: { label: "Completed", bg: "rgba(16,185,129,0.10)", color: "#059669" },
    completed: { label: "Completed", bg: "rgba(16,185,129,0.10)", color: "#059669" },
    cancelled: { label: "Cancelled", bg: "rgba(239,68,68,0.10)", color: "#b91c1c" },
  };
  const sKey = (job.status || "new").toLowerCase();
  const sInfo = statusMap[sKey] || { label: sKey || "Unknown", bg: theme === "dark" ? "rgba(148,163,184,0.06)" : "rgba(148,163,184,0.08)", color: pal.muted };

  // technician display (preserve previous normalization)
  const techDisplay = (() => {
    const at = job.assigned_technician;
    if (!at) return null;
    if (typeof at === "string") return at;
    if (typeof at === "object") {
      return at.display_name || at.username || (at.user && (at.user.username || at.user.email)) || JSON.stringify(at);
    }
    return String(at);
  })();

  // inline styles (3D card + hover)
  const cardStyle = {
    background: `linear-gradient(180deg, ${pal.cardSurface}, ${pal.cardBg})`,
    color: pal.text,
    borderRadius: 14,
    padding: 16,
    border: `1px solid ${pal.border}`,
    boxShadow: hover
      ? `0 18px 40px ${pal.shadow}`
      : `0 8px 18px ${pal.shadow}`,
    transform: hover ? "translateY(-8px) scale(1.01)" : "translateY(0) scale(1)",
    transition: "transform .16s cubic-bezier(.2,.9,.2,1), box-shadow .16s ease",
    position: "relative",
    overflow: "hidden",
  };

  const afterShadowStyle = {
    content: '""',
    position: "absolute",
    left: 12,
    right: 12,
    bottom: -12,
    height: 20,
    borderRadius: 12,
    background: "linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.12))",
    filter: "blur(10px)",
    opacity: hover ? 1 : 0.9,
    transform: hover ? "translateY(-14px)" : "translateY(0)",
    transition: "transform .16s ease, opacity .16s ease",
    zIndex: 0,
  };

  const titleStyle = { fontSize: 18, lineHeight: 1.15, fontWeight: 700, color: pal.text, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const noteStyle = { marginTop: 6, color: pal.muted, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" };
  const metaGridStyle = { marginTop: 12, color: pal.muted, fontSize: 13, display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, zIndex: 1 };
  const rightColStyle = { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12, zIndex: 1, minWidth: 120 };

  const statusPillStyle = {
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 12,
    background: sInfo.bg,
    color: sInfo.color,
  };

  const linkStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${pal.border}`,
    background: "transparent",
    color: pal.text,
    textDecoration: "none",
    fontSize: 14,
    cursor: "pointer",
  };

  const contactStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    background: `linear-gradient(180deg, ${pal.accent}, #059669)`,
    color: "#fff",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
  };

  // handler for View button: use onView if provided, otherwise navigate
  function handleViewClick(e) {
    if (typeof onView === "function") {
      e.preventDefault && e.preventDefault();
      onView(job);
      return;
    }
    // fallback navigation
    navigate(`/requests/${job.id}`);
  }

  return (
    <article
      role="article"
      aria-labelledby={`job-${job.id}-title`}
      style={cardStyle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* faux layered shadow element (JS-rendered) */}
      <div style={afterShadowStyle} aria-hidden />

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 id={`job-${job.id}-title`} style={titleStyle} title={job.customer_name || job.title || "Service request"}>
            {job.customer_name || job.title || "Service request"}
          </h3>

          <p style={noteStyle} title={job.notes || job.description || ""}>
            {job.notes || job.description || ""}
          </p>

          <div style={metaGridStyle} aria-hidden>
            <div>
              <div style={{ fontSize: 11, color: pal.muted }}>Address</div>
              <div style={{ color: pal.text }}>{safeText(job.address)}</div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: pal.muted }}>Created</div>
              <div style={{ color: pal.text }}>{fmtDate(job.created_at)}</div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: pal.muted }}>Technician</div>
              <div style={{ color: pal.text }}>{techDisplay || "Not assigned"}</div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: pal.muted }}>ETA</div>
              <div style={{ color: pal.text }}>{job.estimated_arrival ? fmtDate(job.estimated_arrival) : "—"}</div>
            </div>
          </div>
        </div>

        <div style={rightColStyle}>
          <div style={statusPillStyle} aria-hidden>{sInfo.label}</div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleViewClick}
              style={linkStyle}
              aria-label={`View request ${job.id}`}
              type="button"
            >
              View
            </button>

            <button
              type="button"
              style={contactStyle}
              onClick={() => {
                // preserve original placeholder behavior
                if (techDisplay) {
                  alert(`Contact ${techDisplay}`);
                } else {
                  alert("Technician not assigned yet.");
                }
              }}
              aria-label="Contact technician"
            >
              Contact
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
