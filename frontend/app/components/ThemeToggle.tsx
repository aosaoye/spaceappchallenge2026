"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

function applyThemeToDom(targetTheme: "light" | "dark") {
  const root = document.documentElement;
  const body = document.body;
  const bg = targetTheme === "dark" ? "#0a0a0a" : "#ffffff";
  const fg = targetTheme === "dark" ? "#ededed" : "#171717";

  root.setAttribute("data-theme", targetTheme);
  root.classList.toggle("dark", targetTheme === "dark");
  root.classList.toggle("light", targetTheme === "light");
  root.style.setProperty("--background", bg);
  root.style.setProperty("--foreground", fg);
  root.style.setProperty("--color-background", bg);
  root.style.setProperty("--color-foreground", fg);
  root.style.colorScheme = targetTheme;

  if (body) {
    body.setAttribute("data-theme", targetTheme);
    body.classList.toggle("dark", targetTheme === "dark");
    body.classList.toggle("light", targetTheme === "light");
    body.style.backgroundColor = bg;
    body.style.color = fg;
  }

  window.dispatchEvent(
    new CustomEvent<"light" | "dark">("spherex-theme-change", {
      detail: targetTheme,
    })
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("spherex-theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const initial: "light" | "dark" =
      saved === "light" || saved === "dark"
        ? saved
        : prefersDark
        ? "dark"
        : "light";

    applyThemeToDom(initial);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(initial);
  }, []);

  function toggleTheme() {
    const next: "light" | "dark" = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("spherex-theme", next);
    applyThemeToDom(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
      }
      title={
        theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"
      }
      className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-black/[.08] px-3 text-xs font-medium transition-colors hover:bg-[#f2f2f2] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
    >
      {theme === "dark" ? (
        <>
          <Sun className="h-3.5 w-3.5" />
          <span>Modo claro</span>
        </>
      ) : (
        <>
          <Moon className="h-3.5 w-3.5" />
          <span>Modo oscuro</span>
        </>
      )}
    </button>
  );
}
