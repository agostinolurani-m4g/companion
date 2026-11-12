"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type AppTheme = "dark" | "light";

const KEY = "hmr.v2.theme";

type Ctx = { theme: AppTheme; setTheme: (t: AppTheme) => void; toggle: () => void };

const ThemeContext = createContext<Ctx>({ theme: "dark", setTheme: () => {}, toggle: () => {} });

/** Tema app v2 (scuro di default, chiaro "pietra"), persistito per dispositivo. */
export function V2ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("dark");

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === "light" || v === "dark") setThemeState(v);
    } catch {
      /* storage non disponibile */
    }
  }, []);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(KEY, t);
    } catch {
      /* storage non disponibile */
    }
  }, []);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [setTheme, theme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useV2Theme(): Ctx {
  return useContext(ThemeContext);
}
