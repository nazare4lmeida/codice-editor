import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileCode,
  Layout,
  MessageSquare,
  Play,
  Plus,
  Save,
  Send,
  Smile,
  Terminal,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
  Pencil,
} from "lucide-react";
import JSZip from "jszip";
import { ThemeToggle } from "@/components/theme-toggle";
import { PalettePicker } from "@/components/palette-picker";
import { CodeEditor } from "@/components/code-editor";


export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Sala ${params.code} — Codice` },
      {
        name: "description",
        content: "Editor colaborativo ao vivo para aulas.",
      },
      { property: "og:title", content: `Sala ${params.code} — Codice` },
      { property: "og:description", content: "Editor colaborativo ao vivo para aulas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: `Sala ${params.code} — Codice` },
      { name: "twitter:description", content: "Editor colaborativo ao vivo para aulas." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RoomPage,
});

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const DEFAULT_PROJECT: ProjectFiles = {
  "index.html": `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1 id="title">Olá turma!</h1>
    <button id="btn">Clique aqui</button>
    <script src="script.js"></script>
  </body>
</html>`,
  "styles.css": `body {
  font-family: system-ui, sans-serif;
  padding: 2rem;
  background: #0f172a;
  color: #f8fafc;
}

button {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 0;
  background: #3b82f6;
  color: white;
  cursor: pointer;
}`,
  "script.js": `document.getElementById('btn').addEventListener('click', () => {
  document.getElementById('title').textContent = 'Você clicou!';
  console.log('Botão clicado');
});`,
};

type ProjectFiles = Record<string, string>;
type OutputTab = "validate" | "preview" | "console";
type SidePanel = "none" | "people" | "chat";
type SaveState = "saved" | "saving" | "error";

interface Participant {
  id: string;
  name: string;
  color: string;
}

interface ChatMsg {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  at: number;
}

interface EditingInfo {
  name: string;
  color: string;
  path: string;
  at: number;
}

interface Diagnostic {
  file: string;
  line?: number;
  message: string;
  hint?: string;
}

interface RoomDraftCache {
  files: ProjectFiles;
  activePath: string;
  savedAt: number;
  /** Server `updated_at` (ms) this cache was based on. */
  baseUpdatedAt: number;
  /** True when the cache holds edits not confirmed by the server yet. */
  dirty: boolean;
}

interface StoredProjectV2 {
  version: 2;
  files: ProjectFiles;
  activePath?: string;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

function pickColor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COLORS[sum % COLORS.length];
}

function cleanPath(path: string) {
  return path
    .trim()
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._/-]/g, "")
    .replace(/\/+/g, "/");
}

function sortFiles(files: ProjectFiles) {
  const score = (path: string) => {
    const p = path.toLowerCase();
    if (p === "index.html") return 0;
    if (p.endsWith(".html")) return 1;
    if (p === "styles.css" || p === "style.css") return 2;
    if (p.endsWith(".css")) return 3;
    if (p.endsWith(".json")) return 4;
    if (p.endsWith(".js") || p.endsWith(".mjs")) return 5;
    return 6;
  };
  return Object.keys(files).sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

function fileKind(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "html";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "js";
  if (p.endsWith(".json")) return "json";
  return "text";
}

function languageLabel(path: string) {
  const kind = fileKind(path);
  if (kind === "html") return "HTML";
  if (kind === "css") return "CSS";
  if (kind === "js") return "JavaScript";
  if (kind === "json") return "JSON";
  return "Texto";
}

function isValidFiles(value: unknown): value is ProjectFiles {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length > 0 &&
    Object.entries(value as Record<string, unknown>).every(
      ([path, content]) => cleanPath(path) === path && typeof content === "string",
    )
  );
}

function normalizeFiles(files: ProjectFiles) {
  const normalized: ProjectFiles = {};
  for (const [path, content] of Object.entries(files)) {
    const nextPath = cleanPath(path);
    if (nextPath) normalized[nextPath] = content;
  }
  return Object.keys(normalized).length > 0 ? normalized : { ...DEFAULT_PROJECT };
}

function parseStoredContent(raw: string | null | undefined): ProjectFiles {
  if (!raw) return { ...DEFAULT_PROJECT };

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProjectV2> | ProjectFiles;
    if ("version" in parsed && parsed.version === 2 && isValidFiles(parsed.files)) {
      return normalizeFiles(parsed.files);
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Record<string, unknown>).html === "string" &&
      typeof (parsed as Record<string, unknown>).css === "string" &&
      typeof (parsed as Record<string, unknown>).js === "string"
    ) {
      const old = parsed as { html: string; css: string; js: string };
      return normalizeFiles({
        "index.html": old.html,
        "styles.css": old.css,
        "script.js": old.js,
      });
    }
    if (isValidFiles(parsed)) return normalizeFiles(parsed);
  } catch {
    // Legacy plain text room content.
  }

  const trimmed = raw.trim().toLowerCase();
  const looksHtml =
    trimmed.startsWith("<") ||
    /^<!doctype\shtml/.test(trimmed) ||
    /<html|<head|<body|<div|<h[1-6]|<script|<style/i.test(trimmed.slice(0, 400));
  if (looksHtml) return normalizeFiles({ ...DEFAULT_PROJECT, "index.html": raw });
  return normalizeFiles({ ...DEFAULT_PROJECT, "script.js": raw });
}

function serializeProject(files: ProjectFiles, activePath: string) {
  return JSON.stringify({ version: 2, files: normalizeFiles(files), activePath } satisfies StoredProjectV2);
}

function filesSignature(files: ProjectFiles) {
  const normalized = normalizeFiles(files);
  return JSON.stringify(
    Object.fromEntries(sortFiles(normalized).map((path) => [path, normalized[path]])),
  );
}

const DEFAULT_PROJECT_SIGNATURE = filesSignature(DEFAULT_PROJECT);

function isDefaultProject(files: ProjectFiles) {
  return filesSignature(files) === DEFAULT_PROJECT_SIGNATURE;
}

function getDraftKey(code: string) {
  return `codice:room:${code}:draft:v2`;
}

function readDraftCache(code: string): RoomDraftCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getDraftKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomDraftCache>;
    if (
      parsed &&
      typeof parsed.savedAt === "number" &&
      typeof parsed.activePath === "string" &&
      isValidFiles(parsed.files)
    ) {
      return {
        files: normalizeFiles(parsed.files),
        activePath: parsed.activePath,
        savedAt: parsed.savedAt,
        // Server timestamp the cache is based on. Comparing SERVER timestamps
        // (instead of local Date.now vs server time) makes reload-restore
        // immune to clock skew — the main cause of "code reverted to default".
        baseUpdatedAt: typeof parsed.baseUpdatedAt === "number" ? parsed.baseUpdatedAt : 0,
        dirty: parsed.dirty !== false,
      };
    }
  } catch {
    // Ignore malformed cache.
  }
  return null;
}

function writeDraftCache(
  code: string,
  files: ProjectFiles,
  activePath: string,
  meta?: { baseUpdatedAt?: number; dirty?: boolean },
) {
  if (typeof window === "undefined") return;
  try {
    const prev = readDraftCache(code);
    const entry: RoomDraftCache = {
      files: normalizeFiles(files),
      activePath,
      savedAt: Date.now(),
      baseUpdatedAt: meta?.baseUpdatedAt ?? prev?.baseUpdatedAt ?? 0,
      dirty: meta?.dirty ?? true,
    };
    localStorage.setItem(getDraftKey(code), JSON.stringify(entry));
  } catch {
    // Storage may be unavailable in private mode.
  }
}


function getChatKey(code: string) {
  return `codice:room:${code}:chat:v1`;
}

function readChatCache(code: string): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getChatKey(code));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.slice(-200) as ChatMsg[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeChatCache(code: string, chat: ChatMsg[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getChatKey(code), JSON.stringify(chat.slice(-200)));
  } catch {
    /* ignore */
  }
}

const CSS_NAMED_COLORS = new Set([
  "black","white","red","green","blue","yellow","cyan","magenta","gray","grey",
  "orange","purple","pink","brown","lime","navy","teal","olive","maroon","silver",
  "gold","indigo","violet","aqua","fuchsia","coral","salmon","khaki","turquoise",
  "tomato","tan","plum","orchid","crimson","chocolate","beige","azure","ivory",
  "lavender","wheat","snow","transparent",
]);

interface ColorHit { raw: string; display: string; index: number; }

function extractColors(css: string): ColorHit[] {
  const hits: ColorHit[] = [];
  const seen = new Set<string>();
  const push = (raw: string, display: string, index: number) => {
    const key = display.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ raw, display, index });
  };
  const hexRe = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(css))) push(m[0], m[0], m.index);
  const fnRe = /(rgba?|hsla?)\s*\([^)]+\)/gi;
  while ((m = fnRe.exec(css))) push(m[0], m[0], m.index);
  const nameRe = /\b([a-zA-Z]+)\b/g;
  while ((m = nameRe.exec(css))) {
    const name = m[1].toLowerCase();
    if (CSS_NAMED_COLORS.has(name)) push(m[1], name, m.index);
  }
  return hits.slice(0, 24);
}


function escapeScript(content: string) {
  return content.replace(/<\/script/gi, "<\\/script");
}

function pathAliases(path: string) {
  const clean = cleanPath(path);
  return new Set([clean, `./${clean}`, `/${clean}`, clean.split("/").pop() || clean]);
}

function resolveLocalFile(files: ProjectFiles, href: string) {
  const stripped = href.split("#")[0]?.split("?")[0] || href;
  const clean = cleanPath(stripped.replace(/^\.\//, ""));
  if (files[clean] !== undefined) return clean;
  const basename = clean.split("/").pop();
  if (!basename) return undefined;
  return Object.keys(files).find((path) => path.split("/").pop() === basename);
}

function jsOrder(path: string) {
  const p = path.toLowerCase();
  if (p === "script.js" || p === "main.js" || p === "index.js" || p === "app.js") return 2;
  return 1;
}

function stripJsComments(src: string) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function stripCommentsForFile(path: string, content: string) {
  const kind = fileKind(path);
  if (kind === "js" || kind === "json") return stripJsComments(content);
  if (kind === "css") return content.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "html") {
    // preserva <!doctype ...>; remove apenas comentários HTML
    let out = "";
    let i = 0;
    while (i < content.length) {
      if (content.startsWith("<!--", i)) {
        const end = content.indexOf("-->", i + 4);
        if (end === -1) break;
        i = end + 3;
        continue;
      }
      out += content[i++];
    }
    // remove comentários dentro de <style> e <script> inline
    out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${css.replace(/\/\*[\s\S]*?\*\//g, "")}</style>`);
    out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, js) => `<script${attrs}>${stripJsComments(js)}</script>`);
    return out;
  }
  return content;
}

