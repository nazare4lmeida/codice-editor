import { useState } from "react";
import { Palette as PaletteIcon, Check } from "lucide-react";
import { useTheme, PALETTES, type Palette } from "@/hooks/use-theme";

export function PalettePicker({ className = "" }: { className?: string }) {
  const { palette, setPalette } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-foreground transition-colors hover:bg-accent"
        aria-label="Escolher paleta de cores"
        title="Paleta de cores"
      >
        <PaletteIcon className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
            <div className="mb-1 px-2 py-1 text-xs font-medium text-muted-foreground">
              Paleta de cores
            </div>
            {PALETTES.map((p) => {
              const active = p.id === palette;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPalette(p.id as Palette);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                    active ? "bg-accent/60" : ""
                  }`}
                >
                  <div className="flex h-5 w-14 overflow-hidden rounded border">
                    {p.swatches.map((c, i) => (
                      <div key={i} className="flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <span className="flex-1 truncate">{p.name}</span>
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
