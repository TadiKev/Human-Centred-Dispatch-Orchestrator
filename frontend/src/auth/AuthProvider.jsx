// frontend/src/auth/AuthProvider.jsx
import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Exports:
 *  - AuthContext (for legacy components that import it directly)
 *  - useAuth() hook (recommended)
 *  - AuthProvider component (wrap app)
 *
 * Auth object shape:
 * {
 *   access: string | null,
 *   refresh: string | null,
 *   user: object | null
 * }
 *
 * Tokens + user are persisted in localStorage for the demo.
 * (In prod use httpOnly cookies and secure flows.)
 */

export const AuthContext = createContext({
  auth: { access: null, refresh: null, user: null },
  setAuth: () => {},
  logout: () => {},
});

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      user = null;
    }
    return {
      access: localStorage.getItem("access") || null,
      refresh: localStorage.getItem("refresh") || null,
      user,
    };
  });

  useEffect(() => {
    if (auth.access) localStorage.setItem("access", auth.access);
    else localStorage.removeItem("access");

    if (auth.refresh) localStorage.setItem("refresh", auth.refresh);
    else localStorage.removeItem("refresh");

    if (auth.user) localStorage.setItem("user", JSON.stringify(auth.user));
    else localStorage.removeItem("user");
  }, [auth]);

  function logout() {
    setAuth({ access: null, refresh: null, user: null });
  }

  return (
    <AuthContext.Provider value={{ auth, setAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
