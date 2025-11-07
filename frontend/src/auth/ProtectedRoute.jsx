// frontend/src/auth/ProtectedRoute.jsx
import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute({ allowedRoles = null, redirectTo = "/auth" }) {
  const { auth } = useAuth();

  if (!auth?.access) {
    return <Navigate to={redirectTo} replace />;
  }

  if (allowedRoles && (!auth.user || !allowedRoles.includes(auth.user.role))) {
    return <div style={{ padding: 20 }}>Forbidden: you don't have the required role.</div>;
  }

  return <Outlet />;
}
