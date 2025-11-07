// frontend/src/components/ThemeToggleBtn.jsx
import React from "react";
import { useTheme } from "../theme/ThemeProvider"; // Capital T

export default function ThemeToggleBtn({ className = "" }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      aria-label="Toggle theme"
      onClick={toggle}
      className={`w-10 h-10 rounded-md flex items-center justify-center ${className}`}
    >
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
