import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type Palette = "default" | "rose" | "ocean" | "forest";

export const PALETTES: { id: Palette; name: string; swatches: string[] }[] = [
  { id: "default", name: "Ardósia", swatches: ["#0f172a", "#334155", "#94a3b8", "#f1f5f9"] },
  { id: "rose", name: "Rosé Terroso", swatches: ["#4e413b", "#a45a6e", "#d2ac94", "#ebd5bc"] },
  { id: "ocean", name: "Marinho Sereno", swatches: ["#223047", "#4a6178", "#9db2bf", "#dde6ed"] },
  {
    id: "forest",
    name: "Floresta Profunda",
    swatches: ["#050e13", "#14352f", "#5e8a75", "#92b2a2"],
  },
];

const THEME_KEY = "codice:theme";
const PALETTE_KEY = "codice:palette";

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

/* -------- shared store -------- */

type State = { theme: Theme; palette: Palette };

const SERVER_STATE: State = { theme: "light", palette: "default" };

let state: State = SERVER_STATE;
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot(): State {
  return SERVER_STATE;
}

function hydrateThemeStore() {
  if (typeof window === "undefined" || hydrated) return;
  hydrated = true;
  state = { theme: readInitialTheme(), palette: readInitialPalette() };
  applyTheme(state.theme);
  applyPalette(state.palette);
  emit();
}

function setTheme(next: Theme | ((t: Theme) => Theme)) {
  const value = typeof next === "function" ? next(state.theme) : next;
  if (value === state.theme) return;
  state = { ...state, theme: value };
  applyTheme(value);
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* ignore */
  }
  emit();
}

function setPalette(next: Palette) {
  if (next === state.palette) return;
  state = { ...state, palette: next };
  applyPalette(next);
  try {
    localStorage.setItem(PALETTE_KEY, next);
  } catch {
    /* ignore */
  }
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      setTheme(e.newValue);
    } else if (e.key === PALETTE_KEY) {
      const p = e.newValue as Palette | null;
      if (p && PALETTES.some((x) => x.id === p)) setPalette(p);
    }
  });
}

export function useTheme() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    hydrateThemeStore();
  }, []);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return {
    theme: snap.theme,
    palette: snap.palette,
    toggle,
    setTheme,
    setPalette,
  };
}
