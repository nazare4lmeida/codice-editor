import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Copy, Eye, Layout, Play, Terminal, Trash2, Users } from "lucide-react";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Sala ${params.code} — CodeLive` },
      {
        name: "description",
        content: "Editor JavaScript colaborativo ao vivo para aulas.",
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

interface Participant {
  id: string;
  name: string;
  color: string;
}

interface OutputItem {
  id: string;
  authorName: string;
  authorColor: string;
  entries: { level: "log" | "error" | "warn" | "info"; parts: string[] }[];
  error?: string;
  at: number;
}

function randomId() {
  return Math.random().toString(36).slice(2);
}

function pickColor(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COLORS[sum % COLORS.length];
}

function RoomPage() {
  const { code } = useParams({ from: "/room/$code" });
  const [content, setContent] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"console" | "preview">("console");
  const [previewVersion, setPreviewVersion] = useState(0);

  const me = useMemo<Participant>(() => {
    const id = randomId();
    const name =
      (typeof window !== "undefined" &&
        sessionStorage.getItem("codelive:name")) ||
      "Convidado";
    return { id, name, color: pickColor(id) };
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewRef = useRef<HTMLIFrameElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteApplying = useRef(false);
  const pendingRunId = useRef<string | null>(null);

  // Load initial content
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("content")
        .eq("code", code)
        .maybeSingle();
      if (!cancelled) {
        setContent(data?.content ?? "");
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

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
      .on("broadcast", { event: "code" }, (payload) => {
        const next = payload.payload?.content as string | undefined;
        if (typeof next === "string") {
          remoteApplying.current = true;
          setContent(next);
        }
      })
      .on("broadcast", { event: "output" }, (payload) => {
        const item = payload.payload as OutputItem;
        setOutputs((prev) => [item, ...prev].slice(0, 50));
      })
      .on("broadcast", { event: "clear" }, () => setOutputs([]))
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

  // Broadcast content changes + debounce persist
  const onLocalChange = useCallback(
    (next: string) => {
      setContent(next);
      const channel = channelRef.current;
      if (channel) {
        channel.send({
          type: "broadcast",
          event: "code",
          payload: { content: next, from: me.id },
        });
      }
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        supabase
          .from("rooms")
          .update({ content: next, updated_at: new Date().toISOString() })
          .eq("code", code);
      }, 800);
    },
    [code, me.id],
  );

  // Listen for iframe run results
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || data.__codelive !== true) return;
      if (data.type === "result" && data.runId === pendingRunId.current) {
        const item: OutputItem = {
          id: randomId(),
          authorName: me.name,
          authorColor: me.color,
          entries: data.entries || [],
          error: data.error,
          at: Date.now(),
        };
        setOutputs((prev) => [item, ...prev].slice(0, 50));
        channelRef.current?.send({
          type: "broadcast",
          event: "output",
          payload: item,
        });
        setRunning(false);
        pendingRunId.current = null;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [me]);

  function runCode() {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    setRunning(true);
    const runId = randomId();
    pendingRunId.current = runId;
    iframe.contentWindow.postMessage(
      { __codelive: true, type: "run", runId, code: content },
      "*",
    );
    // Safety timeout
    setTimeout(() => {
      if (pendingRunId.current === runId) {
        setRunning(false);
        pendingRunId.current = null;
      }
    }, 5000);
  }

  function clearOutputs() {
    setOutputs([]);
    channelRef.current?.send({
      type: "broadcast",
      event: "clear",
      payload: {},
    });
  }

  function copyLink() {
    const url = `${window.location.origin}/room/${code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function looksLikeHtml(code: string) {
    const trimmed = code.trim().toLowerCase();
    return (
      trimmed.startsWith("<") ||
      /^<!doctype\shtml/.test(trimmed) ||
      /<html|head|body|div|span|h[1-6]|p|button|input|form|section|header|footer/i.test(
        trimmed.slice(0, 200),
      )
    );
  }

  function buildPreviewHtml(code: string) {
    if (looksLikeHtml(code)) {
      return code;
    }
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:1rem;line-height:1.5}</style></head><body>
<script>
(function(){
  function stringify(v){
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'function') return v.toString();
    try { return JSON.stringify(v, function(k, val){
      if (typeof val === 'function') return '[Function ' + (val.name||'anonymous') + ']';
      if (typeof val === 'undefined') return 'undefined';
      return val;
    }, 2); } catch(e) { return String(v); }
  }
  var original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  ['log','error','warn','info'].forEach(function(level){
    console[level] = function(){
      var el = document.createElement('div');
      el.style.cssText = 'white-space:pre-wrap;font-family:monospace;font-size:12px;margin:2px 0;padding:2px 0;border-bottom:1px solid #eee';
      var parts = [];
      for (var i=0;i<arguments.length;i++) parts.push(stringify(arguments[i]));
      el.textContent = parts.join(' ');
      document.body.appendChild(el);
      try { original[level].apply(console, arguments); } catch(e){}
    };
  });
  window.onerror = function(msg, url, line, col, err){
    var el = document.createElement('div');
    el.style.cssText = 'color:#ef4444;white-space:pre-wrap;font-family:monospace;font-size:12px;margin:2px 0';
    el.textContent = '⚠ ' + (err && err.stack || msg);
    document.body.appendChild(el);
  };
  try {
    var runner = new Function('"use strict"; return (async () => { ' + code + '\\n })();');
    Promise.resolve(runner()).catch(function(e){
      var el = document.createElement('div');
      el.style.cssText = 'color:#ef4444;white-space:pre-wrap;font-family:monospace;font-size:12px;margin:2px 0';
      el.textContent = '⚠ ' + (e && e.stack || e);
      document.body.appendChild(el);
    });
  } catch(e) {
    var el = document.createElement('div');
    el.style.cssText = 'color:#ef4444;white-space:pre-wrap;font-family:monospace;font-size:12px;margin:2px 0';
    el.textContent = '⚠ ' + (e && e.stack || e);
    document.body.appendChild(el);
  }
})();
</script>
</body></html>`;
  }

  function updatePreview() {
    const iframe = previewRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(buildPreviewHtml(content));
    doc.close();
  }

  useEffect(() => {
    if (activeTab === "preview") {
      updatePreview();
    }
  }, [activeTab, previewVersion]);

  // Handle Ctrl/Cmd + Enter
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runCode();
    }
  }

  const lineCount = content.split("\n").length;

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

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="flex -space-x-2">
              {participants.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  title={p.name}
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card text-[10px] font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              {participants.length}
            </span>
          </div>

          <button
            onClick={runCode}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            {running ? "Executando…" : "Executar"}
            <kbd className="ml-1 hidden rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-normal sm:inline">
              ⌘⏎
            </kbd>
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col lg:flex-row">
        {/* Editor */}
        <section className="flex min-h-[50vh] flex-1 flex-col border-b lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <span>editor.js</span>
            <span>{lineCount} linhas · JavaScript</span>
          </div>
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                if (remoteApplying.current) {
                  remoteApplying.current = false;
                  return;
                }
                onLocalChange(e.target.value);
              }}
              onKeyDown={onKeyDown}
              spellCheck={false}
              className="absolute inset-0 h-full w-full resize-none border-0 bg-background p-4 font-mono text-sm leading-6 outline-none"
              placeholder="// Escreva JavaScript aqui…"
            />
          </div>
        </section>

        {/* Output */}
        <section className="flex min-h-[35vh] w-full flex-col bg-card lg:w-[42%]">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
            <span>Saída ({outputs.length})</span>
            <button
              onClick={clearOutputs}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"
            >
              <Trash2 className="h-3 w-3" />
              Limpar
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
            {outputs.length === 0 && (
              <p className="text-muted-foreground">
                Nenhuma execução ainda. Clique em Executar (⌘⏎) para rodar o
                código.
              </p>
            )}
            {outputs.map((out) => (
              <div
                key={out.id}
                className="mb-3 rounded-md border bg-background p-2.5"
              >
                <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: out.authorColor }}
                  />
                  <span className="font-sans font-semibold">
                    {out.authorName}
                  </span>
                  <span>· {new Date(out.at).toLocaleTimeString()}</span>
                </div>
                {out.entries.map((e, i) => (
                  <div
                    key={i}
                    className={
                      e.level === "error"
                        ? "whitespace-pre-wrap text-destructive"
                        : e.level === "warn"
                          ? "whitespace-pre-wrap text-yellow-600 dark:text-yellow-400"
                          : "whitespace-pre-wrap text-foreground"
                    }
                  >
                    {e.parts.join(" ")}
                  </div>
                ))}
                {out.error && (
                  <div className="mt-1 whitespace-pre-wrap text-destructive">
                    ⚠ {out.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Hidden sandbox iframe for isolated execution */}
      <iframe
        ref={iframeRef}
        title="sandbox"
        sandbox="allow-scripts"
        srcDoc={SANDBOX_HTML}
        style={{ display: "none" }}
      />
    </div>
  );
}

const SANDBOX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
(function(){
  function stringify(v){
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'function') return v.toString();
    try { return JSON.stringify(v, function(k, val){
      if (typeof val === 'function') return '[Function ' + (val.name||'anonymous') + ']';
      if (typeof val === 'undefined') return 'undefined';
      return val;
    }, 2); } catch(e) { return String(v); }
  }
  window.addEventListener('message', function(ev){
    var data = ev.data;
    if (!data || data.__codelive !== true || data.type !== 'run') return;
    var runId = data.runId;
    var code = data.code || '';
    var entries = [];
    var original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    ['log','error','warn','info'].forEach(function(level){
      console[level] = function(){
        var parts = [];
        for (var i=0;i<arguments.length;i++) parts.push(stringify(arguments[i]));
        entries.push({ level: level, parts: parts });
        try { original[level].apply(console, arguments); } catch(e){}
      };
    });
    var errMsg;
    try {
      // Wrap in async so top-level await works and evaluate as expression when possible.
      var runner = new Function('"use strict"; return (async () => { ' + code + '\\n })();');
      Promise.resolve(runner()).catch(function(e){
        entries.push({ level: 'error', parts: [String(e && e.stack || e)] });
      }).finally(function(){
        parent.postMessage({ __codelive: true, type: 'result', runId: runId, entries: entries, error: errMsg }, '*');
      });
    } catch(e) {
      errMsg = String(e && e.stack || e);
      parent.postMessage({ __codelive: true, type: 'result', runId: runId, entries: entries, error: errMsg }, '*');
    }
  });
})();
</script>
</body></html>`;
