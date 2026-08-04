# Codice — Workspace colaborativo de código para aulas

**Codice** (Códice · Código · Code‑se) é um workspace de código colaborativo em tempo real, pensado para aulas de programação: a turma inteira escreve HTML, CSS e JavaScript no mesmo projeto, executa, valida e vê o resultado ao vivo — sem instalar nada.

🔗 **App publicado:** https://codice-editor.lovable.app

---

## ✨ Funcionalidades

| Recurso | Descrição |
| --- | --- |
| 🧑‍🤝‍🧑 Salas por link | Crie uma sala e compartilhe o código/link — até dezenas de alunos entram simultaneamente |
| ⚡ Colaboração em tempo real | Edições sincronizadas via Supabase Realtime (broadcast por arquivo) |
| 👀 Indicador de edição | "Fulana está editando styles.css", com cor única por participante |
| 📁 Projeto multi‑arquivo | `index.html`, `styles.css`, `script.js` e quantos arquivos você quiser criar |
| ▶️ Executar (validação) | Verifica sintaxe de JS/HTML/CSS, aponta o erro e sugere a correção |
| 🖥️ Preview real | Monta o projeto completo (links, scripts, módulos) em um iframe sandbox |
| 🧾 Console | Captura `console.log` e erros de runtime do preview |
| 💬 Chat + participantes | Painel lateral com presença ao vivo, chat persistido e seletor de emojis |
| 🎨 Temas e paletas | Modo claro/escuro + 4 paletas (Ardósia, Rosé Terroso, Marinho Sereno, Floresta Profunda) aplicadas ao site **e** ao realce de sintaxe |
| 🌈 Cores inline | Swatch clicável ao lado de valores hex/rgb/hsl, estilo VS Code |
| 📦 Importar/Exportar | Baixe o workspace como `.zip` ou importe um projeto existente |
| ↔️ Painéis redimensionáveis | Larguras de editor/saída/chat ajustáveis e salvas no navegador |
| 💾 Persistência resiliente | Cache local + salvamento `keepalive` ao fechar a aba: o código não volta ao padrão |

---

## 🧱 Arquitetura

```
Navegador (React 19 + TanStack Start)
├── src/routes/index.tsx        → landing: criar / entrar em sala
├── src/routes/room.$code.tsx   → workspace (editor, preview, console, chat)
├── src/components/code-editor.tsx → CodeMirror 6 + swatches de cor
├── src/hooks/use-theme.ts      → store global de tema/paleta (useSyncExternalStore)
└── src/lib/editor-themes.ts    → 8 temas de sintaxe (4 paletas × claro/escuro)
        │
        ├── Supabase Realtime  → broadcast de código, chat e presença
        └── Supabase Postgres  → tabela `rooms` (persistência do projeto)
```

**Execução de código:** roda 100% no navegador do aluno, dentro de um `<iframe sandbox>` isolado com `srcDoc`. Não há execução no servidor — cada sessão é independente e não afeta as outras.

**Sincronização:** cada alteração é transmitida por arquivo via canal Realtime (baixa latência), e apenas o autor da alteração grava no Postgres (debounce), evitando dezenas de escritas simultâneas com 30+ alunos.

### Banco de dados

```sql
public.rooms (
  id uuid pk,
  code text unique,   -- código da sala (link)
  content text,       -- JSON do projeto (v2: mapa caminho → conteúdo)
  language text,
  created_at timestamptz,
  updated_at timestamptz
)
```
RLS habilitado com políticas públicas de leitura/escrita (acesso anônimo por link, sem login).

---

## 🛠️ Tecnologias

- **Framework:** TanStack Start v1 (React 19, SSR) + TanStack Router
- **Build:** Vite 8
- **Linguagem:** TypeScript
- **Estilo:** Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react
- **Editor:** CodeMirror 6 (`@uiw/react-codemirror`) com linguagens HTML/CSS/JS/TS/JSON
- **Backend:** Supabase (Postgres + Realtime broadcast/presence) via Lovable Cloud
- **Dados:** TanStack Query
- **Utilitários:** JSZip (export/import), sonner (toasts), zod

---

## 🚀 Rodando localmente

Pré‑requisitos: [Bun](https://bun.sh) (ou Node 20+) e um projeto Supabase.

```bash
git clone <URL-DO-SEU-REPO>
cd codice
bun install
bun run dev          # http://localhost:8080
```

Crie um `.env` na raiz:

```env
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<sua-publishable-key>
VITE_SUPABASE_PROJECT_ID=<seu-project-id>
```

Aplique a migração do banco (SQL em `supabase/migrations/`) no seu projeto Supabase e habilite **Realtime** para a tabela `rooms`.

### Scripts

| Comando | O que faz |
| --- | --- |
| `bun run dev` | Servidor de desenvolvimento |
| `bun run build` | Build de produção |
| `bun run preview` | Serve o build localmente |
| `bun run lint` | ESLint + Prettier |
| `bun run format` | Formata o código |

---

## 📖 Passo a passo de uso (aula)

1. **Instrutor** abre o app e clica em **Criar sala** — recebe um código (ex.: `ABC123`).
2. Compartilha o link `https://codice-editor.lovable.app/room/ABC123` com a turma.
3. **Alunos** entram, escolhem um nome e já aparecem na lista de participantes.
4. Todos editam `index.html`, `styles.css` e `script.js` (ou criam novos arquivos) — as mudanças aparecem na hora para todos, com aviso de quem está editando o quê.
5. **Executar** valida a sintaxe e lista erros com sugestão de correção; **Preview** mostra a página montada; **Console** exibe os `console.log`.
6. Ao final, **Exportar .zip** salva o projeto da aula; **Importar** traz um projeto pronto para a próxima turma.

---

## ☁️ Deploy

O projeto é publicado direto pela Lovable (**Publish**), com deploy em edge (Cloudflare Workers) e domínio `*.lovable.app` — ou domínio próprio nas configurações.

Para hospedar em outro lugar: `bun run build` e sirva a saída do Nitro/Vite em qualquer plataforma que suporte Node/edge, com as mesmas variáveis de ambiente configuradas.

---

## 📄 Licença

MIT — use livremente em suas aulas.
