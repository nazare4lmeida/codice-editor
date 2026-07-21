import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  FileCode,
  Layout,
  MessageSquare,
  Play,
  Send,
  Terminal,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Sala ${params.code} — CodeLive` },
      {
        name: "description",
        content: "Editor colaborativo ao vivo para aulas.",
      },
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

type FileKey = "html" | "css" | "js";

interface Files {
  html: string;
  css: string;
  js: string;
}

const DEFAULT_FILES: Files = {
  html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1 id="title">Olá turma!</h1>
    <button id="btn">Clique aqui</button>
    <script src="script.js"></script>
  </body>
</html>`,
  css: `body {
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
  js: `document.getElementById('btn').addEventListener('click', () => {
  document.getElementById('title').textContent = 'Você clicou!';
  console.log('Botão clicado');
});`,
};

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

interface Diagnostic {
  file: FileKey;
  line?: number;
  message: string;
  hint?: string;
}

interface RoomDraftCache {
  files: Files;
  savedAt: number;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

function pickColor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COLORS[sum % COLORS.length];
}

function parseStoredContent(raw: string | null | undefined): Files {
  if (!raw) return { ...DEFAULT_FILES };
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.html === "string" &&
      typeof parsed.css === "string" &&
      typeof parsed.js === "string"
    ) {
      return { html: parsed.html, css: parsed.css, js: parsed.js };
    }
  } catch {
    // legacy string content
  }
  // Legacy: single blob of text. Detect html vs js.
  const trimmed = raw.trim().toLowerCase();
  const looksHtml =
    trimmed.startsWith("<") ||
    /^<!doctype\shtml/.test(trimmed) ||
    /<html|<head|<body|<div|<h[1-6]|<script|<style/i.test(trimmed.slice(0, 400));
  if (looksHtml) return { html: raw, css: "", js: "" };
  return { html: DEFAULT_FILES.html, css: DEFAULT_FILES.css, js: raw };
}

function getDraftKey(code: string) {
  return `codelive:room:${code}:draft`;
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
      parsed.files &&
      typeof parsed.files.html === "string" &&
      typeof parsed.files.css === "string" &&
      typeof parsed.files.js === "string"
    ) {
      return { files: parsed.files, savedAt: parsed.savedAt };
    }
  } catch {
    // Ignore malformed local draft data.
  }
  return null;
}

function writeDraftCache(code: string, files: Files) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getDraftKey(code),
      JSON.stringify({ files, savedAt: Date.now() } satisfies RoomDraftCache),
    );
  } catch {
    // Storage can fail in private mode or when quota is exceeded.
  }
}

function RoomPage() {
  const { code } = useParams({ from: "/room/$code" });
  const [files, setFiles] = useState<Files>(DEFAULT_FILES);
  const [activeFile, setActiveFile] = useState<FileKey>("html");
  const [loaded, setLoaded] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"validate" | "preview" | "console">(
    "preview",
  );
  const [previewSrcDoc, setPreviewSrcDoc] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null);
  const [consoleEntries, setConsoleEntries] = useState<
    { level: "log" | "error" | "warn" | "info"; parts: string[]; at: number }[]
  >([]);
  const [sidePanel, setSidePanel] = useState<"none" | "people" | "chat">("none");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [unreadChat, setUnreadChat] = useState(0);

  const me = useMemo<Participant>(() => {
    const id = randomId();
    const name =
      (typeof window !== "undefined" &&
        sessionStorage.getItem("codelive:name")) ||
      "Convidado";
    return { id, name, color: pickColor(id) };
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const previewRef = useRef<HTMLIFrameElement | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef<Files>(DEFAULT_FILES);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Keep a ref of files for flush-on-unmount / beforeunload persistence.
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const persistFiles = useCallback(
    async (f: Files) => {
      const { error } = await supabase
        .from("rooms")
        .update({
          content: JSON.stringify(f),
          updated_at: new Date().toISOString(),
        })
        .eq("code", code);
      if (error) {
        console.error("Não foi possível salvar a sala", error.message);
      }
    },
    [code],
  );

  const persistNow = useCallback(
    (f: Files) => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      filesRef.current = f;
      writeDraftCache(code, f);
      void persistFiles(f);
    },
    [code, persistFiles],
  );

  // Load initial content
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("content, updated_at")
        .eq("code", code)
        .maybeSingle();
      if (!cancelled) {
        const remoteFiles = parseStoredContent(data?.content);
        const remoteUpdatedAt = data?.updated_at
          ? new Date(data.updated_at).getTime()
          : 0;
        const cached = readDraftCache(code);
        const parsed = cached && cached.savedAt > remoteUpdatedAt ? cached.files : remoteFiles;
        setFiles(parsed);
        filesRef.current = parsed;
        if (cached && cached.savedAt > remoteUpdatedAt) {
          persistNow(cached.files);
        }
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Flush pending edits before the tab closes / on unmount.
  useEffect(() => {
    const flush = () => {
      if (persistTimer.current) {
        persistNow(filesRef.current);
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persistNow]);

  // Realtime channel: presence + broadcast
  useEffect(() => {
    if (!loaded) return;
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Participant>();
        const list: Participant[] = [];
        Object.values(state).forEach((entries) => {
          entries.forEach((e) => list.push(e as Participant));
        });
        setParticipants(list);
      })
      .on("broadcast", { event: "file" }, (payload) => {
        const p = payload.payload as
          | { file?: FileKey; value?: string; from?: string }
          | undefined;
        if (!p || p.from === me.id) return;
        if (
          (p.file === "html" || p.file === "css" || p.file === "js") &&
          typeof p.value === "string"
        ) {
          setFiles((prev) => {
            if (prev[p.file as FileKey] === p.value) return prev;
            const next = { ...prev, [p.file as FileKey]: p.value as string };
            filesRef.current = next;
            writeDraftCache(code, next);
            return next;
          });
        }
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
        if (status === "SUBSCRIBED") {
          await channel.track(me);
        }
      });

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [loaded, code, me]);

  // Auto-scroll chat
  useEffect(() => {
    if (sidePanel === "chat" && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
    if (sidePanel === "chat") setUnreadChat(0);
  }, [chat, sidePanel]);

  // Broadcast per-file changes + debounce persist
  const updateFile = useCallback(
    (key: FileKey, value: string) => {
      setFiles((prev) => {
        if (prev[key] === value) return prev;
        const next = { ...prev, [key]: value };
        filesRef.current = next;
        writeDraftCache(code, next);
        const channel = channelRef.current;
        if (channel) {
          channel.send({
            type: "broadcast",
            event: "file",
            payload: { file: key, value, from: me.id },
          });
        }
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
          persistTimer.current = null;
          void persistFiles(next);
        }, 600);
        return next;
      });
    },
    [code, me.id, persistFiles],
  );

  // Combine files into a single HTML doc with inline <style> and <script>
  const buildPreviewHtml = useCallback(
    (f: Files, captureConsole: boolean) => {
      // Inject CSS into <head>, JS into <body>. Also inject a console-capture
      // bridge that forwards logs back to the parent.
      const styleTag = f.css ? `<style>\n${f.css}\n</style>` : "";
      const consoleBridge = captureConsole
        ? `<script>(function(){
  function s(v){if(v===undefined)return 'undefined';if(v===null)return 'null';if(typeof v==='string')return v;if(typeof v==='function')return v.toString();try{return JSON.stringify(v,function(k,val){if(typeof val==='function')return '[Function]';return val;},2);}catch(e){return String(v);}}
  var o={log:console.log,error:console.error,warn:console.warn,info:console.info};
  ['log','error','warn','info'].forEach(function(l){console[l]=function(){var p=[];for(var i=0;i<arguments.length;i++)p.push(s(arguments[i]));parent.postMessage({__codelive:true,type:'log',level:l,parts:p},'*');try{o[l].apply(console,arguments);}catch(e){}};});
  window.addEventListener('error',function(e){parent.postMessage({__codelive:true,type:'log',level:'error',parts:[String(e.message)+ ' (linha '+e.lineno+')']},'*');});
  window.addEventListener('unhandledrejection',function(e){parent.postMessage({__codelive:true,type:'log',level:'error',parts:[String(e.reason && e.reason.stack || e.reason)]},'*');});
})();<\/script>`
        : "";

      const scriptTag = f.js
        ? `<script>\ntry{\n${f.js}\n}catch(e){console.error(e && e.stack || e);}\n<\/script>`
        : "";

      let html = f.html || "";
      const hasHtmlTag = /<html[\s>]/i.test(html);
      if (!hasHtmlTag) {
        html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
      }

      // Insert consoleBridge + styles before </head>, script before </body>.
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${consoleBridge}${styleTag}</head>`);
      } else {
        html = html.replace(
          /<html[^>]*>/i,
          (m) => `${m}<head>${consoleBridge}${styleTag}</head>`,
        );
      }
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${scriptTag}</body>`);
      } else {
        html = html + scriptTag;
      }
      return html;
    },
    [],
  );

  // Validation: checks JS syntax with new Function, catches basic HTML/CSS issues.
  const validate = useCallback((f: Files): Diagnostic[] => {
    const diags: Diagnostic[] = [];

    // JS syntax check
    if (f.js.trim()) {
      try {
        // eslint-disable-next-line no-new-func
        new Function(f.js);
      } catch (e) {
        const err = e as Error;
        const msg = err.message;
        // Try to pull line number from V8/Firefox error messages.
        const lineMatch = /line\s*(\d+)|:(\d+):\d+/i.exec(err.stack || "");
        diags.push({
          file: "js",
          line: lineMatch ? Number(lineMatch[1] || lineMatch[2]) : undefined,
          message: msg,
          hint: suggestJsFix(msg),
        });
      }
    }

    // HTML: unclosed tag heuristic
    if (f.html.trim()) {
      const openTags: { name: string; line: number }[] = [];
      const voidTags = new Set([
        "area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr",
      ]);
      const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g;
      let m: RegExpExecArray | null;
      const lines = f.html.split("\n");
      const offsetToLine = (idx: number) => {
        let acc = 0;
        for (let i = 0; i < lines.length; i++) {
          acc += lines[i].length + 1;
          if (idx < acc) return i + 1;
        }
        return lines.length;
      };
      while ((m = tagRe.exec(f.html))) {
        const raw = m[0];
        const name = m[1].toLowerCase();
        const line = offsetToLine(m.index);
        if (raw.startsWith("</")) {
          const last = openTags.pop();
          if (!last || last.name !== name) {
            diags.push({
              file: "html",
              line,
              message: `Tag de fechamento inesperada </${name}>${last ? ` — esperava </${last.name}>` : ""}`,
              hint: last
                ? `Feche primeiro a tag <${last.name}> aberta na linha ${last.line}.`
                : "Remova esta tag de fechamento ou abra a correspondente antes.",
            });
          }
        } else if (!voidTags.has(name) && !raw.endsWith("/>")) {
          openTags.push({ name, line });
        }
      }
      for (const t of openTags) {
        diags.push({
          file: "html",
          line: t.line,
          message: `Tag <${t.name}> não foi fechada`,
          hint: `Adicione </${t.name}> no local apropriado.`,
        });
      }
    }

    // CSS: unbalanced braces
    if (f.css.trim()) {
      let depth = 0;
      let line = 1;
      for (let i = 0; i < f.css.length; i++) {
        const c = f.css[i];
        if (c === "\n") line++;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth < 0) {
            diags.push({
              file: "css",
              line,
              message: "Chave '}' sem '{' correspondente",
              hint: "Remova esta '}' ou adicione uma '{' antes.",
            });
            depth = 0;
          }
        }
      }
      if (depth > 0) {
        diags.push({
          file: "css",
          message: `${depth} chave(s) '{' não fechada(s)`,
          hint: "Adicione '}' correspondente(s) no fim das regras.",
        });
      }
    }

    return diags;
  }, []);

  // Listen for iframe console logs
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.__codelive !== true) return;
      if (data.type === "log") {
        setConsoleEntries((prev) =>
          [
            ...prev,
            {
              level: data.level,
              parts: data.parts || [],
              at: Date.now(),
            },
          ].slice(-100),
        );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function runValidate() {
    setRunning(true);
    const diags = validate(files);
    setDiagnostics(diags);
    setActiveTab("validate");
    setTimeout(() => setRunning(false), 200);
  }

  function refreshPreview() {
    setConsoleEntries([]);
    setPreviewSrcDoc(buildPreviewHtml(files, true));
    setActiveTab("preview");
  }

  useEffect(() => {
    if (activeTab === "preview" && !previewSrcDoc && loaded) {
      setPreviewSrcDoc(buildPreviewHtml(files, true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, loaded]);

  function copyLink() {
    const url = `${window.location.origin}/room/${code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function sendChat(e: React.FormEvent) {
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
    channelRef.current?.send({
      type: "broadcast",
      event: "chat",
      payload: msg,
    });
    setChatDraft("");
  }

  const currentValue = files[activeFile];
  const lineCount = currentValue.split("\n").length;
  const errorCount = diagnostics?.length ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent"
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-xs text-muted-foreground">Sala</div>
            <div className="font-mono text-sm font-semibold tracking-wider">
              {code}
            </div>
          </div>
          <button
            onClick={copyLink}
            className="ml-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copiado!" : "Copiar convite"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setSidePanel((p) => (p === "people" ? "none" : "people"))
            }
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent ${
              sidePanel === "people" ? "bg-accent" : ""
            }`}
          >
            <Users className="h-4 w-4" />
            <div className="flex -space-x-2">
              {participants.slice(0, 4).map((p) => (
                <div
                  key={p.id}
                  title={p.name}
                  className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-[9px] font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <span>{participants.length}</span>
          </button>

          <button
            onClick={() => {
              setSidePanel((p) => (p === "chat" ? "none" : "chat"));
              setUnreadChat(0);
            }}
            className={`relative inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent ${
              sidePanel === "chat" ? "bg-accent" : ""
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
            {unreadChat > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                {unreadChat}
              </span>
            )}
          </button>

          <button
            onClick={runValidate}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            Executar
          </button>

          <button
            onClick={refreshPreview}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Play className="h-4 w-4" />
            Preview
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col lg:flex-row">
        {/* Editor */}
        <section className="flex min-h-[50vh] flex-1 flex-col border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-0 border-b bg-muted/40 text-xs">
            {(["html", "css", "js"] as FileKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setActiveFile(k)}
                className={`inline-flex items-center gap-1.5 border-r px-3 py-2 ${
                  activeFile === k
                    ? "bg-background font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <FileCode className="h-3.5 w-3.5" />
                {k === "html" ? "index.html" : k === "css" ? "styles.css" : "script.js"}
              </button>
            ))}
            <div className="ml-auto px-3 py-2 text-muted-foreground">
              {lineCount} linhas
            </div>
          </div>
          <div className="relative flex-1">
            <textarea
              value={currentValue}
              onChange={(e) => updateFile(activeFile, e.target.value)}
              spellCheck={false}
              className="absolute inset-0 h-full w-full resize-none border-0 bg-background p-4 font-mono text-sm leading-6 outline-none"
              placeholder={`// ${activeFile === "html" ? "HTML" : activeFile === "css" ? "CSS" : "JavaScript"}…`}
            />
          </div>
        </section>

        {/* Output */}
        <section className="flex min-h-[35vh] w-full flex-col bg-card lg:w-[42%]">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab("validate")}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${
                  activeTab === "validate"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Executar
                {diagnostics !== null && (
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      errorCount === 0
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {errorCount === 0 ? "OK" : errorCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("preview")}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${
                  activeTab === "preview"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Layout className="h-3.5 w-3.5" />
                Preview
              </button>
              <button
                onClick={() => setActiveTab("console")}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 ${
                  activeTab === "console"
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                <Terminal className="h-3.5 w-3.5" />
                Console ({consoleEntries.length})
              </button>
            </div>
            {activeTab === "preview" && (
              <button
                onClick={refreshPreview}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"
              >
                <Eye className="h-3 w-3" />
                Atualizar
              </button>
            )}
            {activeTab === "console" && consoleEntries.length > 0 && (
              <button
                onClick={() => setConsoleEntries([])}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"
              >
                <Trash2 className="h-3 w-3" />
                Limpar
              </button>
            )}
          </div>

          <div className="relative flex-1 overflow-hidden">
            {activeTab === "preview" && (
              <iframe
                ref={previewRef}
                title="preview"
                sandbox="allow-scripts"
                srcDoc={previewSrcDoc}
                className="h-full w-full border-0 bg-white"
              />
            )}

            {activeTab === "validate" && (
              <div className="h-full overflow-y-auto p-3 text-xs">
                {diagnostics === null ? (
                  <p className="text-muted-foreground">
                    Clique em <strong>Executar</strong> no topo para verificar
                    se o código está correto.
                  </p>
                ) : diagnostics.length === 0 ? (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">Tudo certo!</div>
                      <div className="mt-0.5 text-xs opacity-90">
                        Nenhum erro encontrado nos arquivos. Abra o Preview para
                        ver o resultado.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {diagnostics.map((d, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
                      >
                        <div className="flex items-start gap-2">
                          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                              <span>
                                {d.file === "html"
                                  ? "index.html"
                                  : d.file === "css"
                                    ? "styles.css"
                                    : "script.js"}
                              </span>
                              {d.line && <span>· linha {d.line}</span>}
                            </div>
                            <div className="mt-1 font-mono text-xs text-foreground">
                              {d.message}
                            </div>
                            {d.hint && (
                              <div className="mt-1.5 text-xs text-muted-foreground">
                                <strong>Como corrigir:</strong> {d.hint}
                              </div>
                            )}
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
                  <p className="text-muted-foreground">
                    Nada no console ainda. Rode o Preview para ver os
                    `console.log` do seu script.js.
                  </p>
                ) : (
                  consoleEntries.map((e, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap border-b border-border/50 py-1 ${
                        e.level === "error"
                          ? "text-destructive"
                          : e.level === "warn"
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-foreground"
                      }`}
                    >
                      {e.parts.join(" ")}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        {/* Side panel: people / chat */}
        {sidePanel !== "none" && (
          <aside className="flex w-full flex-col border-t bg-card lg:w-80 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
              <span>
                {sidePanel === "people"
                  ? `Participantes (${participants.length})`
                  : "Chat da sala"}
              </span>
              <button
                onClick={() => setSidePanel("none")}
                className="rounded p-1 hover:bg-accent"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {sidePanel === "people" && (
              <div className="flex-1 overflow-y-auto p-2">
                {participants.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">
                    Ninguém conectado.
                  </p>
                )}
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent"
                  >
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: p.color }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 text-sm">
                      {p.name}
                      {p.id === me.id && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (você)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sidePanel === "chat" && (
              <>
                <div
                  ref={chatScrollRef}
                  className="flex-1 space-y-2 overflow-y-auto p-3 text-sm"
                >
                  {chat.length === 0 && (
                    <p className="text-muted-foreground">
                      Nenhuma mensagem ainda. Diga oi!
                    </p>
                  )}
                  {chat.map((m) => (
                    <div key={m.id} className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="text-xs font-semibold"
                          style={{ color: m.authorColor }}
                        >
                          {m.authorName}
                          {m.authorId === me.id && (
                            <span className="ml-1 text-muted-foreground">
                              (você)
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(m.at).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm">
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={sendChat}
                  className="flex gap-2 border-t p-2"
                >
                  <input
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Escreva uma mensagem…"
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
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
  if (m.includes("unexpected token")) {
    return "Verifique parênteses, chaves e ponto-e-vírgula próximos ao local indicado.";
  }
  if (m.includes("unexpected end of input")) {
    return "Você provavelmente esqueceu de fechar uma chave '}', parêntese ')' ou aspas.";
  }
  if (m.includes("is not defined")) {
    return "Declare a variável com let/const antes de usá-la, ou verifique se o nome está correto.";
  }
  if (m.includes("assignment to constant")) {
    return "Você está reatribuindo uma const. Use let se o valor precisa mudar.";
  }
  if (m.includes("missing ) after")) {
    return "Falta um ')' fechando uma chamada de função ou expressão.";
  }
  if (m.includes("invalid or unexpected token")) {
    return "Caractere inválido — verifique aspas, acentos ou símbolos estranhos.";
  }
  return undefined;
}
