// frontend/src/theme/themeProvider.jsx
import React, { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext({
  theme: "light",
  setTheme: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("hof-theme");
      if (saved === "dark" || saved === "light") return saved;
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
        return "dark";
    } catch (e) {}
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (!root) return;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try { localStorage.setItem("hof-theme", theme); } catch (e) {}
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