function stripCommentsFromFiles(files: ProjectFiles): ProjectFiles {
  const out: ProjectFiles = {};
  for (const [path, content] of Object.entries(files)) out[path] = stripCommentsForFile(path, content);
  return out;
}

function buildPreviewHtml(filesInput: ProjectFiles) {
  const files = stripCommentsFromFiles(normalizeFiles(filesInput));
  const htmlPath = files["index.html"] !== undefined
    ? "index.html"
    : Object.keys(files).find((path) => fileKind(path) === "html");
  let html = htmlPath
    ? files[htmlPath]
    : `<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>`;

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8" /></head><body>${html}</body></html>`;
  }

  const used = new Set<string>(htmlPath ? [htmlPath] : []);
  const cssFiles = Object.keys(files).filter((path) => fileKind(path) === "css");
  const jsFiles = Object.keys(files).filter((path) => fileKind(path) === "js").sort((a, b) => jsOrder(a) - jsOrder(b) || a.localeCompare(b));

  const moduleMapEntries = jsFiles.flatMap((path) => {
    const encoded = `data:text/javascript;charset=utf-8,${encodeURIComponent(files[path])}`;
    return [...pathAliases(path)].map((alias) => [alias, encoded] as const);
  });
  const importMap = moduleMapEntries.length
    ? `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries(moduleMapEntries) })}<\/script>`
    : "";

  const consoleBridge = `<script>(function(){
  function s(v){if(v===undefined)return 'undefined';if(v===null)return 'null';if(typeof v==='string')return v;if(typeof v==='function')return v.toString();try{return JSON.stringify(v,function(k,val){if(typeof val==='function')return '[Function]';return val;},2);}catch(e){return String(v);}}
  var o={log:console.log,error:console.error,warn:console.warn,info:console.info};
  ['log','error','warn','info'].forEach(function(l){console[l]=function(){var p=[];for(var i=0;i<arguments.length;i++)p.push(s(arguments[i]));parent.postMessage({__codelive:true,type:'log',level:l,parts:p},'*');try{o[l].apply(console,arguments);}catch(e){}};});
  window.addEventListener('error',function(e){parent.postMessage({__codelive:true,type:'log',level:'error',parts:[String(e.message)+' (linha '+e.lineno+')']},'*');});
  window.addEventListener('unhandledrejection',function(e){parent.postMessage({__codelive:true,type:'log',level:'error',parts:[String(e.reason && e.reason.stack || e.reason)]},'*');});
})();<\/script>`;

  html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (full, before: string, href: string, after: string) => {
    if (!/rel=["'][^"']*stylesheet/i.test(`${before} ${after}`)) return full;
    const local = resolveLocalFile(files, href);
    if (!local || fileKind(local) !== "css") return full;
    used.add(local);
    return `<style data-codelive-file="${local}">\n${files[local]}\n</style>`;
  });

  html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)><\/script>/gi, (full, before: string, src: string, after: string) => {
    const local = resolveLocalFile(files, src);
    if (!local || fileKind(local) !== "js") return full;
    used.add(local);
    const attrs = `${before} ${after}`;
    const isModule = /type=["']module["']/i.test(attrs) || /\bimport\s.+from\s+["']|\bexport\s/m.test(files[local]);
    if (isModule) {
      const encoded = `data:text/javascript;charset=utf-8,${encodeURIComponent(files[local])}`;
      return `<script type="module" src="${encoded}" data-codelive-file="${local}"><\/script>`;
    }
    return `<script data-codelive-file="${local}">\ntry {\n${escapeScript(files[local])}\n} catch (e) { console.error(e && e.stack || e); }\n<\/script>`;
  });

  const extraCss = cssFiles
    .filter((path) => !used.has(path))
    .map((path) => `<style data-codelive-file="${path}">\n${files[path]}\n</style>`)
    .join("\n");
  const extraJs = jsFiles
    .filter((path) => !used.has(path))
    .map((path) => {
      const isModule = /\bimport\s.+from\s+["']|\bexport\s/m.test(files[path]);
      if (isModule) {
        const encoded = `data:text/javascript;charset=utf-8,${encodeURIComponent(files[path])}`;
        return `<script type="module" src="${encoded}" data-codelive-file="${path}"><\/script>`;
      }
      return `<script data-codelive-file="${path}">\ntry {\n${escapeScript(files[path])}\n} catch (e) { console.error(e && e.stack || e); }\n<\/script>`;
    })
    .join("\n");

  const headInjection = `${consoleBridge}${importMap}${extraCss}`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `${headInjection}</head>`);
  } else {
    html = html.replace(/<html[^>]*>/i, (match) => `${match}<head>${headInjection}</head>`);
  }

  if (/<\/body>/i.test(html)) {
    html = html.replace(/<\/body>/i, `${extraJs}</body>`);
  } else {
    html += extraJs;
  }

  return html;
}

