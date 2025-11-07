// src/Me.jsx
import { useEffect, useState } from "react";
import api from "./api";

export default function Me() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.get("/api/users/me/").then(r => setMe(r.data)).catch(()=>setMe(null));
  }, []);
  if (!me) return <div>Loading...</div>;
  return <div>
    <h2>{me.username} — role: {me.profile?.role}</h2>
  </div>
}
