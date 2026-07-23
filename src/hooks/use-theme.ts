import { useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark";
export type Palette = "default" | "rose" | "ocean" | "forest";

export const PALETTES: { id: Palette; name: string; swatches: string[] }[] = [
  { id: "default", name: "Ardósia", swatches: ["#0f172a", "#334155", "#94a3b8", "#f1f5f9"] },
  { id: "rose", name: "Rosé Terroso", swatches: ["#4e413b", "#a45a6e", "#d2ac94", "#ebd5bc"] },
  { id: "ocean", name: "Marinho Sereno", swatches: ["#223047", "#4a6178", "#9db2bf", "#dde6ed"] },
  { id: "forest", name: "Floresta Profunda", swatches: ["#050e13", "#14352f", "#5e8a75", "#92b2a2"] },
];

const THEME_KEY = "codelive:theme";
const PALETTE_KEY = "codelive:palette";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem(THEME_KEY) as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readInitialPalette(): Palette {
  if (typeof window === "undefined") return "default";
  const saved = localStorage.getItem(PALETTE_KEY) as Palette | null;
  if (saved && PALETTES.some((p) => p.id === saved)) return saved;
  return "default";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = theme;
}

function applyPalette(palette: Palette) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (palette === "default") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", palette);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readInitialTheme();
    applyTheme(t);
    return t;
  });
  const [palette, setPaletteState] = useState<Palette>(() => {
    const p = readInitialPalette();
    applyPalette(p);
    return p;
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    applyPalette(palette);
    try {
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      /* ignore */
    }
  }, [palette]);

  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);
  const setPalette = useCallback((p: Palette) => setPaletteState(p), []);
  return { theme, toggle, setTheme: setThemeState, palette, setPalette };
}
