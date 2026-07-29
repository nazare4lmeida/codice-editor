import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Code2, Users, Zap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { PalettePicker } from "@/components/palette-picker";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Codice — Workspace colaborativo de código para aulas" },
      {
        name: "description",
        content:
          "Codice é o workspace onde a turma programa junta: múltiplos arquivos, execução ao vivo e preview em tempo real, sem instalar nada.",
      },
      { property: "og:title", content: "Codice — Workspace colaborativo de código para aulas" },
      {
        property: "og:description",
        content:
          "Codice é o workspace onde a turma programa junta: múltiplos arquivos, execução ao vivo e preview em tempo real, sem instalar nada.",
      },
    ],
  }),
  component: Landing,
});

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const DEFAULT_ROOM_CONTENT = JSON.stringify({
  version: 2,
  activePath: "index.html",
  files: {
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
  },
});

function Landing() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = name.trim() || "Convidado";

  async function createRoom() {
    setLoading(true);
    setError(null);
    try {
      const code = makeCode();
      const { error } = await supabase.from("rooms").insert({
        code,
        content: DEFAULT_ROOM_CONTENT,
        language: "web",
      });
      if (error) throw error;
      sessionStorage.setItem("codice:name", displayName);
      navigate({ to: "/room/$code", params: { code } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("rooms")
        .select("code")
        .eq("code", code)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setError("Sala não encontrada.");
        return;
      }
      sessionStorage.setItem("codice:name", displayName);
      navigate({ to: "/room/$code", params: { code } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <header className="mb-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight leading-none">Codice</h1>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Workspace de código</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PalettePicker />
            <ThemeToggle />
          </div>
        </header>

        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Um workspace onde a turma escreve código{" "}
              <span className="text-primary">junta</span>, ao vivo.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Codice é um workspace colaborativo com múltiplos arquivos, execução
              isolada em sandbox e preview em tempo real. Toda a turma no mesmo
              projeto, sem instalar nada, sem login.
            </p>

            <ul className="mt-8 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Users className="mt-0.5 h-5 w-5 text-primary" />
                <span>Múltiplos alunos e instrutor no mesmo editor</span>
              </li>
              <li className="flex items-start gap-3">
                <Zap className="mt-0.5 h-5 w-5 text-primary" />
                <span>Execução instantânea em sandbox isolada</span>
              </li>
              <li className="flex items-start gap-3">
                <Code2 className="mt-0.5 h-5 w-5 text-primary" />
                <span>Sincronização em tempo real via WebSocket</span>
              </li>
            </ul>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <label className="text-sm font-medium">Seu nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Ana"
              className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />

            <form onSubmit={joinRoom} className="mt-5 space-y-2">
              <label className="text-sm font-medium">Entrar em uma sala</label>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="CÓDIGO"
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm uppercase tracking-widest outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                >
                  Entrar
                </button>
              </div>
            </form>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              ou
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              onClick={createRoom}
              disabled={loading}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Criando…" : "Criar nova sala"}
            </button>

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
