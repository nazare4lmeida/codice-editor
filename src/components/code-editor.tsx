import { useMemo } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { EditorView, Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { githubLight, githubDark } from "@uiw/codemirror-theme-github";
import { useTheme } from "@/hooks/use-theme";

/* ---------- color swatch decoration ---------- */

const COLOR_RE =
  /#(?:[0-9a-fA-F]{3,4}){1,2}\b|\brgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)|\bhsla?\(\s*[\d.]+(?:deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(?:,\s*[\d.]+\s*)?\)/g;

function toHex(color: string): string {
  if (color.startsWith("#")) {
    if (color.length === 4)
      return "#" + [...color.slice(1)].map((c) => c + c).join("");
    if (color.length === 5)
      return "#" + [...color.slice(1, 4)].map((c) => c + c).join("");
    return color.length >= 7 ? color.slice(0, 7) : color;
  }
  const m = color.match(/[\d.]+/g);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

class ColorSwatchWidget extends WidgetType {
  constructor(readonly color: string, readonly from: number, readonly to: number) {
    super();
  }
  eq(other: ColorSwatchWidget) {
    return other.color === this.color && other.from === this.from && other.to === this.to;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-color-swatch";
    wrap.style.cssText =
      "display:inline-block;width:0.85em;height:0.85em;margin-right:0.25em;vertical-align:-2px;border:1px solid rgba(127,127,127,0.4);border-radius:3px;cursor:pointer;position:relative;";
    wrap.style.backgroundColor = this.color;
    wrap.title = "Alterar cor";
    const input = document.createElement("input");
    input.type = "color";
    input.value = toHex(this.color);
    input.style.cssText = "position:absolute;inset:0;opacity:0;cursor:pointer;padding:0;border:0;";
    wrap.appendChild(input);
    input.addEventListener("input", () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: input.value } });
    });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildColorDecorations(view: EditorView): DecorationSet {
  const widgets: { from: number; deco: Decoration }[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let m: RegExpExecArray | null;
    COLOR_RE.lastIndex = 0;
    while ((m = COLOR_RE.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      widgets.push({
        from: start,
        deco: Decoration.widget({
          widget: new ColorSwatchWidget(m[0], start, end),
          side: -1,
        }),
      });
    }
  }
  widgets.sort((a, b) => a.from - b.from);
  return Decoration.set(widgets.map((w) => w.deco.range(w.from)));
}

const colorSwatchPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildColorDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = buildColorDecorations(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/* ---------- language picker ---------- */

function extFor(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1).toLowerCase() : "";
}

function langExtension(path: string): Extension | null {
  switch (extFor(path)) {
    case "html":
    case "htm":
    case "svg":
      return html();
    case "css":
      return css();
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "json":
      return json();
    default:
      return null;
  }
}

/* ---------- component ---------- */

export interface CodeEditorProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CodeEditor({ value, path, onChange, disabled, placeholder }: CodeEditorProps) {
  const { theme } = useTheme();
  const extensions = useMemo(() => {
    const exts: Extension[] = [
      EditorView.lineWrapping,
      colorSwatchPlugin,
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.55" },
        ".cm-content": { padding: "12px 0" },
        ".cm-gutters": { backgroundColor: "transparent", border: "none" },
      }),
    ];
    const lang = langExtension(path);
    if (lang) exts.push(lang);
    return exts;
  }, [path]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={theme === "dark" ? githubDark : githubLight}
      extensions={extensions}
      editable={!disabled}
      readOnly={disabled}
      placeholder={placeholder}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        indentOnInput: true,
      }}
      style={{ height: "100%", width: "100%", overflow: "hidden" }}
    />
  );
}