function RoomPage() {
  const { code: rawCode } = useParams({ from: "/room/$code" });
  const code = rawCode.toUpperCase();
  const [files, setFiles] = useState<ProjectFiles>({});
  const [activePath, setActivePath] = useState("index.html");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<OutputTab>("preview");
  const [previewSrcDoc, setPreviewSrcDoc] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<
    { level: "log" | "error" | "warn" | "info"; parts: string[]; at: number }[]
  >([]);
  const [sidePanel, setSidePanel] = useState<SidePanel>("none");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [unreadChat, setUnreadChat] = useState(0);
  const [addingFile, setAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [editing, setEditing] = useState<Record<string, EditingInfo>>({});
  // Layout prefs start with SSR-safe defaults and are hydrated in an effect —
  // reading localStorage/matchMedia during render caused hydration mismatches
  // that made React drop client state (and the code look "reset").
  const [outputWidth, setOutputWidth] = useState(560);
  const [asideWidth, setAsideWidth] = useState(320);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const layoutHydrated = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    try {
      const o = Number(localStorage.getItem("codice:layout:output"));
      if (Number.isFinite(o) && o >= 240) setOutputWidth(o);
      const a = Number(localStorage.getItem("codice:layout:aside"));
      if (Number.isFinite(a) && a >= 240) setAsideWidth(a);
    } catch {
      /* ignore */
    }
    layoutHydrated.current = true;
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!layoutHydrated.current) return;
    try { localStorage.setItem("codice:layout:output", String(outputWidth)); } catch {}
  }, [outputWidth]);
  useEffect(() => {
    if (!layoutHydrated.current) return;
    try { localStorage.setItem("codice:layout:aside", String(asideWidth)); } catch {}
  }, [asideWidth]);

  const startResize = useCallback((getCurrent: () => number, setter: (n: number) => void, min: number, max: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = getCurrent();
    const onMove = (ev: PointerEvent) => {
      // dragging left => grow (panel is on the right side of the handle)
      const delta = startX - ev.clientX;
      const next = Math.min(max, Math.max(min, start + delta));
      setter(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const me = useMemo<Participant>(() => {
    const id = randomId();
    const name =
      (typeof window !== "undefined" && (sessionStorage.getItem("codice:name") || sessionStorage.getItem("codelive:name"))) ||
      "Convidado";
    return { id, name, color: pickColor(id) };
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef<ProjectFiles>({});
  const activePathRef = useRef("index.html");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const lastSavedPayloadRef = useRef("");
  const loadedRef = useRef(false);
  const dirtyRef = useRef(false);
  const lastEditingSentAtRef = useRef(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const editingCleanupRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteUpdatedAtRef = useRef(0);
  const loadOnceRef = useRef<string | null>(null);

  const orderedPaths = useMemo(() => sortFiles(files), [files]);
  const currentValue = files[activePath] ?? "";
  const lineCount = currentValue ? currentValue.split("\n").length : 1;
  const errorCount = diagnostics?.length ?? 0;


  // Restore chat history after hydration (localStorage during render breaks SSR).
  const chatHydrated = useRef(false);
  useEffect(() => {
    const cached = readChatCache(code);
    if (cached.length > 0) setChat(cached);
    chatHydrated.current = true;
  }, [code]);

  useEffect(() => {
    if (!chatHydrated.current) return;
    writeChatCache(code, chat);
  }, [code, chat]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    activePathRef.current = activePath;
  }, [activePath]);

  const saveProject = useCallback(
    async (nextFiles: ProjectFiles, nextActivePath = activePathRef.current) => {
      const normalized = normalizeFiles(nextFiles);
      const payload = serializeProject(normalized, nextActivePath);
      if (payload === lastSavedPayloadRef.current) {
        dirtyRef.current = false;
        setSaveState("saved");
        return true;
      }

      setSaveState("saving");
      setSaveError(null);
      const { data, error } = await supabase
        .from("rooms")
        .upsert(
          {
            code,
            content: payload,
            language: "web",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "code" },
        )
        .select("updated_at")
        .maybeSingle();

      if (error || !data) {
        const message = error?.message || "A sala não confirmou o salvamento.";
        setSaveState("error");
        setSaveError(message);
        console.error("Não foi possível salvar a sala", message);
        // Keep the local cache authoritative so a reload restores these edits.
        writeDraftCache(code, normalized, nextActivePath, { dirty: true });
        return false;
      }

      lastSavedPayloadRef.current = payload;
      dirtyRef.current = false;
      const confirmedAt = data.updated_at ? new Date(data.updated_at).getTime() : Date.now();
      remoteUpdatedAtRef.current = confirmedAt;
      writeDraftCache(code, normalized, nextActivePath, {
        baseUpdatedAt: confirmedAt,
        dirty: false,
      });
      setSaveState("saved");
      return true;
    },
    [code],
  );

  const schedulePersist = useCallback(
    (nextFiles: ProjectFiles, nextActivePath = activePathRef.current) => {
      const normalized = normalizeFiles(nextFiles);
      filesRef.current = normalized;
      activePathRef.current = nextActivePath;
      dirtyRef.current = true;
      writeDraftCache(code, normalized, nextActivePath, { dirty: true });
      setSaveState("saving");
      if (persistTimer.current) clearTimeout(persistTimer.current);
      // Debounce DB writes: with 30+ users typing, saving on every keystroke
      // would hammer the backend. 800ms gives smooth UX and cuts writes ~40x.
      persistTimer.current = setTimeout(() => {
        persistTimer.current = null;
        void saveProject(filesRef.current, activePathRef.current);
      }, 800);
    },
    [code, saveProject],
  );

  const updateLocalFilesFromRemote = useCallback(
    (mutator: (prev: ProjectFiles) => { next: ProjectFiles; nextActive?: string }) => {
      // Remote patches update local state + cache only — the ORIGINATING peer
      // is responsible for persisting to the DB. This prevents every user from
      // firing a save on every remote keystroke (N² writes with N users).
      setFiles((prev) => {
        const { next, nextActive } = mutator(prev);
        const normalized = normalizeFiles(next);
        filesRef.current = normalized;
        if (nextActive) {
          activePathRef.current = nextActive;
          setActivePath(nextActive);
        }
        writeDraftCache(code, normalized, activePathRef.current, { dirty: true });
        return normalized;
      });
    },
    [code],
  );

  const persistNow = useCallback(() => {
    if (!loadedRef.current || !dirtyRef.current) return;
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    writeDraftCache(code, filesRef.current, activePathRef.current, { dirty: true });
    void saveProject(filesRef.current, activePathRef.current);
  }, [code, saveProject]);

  // Fire-and-forget save that survives page unload (normal fetch is aborted).
  const persistBeacon = useCallback(() => {
    if (!loadedRef.current || !dirtyRef.current) return;
    const payload = serializeProject(filesRef.current, activePathRef.current);
    if (payload === lastSavedPayloadRef.current) return;
    writeDraftCache(code, filesRef.current, activePathRef.current, { dirty: true });
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;
    try {
      void fetch(`${url}/rest/v1/rooms?on_conflict=code`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          code,
          content: payload,
          language: "web",
          updated_at: new Date().toISOString(),
        }),
      });
    } catch {
      /* best effort */
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    // Guard: this effect must run exactly once per room code. Re-running it
    // would overwrite in-progress edits with the last server snapshot.
    if (loadOnceRef.current === code) return;
    loadOnceRef.current = code;

    (async () => {
      try {
        const { data, error } = await supabase
          .from("rooms")
          .select("content, updated_at")
          .eq("code", code)
          .maybeSingle();

        const hasRemoteRow = !error && !!data?.content;
        const remoteFiles = parseStoredContent(hasRemoteRow ? data.content : null);
        const remoteUpdatedAt = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
        remoteUpdatedAtRef.current = remoteUpdatedAt;
        const cached = readDraftCache(code);

        const remoteIsDefault = isDefaultProject(remoteFiles);
        const cacheIsDefault = cached ? isDefaultProject(cached.files) : false;
        const remoteHasRealProject = hasRemoteRow && !remoteIsDefault;
        // Prefer local cache only when the server has nothing newer than the
        // server snapshot that cache was based on. A stale dirty cache containing
        // the starter project must never override a real saved project — that was
        // what made index.html appear to "go back to the padrão" after reload.
        const shouldUseCache =
          !!cached &&
          !(remoteHasRealProject && cacheIsDefault) &&
          (!!error ||
            !hasRemoteRow ||
            cached.baseUpdatedAt >= remoteUpdatedAt ||
            (cached.dirty &&
              cached.baseUpdatedAt === 0 &&
              (cached.savedAt >= remoteUpdatedAt || (remoteIsDefault && !cacheIsDefault))));

        const initialFiles = shouldUseCache && cached ? cached.files : remoteFiles;
        const initialActivePath =
          shouldUseCache && cached && initialFiles[cached.activePath] !== undefined
            ? cached.activePath
            : initialFiles["index.html"] !== undefined
              ? "index.html"
              : sortFiles(initialFiles)[0];

        if (cancelled) return;

        setFiles(initialFiles);
        setActivePath(initialActivePath);
        filesRef.current = initialFiles;
        activePathRef.current = initialActivePath;
        const initialPayload = serializeProject(initialFiles, initialActivePath);
        const remotePayload = hasRemoteRow ? serializeProject(remoteFiles, initialActivePath) : "";
        const needsSave = initialPayload !== remotePayload;
        lastSavedPayloadRef.current = needsSave ? "" : initialPayload;
        writeDraftCache(code, initialFiles, initialActivePath, {
          baseUpdatedAt: remoteUpdatedAt,
          dirty: needsSave,
        });
        try {
          setPreviewSrcDoc(buildPreviewHtml(initialFiles));
        } catch (previewError) {
          console.error("Não foi possível preparar o preview inicial", previewError);
          setPreviewSrcDoc("");
        }
        setLoaded(true);
        loadedRef.current = true;
        setSaveState(needsSave ? "saving" : "saved");
        if (needsSave) {
          dirtyRef.current = true;
          void saveProject(initialFiles, initialActivePath);
        } else {
          dirtyRef.current = false;
        }
      } catch (loadError) {
        console.error("Não foi possível carregar a sala", loadError);
        if (cancelled) return;
        const cached = readDraftCache(code);
        const fallbackFiles = cached?.files ?? { ...DEFAULT_PROJECT };
        const fallbackActivePath = cached && fallbackFiles[cached.activePath] !== undefined
          ? cached.activePath
          : fallbackFiles["index.html"] !== undefined
            ? "index.html"
            : sortFiles(fallbackFiles)[0];
        setFiles(fallbackFiles);
        setActivePath(fallbackActivePath);
        filesRef.current = fallbackFiles;
        activePathRef.current = fallbackActivePath;
        setLoaded(true);
        loadedRef.current = true;
        dirtyRef.current = true;
        setSaveState("error");
        setSaveError("Não consegui confirmar o código salvo agora, mas mantive o rascunho local aberto.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, saveProject]);


  useEffect(() => {
    const onUnload = () => persistBeacon();
    const onHidden = () => {
      if (document.visibilityState === "hidden") persistBeacon();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      document.removeEventListener("visibilitychange", onHidden);
      persistNow();
    };
  }, [persistNow, persistBeacon]);

  useEffect(() => {
    if (!loaded) return;
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Participant>();
        const list: Participant[] = [];
        const alive = new Set<string>();
        Object.values(state).forEach((entries) => {
          entries.forEach((entry) => {
            const p = entry as Participant;
            list.push(p);
            alive.add(p.id);
          });
        });
        setParticipants(list);
        // Drop editing indicators for users who left the room.
        setEditing((prev) => {
          const next: Record<string, EditingInfo> = {};
          for (const [id, info] of Object.entries(prev)) if (alive.has(id)) next[id] = info;
          return next;
        });
      })
      .on("broadcast", { event: "file_patch" }, (payload) => {
        const p = payload.payload as
          | { path?: string; content?: string; deleted?: boolean; from?: string }
          | undefined;
        if (!p || p.from === me.id || !p.path) return;
        const path = cleanPath(p.path);
        if (!path) return;
        updateLocalFilesFromRemote((prev) => {
          const next = { ...prev };
          if (p.deleted) delete next[path];
          else next[path] = typeof p.content === "string" ? p.content : "";
          const normalized = normalizeFiles(next);
          const nextActive =
            p.deleted && activePathRef.current === path
              ? sortFiles(normalized)[0]
              : undefined;
          return { next: normalized, nextActive };
        });
      })
      .on("broadcast", { event: "editing" }, (payload) => {
        const p = payload.payload as { from?: string; name?: string; color?: string; path?: string } | undefined;
        if (!p || !p.from || p.from === me.id || !p.path) return;
        setEditing((prev) => ({
          ...prev,
          [p.from!]: { name: p.name || "Alguém", color: p.color || "#3b82f6", path: p.path!, at: Date.now() },
        }));
      })
      .on("broadcast", { event: "chat" }, (payload) => {
        const msg = payload.payload as ChatMsg;
        setChat((prev) => [...prev, msg].slice(-200));
        setSidePanel((cur) => {
          if (cur !== "chat") setUnreadChat((u) => u + 1);
          return cur;
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track(me);
      });

    channelRef.current = channel;
    // Expire editing indicators that haven't refreshed in 4s.
    editingCleanupRef.current = setInterval(() => {
      const cutoff = Date.now() - 4000;
      setEditing((prev) => {
        let changed = false;
        const next: Record<string, EditingInfo> = {};
        for (const [id, info] of Object.entries(prev)) {
          if (info.at >= cutoff) next[id] = info;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      if (editingCleanupRef.current) clearInterval(editingCleanupRef.current);
      editingCleanupRef.current = null;
    };
  }, [loaded, code, me, updateLocalFilesFromRemote]);


  useEffect(() => {
    if (sidePanel === "chat" && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    if (sidePanel === "chat") setUnreadChat(0);
  }, [chat, sidePanel]);

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.__codelive !== true || data.type !== "log") return;
      setConsoleEntries((prev) =>
        [
          ...prev,
          {
            level: data.level,
            parts: data.parts || [],
            at: Date.now(),
          },
        ].slice(-150),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function broadcastPatch(path: string, content: string, deleted = false) {
    channelRef.current?.send({
      type: "broadcast",
      event: "file_patch",
      payload: { path, content, deleted, from: me.id, activePath: activePathRef.current },
    });
  }

  function broadcastEditing(path: string) {
    // Throttle to at most 1 msg / 1.2s per user: 30 students typing = ~25 msgs/s
    // per room instead of 300+.
    const now = Date.now();
    if (now - lastEditingSentAtRef.current < 1200) return;
    lastEditingSentAtRef.current = now;
    channelRef.current?.send({
      type: "broadcast",
      event: "editing",
      payload: { from: me.id, name: me.name, color: me.color, path },
    });
  }

  function updateFile(path: string, value: string) {
    if (!loadedRef.current) return;
    setFiles((prev) => {
      if (prev[path] === value) return prev;
      const next = normalizeFiles({ ...prev, [path]: value });
      schedulePersist(next, activePathRef.current);
      broadcastPatch(path, value);
      broadcastEditing(path);
      return next;
    });
  }


  function createFile(name: string) {
    if (!loadedRef.current) return;
    const path = cleanPath(name);
    if (!path) return;
    if (files[path] !== undefined) {
      setActivePath(path);
      setAddingFile(false);
      setNewFileName("");
      return;
    }
    const starter =
      fileKind(path) === "html"
        ? "<section>\n  \n</section>"
        : fileKind(path) === "css"
          ? "/* estilos */\n"
          : fileKind(path) === "js"
            ? "// JavaScript\n"
            : "";
    const next = normalizeFiles({ ...filesRef.current, [path]: starter });
    setFiles(next);
    setActivePath(path);
    setAddingFile(false);
    setNewFileName("");
    schedulePersist(next, path);
    broadcastPatch(path, starter);
  }

  function submitNewFile(e: FormEvent) {
    e.preventDefault();
    createFile(newFileName);
  }

  function deleteActiveFile() {
    if (!loadedRef.current) return;
    if (orderedPaths.length <= 1) return;
    if (!window.confirm(`Excluir ${activePath}?`)) return;
    const next = { ...filesRef.current };
    delete next[activePath];
    const normalized = normalizeFiles(next);
    const nextActive = sortFiles(normalized)[0];
    setFiles(normalized);
    setActivePath(nextActive);
    schedulePersist(normalized, nextActive);
    broadcastPatch(activePath, "", true);
  }

  async function exportProjectZip() {
    const current = filesRef.current;
    const zip = new JSZip();
    for (const [path, content] of Object.entries(current)) {
      zip.file(path, content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codice-sala-${code}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (!loadedRef.current) return;
    const incoming: ProjectFiles = {};
    for (const file of Array.from(fileList)) {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.values(zip.files).filter((e) => !e.dir);
          for (const entry of entries) {
            const text = await entry.async("string");
            const path = cleanPath(entry.name.replace(/^\/+/, ""));
            if (path) incoming[path] = text;
          }
        } catch (e) {
          window.alert(`Não foi possível ler o zip "${file.name}": ${(e as Error).message}`);
        }
      } else {
        const text = await file.text();
        const path = cleanPath(file.name);
        if (path) incoming[path] = text;
      }
    }
    const incomingPaths = Object.keys(incoming);
    if (incomingPaths.length === 0) return;

    const overlap = incomingPaths.filter((p) => filesRef.current[p] !== undefined);
    if (overlap.length > 0) {
      const ok = window.confirm(
        `Isso vai sobrescrever ${overlap.length} arquivo(s) existente(s):\n\n${overlap.join("\n")}\n\nContinuar?`,
      );
      if (!ok) return;
    }

    const merged = normalizeFiles({ ...filesRef.current, ...incoming });
    const nextActive =
      merged["index.html"] !== undefined ? "index.html" : sortFiles(merged)[0] || activePathRef.current;
    setFiles(merged);
    setActivePath(nextActive);
    schedulePersist(merged, nextActive);
    for (const path of incomingPaths) {
      broadcastPatch(path, merged[path]);
    }
  }


  function runRuntimeDiagnostics(project: ProjectFiles) {
    return new Promise<Diagnostic[]>((resolve) => {
      const found: Diagnostic[] = [];
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts allow-forms");
      iframe.style.position = "fixed";
      iframe.style.left = "-9999px";
      iframe.style.top = "0";
      iframe.style.width = "1px";
      iframe.style.height = "1px";
      iframe.style.opacity = "0";

      const onMessage = (ev: MessageEvent) => {
        const data = ev.data;
        if (!data || data.__codelive !== true || data.type !== "log" || data.level !== "error") return;
        const message = Array.isArray(data.parts) ? data.parts.join(" ") : String(data.parts || "Erro em tempo de execução");
        if (found.some((diag) => diag.message === message)) return;
        found.push({
          file: "preview",
          message,
          hint: runtimeHint(message),
        });
      };

      const finish = () => {
        window.removeEventListener("message", onMessage);
        iframe.remove();
        resolve(found);
      };

      window.addEventListener("message", onMessage);
      document.body.appendChild(iframe);
      iframe.srcdoc = buildPreviewHtml(project);
      window.setTimeout(finish, 700);
    });
  }

  function validateProject(projectInput: ProjectFiles): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const project = stripCommentsFromFiles(projectInput);

    for (const [path, content] of Object.entries(project)) {
      const kind = fileKind(path);

      if (kind === "js" && content.trim()) {
        try {
          if (/\bimport\s.+from\s+["']|\bexport\s/m.test(content)) {
            const blob = new Blob([content], { type: "text/javascript" });
            URL.createObjectURL(blob);
          } else {
            // eslint-disable-next-line no-new-func
            new Function(content);
          }
        } catch (e) {
          const err = e as Error;
          const lineMatch = /line\s*(\d+)|:(\d+):\d+/i.exec(err.stack || "");
          diags.push({
            file: path,
            line: lineMatch ? Number(lineMatch[1] || lineMatch[2]) : undefined,
            message: err.message,
            hint: suggestJsFix(err.message),
          });
        }
      }

      if (kind === "json" && content.trim()) {
        try {
          JSON.parse(content);
        } catch (e) {
          diags.push({ file: path, message: (e as Error).message, hint: "Revise vírgulas, aspas e chaves do JSON." });
        }
      }

      if (kind === "html" && content.trim()) {
        const openTags: { name: string; line: number }[] = [];
        const voidTags = new Set([
          "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
        ]);
        const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
        const lines = content.split("\n");
        const offsetToLine = (idx: number) => {
          let acc = 0;
          for (let i = 0; i < lines.length; i++) {
            acc += lines[i].length + 1;
            if (idx < acc) return i + 1;
          }
          return lines.length;
        };
        let m: RegExpExecArray | null;
        while ((m = tagRe.exec(content))) {
          const raw = m[0];
          const name = m[1].toLowerCase();
          if (raw.startsWith("<!") || raw.startsWith("<!--")) continue;
          const line = offsetToLine(m.index);
          if (raw.startsWith("</")) {
            const last = openTags.pop();
            if (!last || last.name !== name) {
              diags.push({
                file: path,
                line,
                message: `Tag de fechamento inesperada </${name}>${last ? ` — esperava </${last.name}>` : ""}`,
                hint: last ? `Feche primeiro a tag <${last.name}> aberta na linha ${last.line}.` : "Remova esta tag ou abra a correspondente antes.",
              });
            }
          } else if (!voidTags.has(name) && !raw.endsWith("/>")) {
            openTags.push({ name, line });
          }
        }
        for (const tag of openTags) {
          diags.push({ file: path, line: tag.line, message: `Tag <${tag.name}> não foi fechada`, hint: `Adicione </${tag.name}> no local apropriado.` });
        }
      }

      if (kind === "css" && content.trim()) {
        let depth = 0;
        let line = 1;
        for (let i = 0; i < content.length; i++) {
          const char = content[i];
          if (char === "\n") line++;
          else if (char === "{") depth++;
          else if (char === "}") {
            depth--;
            if (depth < 0) {
              diags.push({ file: path, line, message: "Chave '}' sem '{' correspondente", hint: "Remova esta '}' ou adicione uma '{' antes." });
              depth = 0;
            }
          }
        }
        if (depth > 0) {
          diags.push({ file: path, message: `${depth} chave(s) '{' não fechada(s)`, hint: "Adicione '}' correspondente(s) no fim das regras." });
        }
      }
    }

    return diags;
  }

  async function runValidate() {
    if (!loadedRef.current) return;
    setRunning(true);
    const syntaxDiags = validateProject(filesRef.current);
    const runtimeDiags = await runRuntimeDiagnostics(filesRef.current);
    const diags = [...syntaxDiags, ...runtimeDiags];
    setDiagnostics(diags);
    setActiveTab("validate");
    setRunning(false);
  }

  function refreshPreview() {
    if (!loadedRef.current) return;
    setConsoleEntries([]);
    setPreviewSrcDoc(buildPreviewHtml(filesRef.current));
    setActiveTab("preview");
  }

  function copyLink() {
    const url = `${window.location.origin}/room/${code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function sendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;
    const msg: ChatMsg = {
      id: randomId(),
      authorId: me.id,
      authorName: me.name,
      authorColor: me.color,
      text,
      at: Date.now(),
    };
    setChat((prev) => [...prev, msg].slice(-200));
    channelRef.current?.send({ type: "broadcast", event: "chat", payload: msg });
    setChatDraft("");
  }

  const saveText = saveState === "saving" ? "Salvando" : saveState === "error" ? "Erro ao salvar" : "Salvo";
  const editingList = useMemo(
    () => Object.entries(editing).map(([id, info]) => ({ id, ...info })),
    [editing],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-xs text-muted-foreground">Sala</div>
            <div className="font-mono text-sm font-semibold tracking-wider">{code}</div>
          </div>
          <button onClick={copyLink} className="ml-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copiado!" : "Copiar convite"}
          </button>
          <div className={`hidden items-center gap-1 rounded-md border px-2 py-1 text-xs sm:inline-flex ${saveState === "error" ? "text-destructive" : "text-muted-foreground"}`} title={saveError || undefined}>
            <Save className="h-3.5 w-3.5" />
            {saveText}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setSidePanel((p) => (p === "people" ? "none" : "people"))} className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent ${sidePanel === "people" ? "bg-accent" : ""}`}>
            <Users className="h-4 w-4" />
            <div className="flex -space-x-2">
              {participants.slice(0, 4).map((p) => (
                <div key={p.id} title={p.name} className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-[9px] font-semibold text-primary-foreground" style={{ backgroundColor: p.color }}>
                  {p.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <span>{participants.length}</span>
          </button>

          <button onClick={() => { setSidePanel((p) => (p === "chat" ? "none" : "chat")); setUnreadChat(0); }} className={`relative inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent ${sidePanel === "chat" ? "bg-accent" : ""}`}>
            <MessageSquare className="h-4 w-4" />
            Chat
            {unreadChat > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{unreadChat}</span>}
          </button>

          <button onClick={runValidate} disabled={running || !loaded} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60">
            <CheckCircle2 className="h-4 w-4" />
            Executar
          </button>

          <button onClick={refreshPreview} disabled={!loaded} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            <Play className="h-4 w-4" />
            Preview
          </button>

          <PalettePicker />
          <ThemeToggle />
        </div>
      </header>

      {editingList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs">
          <Pencil className="h-3 w-3 text-muted-foreground" />
          {editingList.map((info) => (
            <span key={info.id} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: info.color }} />
              <strong className="font-medium">{info.name}</strong>
              <span className="text-muted-foreground">está editando</span>
              <code className="font-mono text-[11px]">{info.path}</code>
            </span>
          ))}
        </div>
      )}

      <main className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">

        <section className="flex min-h-[50vh] flex-1 flex-col border-b lg:min-h-0 lg:min-w-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-0 overflow-x-auto border-b bg-muted/40 text-xs">
            {orderedPaths.map((path) => (
              <button key={path} disabled={!loaded} onClick={() => setActivePath(path)} className={`inline-flex shrink-0 items-center gap-1.5 border-r px-3 py-2 disabled:opacity-60 ${activePath === path ? "bg-background font-medium text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
                <FileCode className="h-3.5 w-3.5" />
                {path}
              </button>
            ))}
            {addingFile ? (
              <form onSubmit={submitNewFile} className="flex shrink-0 items-center gap-1 border-r bg-background px-2 py-1">
                <input
                  autoFocus
                  disabled={!loaded}
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="app.js"
                  className="h-7 w-32 rounded border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="submit" disabled={!loaded} className="rounded border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60">Criar</button>
                <button type="button" onClick={() => { setAddingFile(false); setNewFileName(""); }} className="rounded p-1 hover:bg-accent" aria-label="Cancelar novo arquivo">
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <button onClick={() => setAddingFile(true)} disabled={!loaded} className="inline-flex shrink-0 items-center gap-1.5 border-r px-3 py-2 text-muted-foreground hover:bg-accent disabled:opacity-60">
                <Plus className="h-3.5 w-3.5" />
                Novo arquivo
              </button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2 px-3 py-2 text-muted-foreground">
              <span>{languageLabel(activePath)}</span>
              <span>·</span>
              <span>{lineCount} linhas</span>
              <span className="mx-1 h-4 w-px bg-border" />
              <input
                ref={importInputRef}
                type="file"
                multiple
                accept=".zip,.html,.htm,.css,.js,.mjs,.json,.svg,.md,.txt,.ts,.tsx,.jsx"
                className="hidden"
                onChange={(e) => {
                  void importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => importInputRef.current?.click()}
                disabled={!loaded}
                className="inline-flex items-center gap-1 rounded p-1 hover:bg-accent disabled:opacity-60"
                aria-label="Importar arquivos ou zip"
                title="Importar arquivos ou .zip"
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => void exportProjectZip()}
                disabled={!loaded}
                className="inline-flex items-center gap-1 rounded p-1 hover:bg-accent disabled:opacity-60"
                aria-label="Exportar projeto como .zip"
                title="Exportar projeto como .zip"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              {orderedPaths.length > 1 && (
                <button onClick={deleteActiveFile} disabled={!loaded} className="rounded p-1 hover:bg-accent disabled:opacity-60" aria-label="Excluir arquivo ativo" title="Excluir arquivo ativo">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="relative flex flex-1 overflow-hidden bg-background">
            {loaded ? (
              <CodeEditor
                value={currentValue}
                path={activePath}
                onChange={(v) => updateFile(activePath, v)}
                placeholder={`${languageLabel(activePath)}…`}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">
                Carregando sala…
              </div>
            )}
          </div>

        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar painel de saída"
          onPointerDown={startResize(() => outputWidth, setOutputWidth, 280, 1100)}
          onDoubleClick={() => setOutputWidth(560)}
          className="hidden lg:block w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 transition-colors"
          title="Arraste para redimensionar (duplo clique reseta)"
        />

        <section
          className="flex min-h-[35vh] w-full flex-col bg-card lg:min-h-0 lg:shrink-0"
          style={{ width: isDesktop ? outputWidth : undefined }}
        >
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs">
            <div className="flex items-center gap-1">
              <button onClick={() => setActiveTab("validate")} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${activeTab === "validate" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Executar
                {diagnostics !== null && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${errorCount === 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-destructive/15 text-destructive"}`}>{errorCount === 0 ? "OK" : errorCount}</span>}
              </button>
              <button onClick={() => setActiveTab("preview")} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${activeTab === "preview" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}>
                <Layout className="h-3.5 w-3.5" />
                Preview
              </button>
              <button onClick={() => setActiveTab("console")} className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${activeTab === "console" ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-accent"}`}>
                <Terminal className="h-3.5 w-3.5" />
                Console ({consoleEntries.length})
              </button>
            </div>
            {activeTab === "preview" && <button onClick={refreshPreview} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"><Eye className="h-3 w-3" />Atualizar</button>}
            {activeTab === "console" && consoleEntries.length > 0 && <button onClick={() => setConsoleEntries([])} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"><Trash2 className="h-3 w-3" />Limpar</button>}
          </div>

          <div className="relative flex-1 overflow-hidden">
            {activeTab === "preview" && (
              <iframe title="preview" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" srcDoc={previewSrcDoc} className="h-full w-full border-0 bg-white" />
            )}

            {activeTab === "validate" && (
              <div className="h-full overflow-y-auto p-3 text-xs">
                {diagnostics === null ? (
                  <p className="text-muted-foreground">Clique em <strong>Executar</strong> para verificar erros de HTML, CSS, JavaScript e JSON.</p>
                ) : diagnostics.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div><div className="font-semibold">Tudo certo!</div><div className="mt-0.5 text-xs opacity-90">Nenhum erro de sintaxe encontrado. Use Preview para interagir com o site.</div></div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {diagnostics.map((d, i) => (
                      <div key={`${d.file}-${i}`} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                        <div className="flex items-start gap-2">
                          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-destructive"><span>{d.file}</span>{d.line && <span>· linha {d.line}</span>}</div>
                            <div className="mt-1 font-mono text-xs text-foreground">{d.message}</div>
                            {d.hint && <div className="mt-1.5 text-xs text-muted-foreground"><strong>Como corrigir:</strong> {d.hint}</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "console" && (
              <div className="h-full overflow-y-auto p-3 font-mono text-xs">
                {consoleEntries.length === 0 ? (
                  <p className="text-muted-foreground">Nada no console ainda. Abra o Preview e interaja com a página.</p>
                ) : (
                  consoleEntries.map((entry, i) => (
                    <div key={i} className={`whitespace-pre-wrap border-b border-border/50 py-1 ${entry.level === "error" ? "text-destructive" : entry.level === "warn" ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"}`}>
                      {entry.parts.join(" ")}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        {sidePanel !== "none" && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar painel lateral"
            onPointerDown={startResize(() => asideWidth, setAsideWidth, 260, 640)}
            onDoubleClick={() => setAsideWidth(320)}
            className="hidden lg:block w-1.5 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 transition-colors"
            title="Arraste para redimensionar (duplo clique reseta)"
          />
        )}
        {sidePanel !== "none" && (
          <aside
            className="flex max-h-[70vh] w-full flex-col border-t bg-card lg:h-full lg:max-h-none lg:shrink-0 lg:border-l lg:border-t-0"
            style={{ width: isDesktop ? asideWidth : undefined }}
          >
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
              <span>{sidePanel === "people" ? `Participantes (${participants.length})` : "Chat da sala"}</span>
              <button onClick={() => setSidePanel("none")} className="rounded p-1 hover:bg-accent" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>

            {sidePanel === "people" && (
              <div className="flex-1 overflow-y-auto p-2">
                {participants.length === 0 && <p className="p-2 text-sm text-muted-foreground">Ninguém conectado.</p>}
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground" style={{ backgroundColor: p.color }}>{p.name.charAt(0).toUpperCase()}</div>
                    <div className="flex-1 text-sm">{p.name}{p.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}</div>
                  </div>
                ))}
              </div>
            )}

            {sidePanel === "chat" && (
              <>
                <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
                  {chat.length === 0 && <p className="text-muted-foreground">Nenhuma mensagem ainda. Diga oi!</p>}
                  {chat.map((msg) => (
                    <div key={msg.id} className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-semibold" style={{ color: msg.authorColor }}>{msg.authorName}{msg.authorId === me.id && <span className="ml-1 text-muted-foreground">(você)</span>}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(msg.at).toLocaleTimeString()}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm">{msg.text}</div>
                    </div>
                  ))}
                </div>
                <form onSubmit={sendChat} className="relative flex gap-2 border-t p-2">
                  {emojiOpen && (
                    <div className="absolute bottom-full left-2 right-2 mb-2 grid grid-cols-8 gap-1 rounded-md border bg-popover p-2 shadow-lg z-10">
                      {["😀","😂","😍","🥰","😎","🤔","😅","😢","😡","🥳","😴","🤯","😇","🙃","😉","😌","👍","👎","👏","🙌","🙏","💪","👀","🫶","❤️","🔥","✨","🎉","💯","✅","❌","⚠️","💡","🚀","⭐","🌟","💻","🐛","📌","📝"].map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setChatDraft((d) => d + e); setEmojiOpen(false); }}
                          className="rounded p-1 text-lg hover:bg-accent"
                        >{e}</button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setEmojiOpen((v) => !v)}
                    className="inline-flex items-center rounded-md border px-2 py-1.5 text-sm hover:bg-accent"
                    aria-label="Inserir emoji"
                    title="Inserir emoji"
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                  <input value={chatDraft} onChange={(e) => setChatDraft(e.target.value)} placeholder="Escreva uma mensagem…" className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
                  <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Send className="h-3.5 w-3.5" /></button>
                </form>
              </>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

function suggestJsFix(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("unexpected token")) return "Verifique parênteses, chaves, aspas e ponto-e-vírgula próximos ao erro.";
  if (m.includes("unexpected end of input")) return "Provavelmente falta fechar uma chave '}', parêntese ')' ou aspas.";
  if (m.includes("is not defined")) return "Declare a variável com let/const antes de usar ou confira o nome digitado.";
  if (m.includes("assignment to constant")) return "Você está reatribuindo uma const. Use let se o valor precisa mudar.";
  if (m.includes("missing ) after")) return "Falta um ')' fechando uma chamada de função ou expressão.";
  if (m.includes("invalid or unexpected token")) return "Caractere inválido — verifique aspas, acentos ou símbolos estranhos.";
  return undefined;
}

function runtimeHint(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes("cannot read") || m.includes("null")) {
    return "Confira se o seletor existe no HTML antes de usar no JavaScript, ou execute o script após o elemento aparecer na página.";
  }
  if (m.includes("is not defined")) {
    return "Confira se o arquivo que declara essa variável foi criado e carregado antes do arquivo que a utiliza.";
  }
  if (m.includes("failed to resolve module") || m.includes("import")) {
    return "Use imports com caminho relativo para arquivos existentes, por exemplo ./utils.js.";
  }
  if (m.includes("unexpected token")) {
    return "Há um erro de sintaxe em algum script carregado pelo preview.";
  }
  return "Revise o arquivo indicado no erro e teste novamente no Preview.";
}