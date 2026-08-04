import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import type { Palette, Theme } from "@/hooks/use-theme";

/**
 * Editor color themes derived from the site palettes.
 * We intentionally use transparent backgrounds so the editor
 * inherits the app surface color; only syntax colors change.
 */

type Spec = {
  fg: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  variable: string;
  function: string;
  type: string;
  tag: string;
  attr: string;
  operator: string;
  punctuation: string;
  selection: string;
  cursor: string;
  activeLine: string;
  gutter: string;
  gutterFg: string;
};

function build(name: string, dark: boolean, s: Spec): Extension {
  return createTheme({
    theme: dark ? "dark" : "light",
    settings: {
      background: "transparent",
      foreground: s.fg,
      caret: s.cursor,
      selection: s.selection,
      selectionMatch: s.selection,
      lineHighlight: s.activeLine,
      gutterBackground: "transparent",
      gutterForeground: s.gutterFg,
      gutterActiveForeground: s.fg,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    styles: [
      {
        tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
        color: s.comment,
        fontStyle: "italic",
      },
      { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: s.keyword },
      { tag: [t.string, t.special(t.string), t.regexp], color: s.string },
      { tag: [t.number, t.bool, t.null, t.atom], color: s.number },
      { tag: [t.variableName, t.propertyName], color: s.variable },
      {
        tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
        color: s.function,
      },
      { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: s.type },
      { tag: [t.tagName, t.angleBracket], color: s.tag },
      { tag: [t.attributeName], color: s.attr },
      {
        tag: [
          t.operator,
          t.definitionOperator,
          t.updateOperator,
          t.logicOperator,
          t.compareOperator,
          t.arithmeticOperator,
        ],
        color: s.operator,
      },
      { tag: [t.punctuation, t.bracket, t.brace, t.paren, t.separator], color: s.punctuation },
      { tag: [t.heading], color: s.keyword, fontWeight: "600" },
      { tag: [t.link, t.url], color: s.function, textDecoration: "underline" },
      { tag: [t.invalid], color: "#ff6b6b" },
    ],
  }) as unknown as Extension;
}

/* ---------- Palette specs (light / dark) ---------- */

const SPECS: Record<Palette, { light: Spec; dark: Spec }> = {
  default: {
    light: {
      fg: "#0f172a",
      comment: "#64748b",
      keyword: "#7c3aed",
      string: "#0f766e",
      number: "#b45309",
      variable: "#0f172a",
      function: "#1d4ed8",
      type: "#0e7490",
      tag: "#be123c",
      attr: "#7c3aed",
      operator: "#334155",
      punctuation: "#475569",
      selection: "#c7d2fe66",
      cursor: "#0f172a",
      activeLine: "#f1f5f955",
      gutter: "transparent",
      gutterFg: "#94a3b8",
    },
    dark: {
      fg: "#e2e8f0",
      comment: "#7d8ba1",
      keyword: "#c4a3ff",
      string: "#7ee8c1",
      number: "#f5c48c",
      variable: "#e2e8f0",
      function: "#82aaff",
      type: "#7dd3fc",
      tag: "#ff8eb1",
      attr: "#c4a3ff",
      operator: "#cbd5e1",
      punctuation: "#94a3b8",
      selection: "#33415588",
      cursor: "#e2e8f0",
      activeLine: "#1e293b55",
      gutter: "transparent",
      gutterFg: "#64748b",
    },
  },
  rose: {
    light: {
      fg: "#4e413b",
      comment: "#a08b7b",
      keyword: "#a45a6e",
      string: "#7a8a4e",
      number: "#c67b3c",
      variable: "#4e413b",
      function: "#8a5a3c",
      type: "#6b6a4e",
      tag: "#a45a6e",
      attr: "#c67b3c",
      operator: "#7a6a60",
      punctuation: "#8a7868",
      selection: "#d2ac9455",
      cursor: "#a45a6e",
      activeLine: "#ebd5bc44",
      gutter: "transparent",
      gutterFg: "#b9a794",
    },
    dark: {
      fg: "#ebd5bc",
      comment: "#a08b7b",
      keyword: "#d2899c",
      string: "#c9d18a",
      number: "#e8a674",
      variable: "#ebd5bc",
      function: "#e8b088",
      type: "#d2ac94",
      tag: "#d2899c",
      attr: "#e8a674",
      operator: "#c9b8a4",
      punctuation: "#b9a794",
      selection: "#a45a6e55",
      cursor: "#d2899c",
      activeLine: "#4e413b55",
      gutter: "transparent",
      gutterFg: "#8a7868",
    },
  },
  ocean: {
    light: {
      fg: "#223047",
      comment: "#7a8ba0",
      keyword: "#3d5a80",
      string: "#2c7a7b",
      number: "#b45309",
      variable: "#223047",
      function: "#4a6178",
      type: "#0e7490",
      tag: "#8b3a5a",
      attr: "#3d5a80",
      operator: "#55677d",
      punctuation: "#6a7c94",
      selection: "#9db2bf55",
      cursor: "#4a6178",
      activeLine: "#dde6ed55",
      gutter: "transparent",
      gutterFg: "#9db2bf",
    },
    dark: {
      fg: "#dde6ed",
      comment: "#7d94ab",
      keyword: "#a8c5db",
      string: "#8fd6c4",
      number: "#f5c48c",
      variable: "#dde6ed",
      function: "#c6d3dd",
      type: "#88bcd0",
      tag: "#e8a8b8",
      attr: "#a8c5db",
      operator: "#b8c9d8",
      punctuation: "#9db2bf",
      selection: "#4a617866",
      cursor: "#9db2bf",
      activeLine: "#2e3e5455",
      gutter: "transparent",
      gutterFg: "#6a7c94",
    },
  },
  forest: {
    light: {
      fg: "#14352f",
      comment: "#7a9088",
      keyword: "#14352f",
      string: "#5e8a75",
      number: "#a86b2c",
      variable: "#14352f",
      function: "#2f6b52",
      type: "#4a8a6b",
      tag: "#8a4a3c",
      attr: "#2f6b52",
      operator: "#4a6b62",
      punctuation: "#5c7a70",
      selection: "#92b2a244",
      cursor: "#14352f",
      activeLine: "#dbe7e155",
      gutter: "transparent",
      gutterFg: "#92b2a2",
    },
    dark: {
      fg: "#dbe7e1",
      comment: "#7a9088",
      keyword: "#a8d4be",
      string: "#92b2a2",
      number: "#e8b476",
      variable: "#dbe7e1",
      function: "#b8dcc8",
      type: "#88c4a8",
      tag: "#e8b0a0",
      attr: "#a8d4be",
      operator: "#b8c9c2",
      punctuation: "#92b2a2",
      selection: "#5e8a7555",
      cursor: "#92b2a2",
      activeLine: "#1f403855",
      gutter: "transparent",
      gutterFg: "#5e8a75",
    },
  },
};

const CACHE = new Map<string, Extension>();

export function getEditorTheme(palette: Palette, theme: Theme): Extension {
  const key = `${palette}:${theme}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const spec = SPECS[palette][theme];
  const ext = build(key, theme === "dark", spec);
  CACHE.set(key, ext);
  return ext;
}
