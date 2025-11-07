// frontend/src/pages/HealthPage.jsx
import React, { useEffect, useState } from "react";

export default function HealthPage() {
  const [health, setHealth] = useState(null);
  useEffect(() => {
    fetch("/api/health/")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);
  return (
    <div style={{ padding: 20 }}>
      <h1>HOF-SMART</h1>
      <p>Backend health:</p>
      <pre>{JSON.stringify(health, null, 2)}</pre>
    </div>
  );
}
