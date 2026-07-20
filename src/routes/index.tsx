import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Code2, Users, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CodeLive — Editor de código colaborativo para aulas" },
      {
        name: "description",
        content:
          "Ensine programação com um editor de código ao vivo. Alunos e instrutor digitam no mesmo espaço e veem execuções em tempo real.",
      },
      { property: "og:title", content: "CodeLive — Editor colaborativo ao vivo" },
      {
        property: "og:description",
        content:
          "Sala compartilhada de código JavaScript. Múltiplos alunos digitam e executam ao mesmo tempo.",
      },
    ],
  }),
  component: Landing,
});

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

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
      const { error } = await supabase.from("rooms").insert({ code });
      if (error) throw error;
      sessionStorage.setItem("codelive:name", displayName);
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
      sessionStorage.setItem("codelive:name", displayName);
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
        <header className="mb-14 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Code2 className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">CodeLive</h1>
        </header>

        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Ensine código escrevendo{" "}
              <span className="text-primary">juntos</span>, ao vivo.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Um editor JavaScript compartilhado onde toda a turma digita no mesmo
              lugar, executa código isolado em sandbox e vê os resultados na hora.
              Sem instalar nada. Sem login.
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

            <button
              onClick={createRoom}
              disabled={loading}
              className="mt-6 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Criando…" : "Criar nova sala"}
            </button>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              ou
              <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={joinRoom} className="space-y-2">
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

            {error && (
              <p className="mt-4 text-sm text-destructive">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
