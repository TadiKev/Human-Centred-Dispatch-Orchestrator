import React, { useState } from "react";
import { apiFetch } from "../api/fetcher";
import { useAuth } from "../auth/AuthProvider";

export default function AutoAssignButton({ jobId, onAssigned }) {
  const { auth } = useAuth();
  const token = auth?.access;
  const [loading, setLoading] = useState(false);

  async function handleAutoAssign() {
    if (!confirm("Auto-assign this job using rules?")) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/auto_assign/?job_id=${jobId}`, {
        method: "POST",
        body: { assign: true, reason: "Auto-rule dispatch" },
        token
      });
      alert("Auto assigned: " + (res.assignment?.technician?.user?.username ?? "unknown"));
      if (onAssigned) onAssigned();
    } catch (e) {
      console.error(e);
      alert("Auto-assign failed: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="btn btn-secondary" onClick={handleAutoAssign} disabled={loading}>
      {loading ? "Auto assigning…" : "Auto-assign"}
    </button>
  );
}
