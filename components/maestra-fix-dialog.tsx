"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import {
  saveMaestraFixConfigAction,
  type ColumnMeta,
  type MaestraFixConfig,
} from "@/app/actions";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** All available maestra columns (from columnMeta). */
  maestraColumns: ColumnMeta[];
  /** Current saved config. */
  config: MaestraFixConfig;
  /** Whether any rows are currently selected in the maestra table. */
  hasSelectedRows: boolean;
  /** Called after the user saves config. */
  onConfigSaved: (config: MaestraFixConfig) => void;
  /** Called when user clicks "Ejecutar". Dialog closes; parent triggers the AI flow. */
  onRun: (mode: "selected" | "all", activeColumns: { dbColumn: string; name: string; prompt: string }[]) => void;
  /** Whether the AI flow is currently running (disables run buttons). */
  isRunning: boolean;
}

interface ColumnState {
  dbColumn: string;
  name: string;
  enabled: boolean;
  prompt: string;
}

export function MaestraFixDialog({
  open,
  onOpenChange,
  maestraColumns,
  config,
  hasSelectedRows,
  onConfigSaved,
  onRun,
  isRunning,
}: Props) {
  const [rows, setRows] = useState<ColumnState[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Merge maestra columns with saved config whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    const cfgMap = new Map(config.columns.map((c) => [c.dbColumn, c]));
    const merged: ColumnState[] = maestraColumns.map((mc) => {
      const saved = cfgMap.get(mc.dbColumn);
      return {
        dbColumn: mc.dbColumn,
        name: mc.excelHeader,
        enabled: saved?.enabled ?? false,
        prompt: saved?.prompt ?? "",
      };
    });
    setRows(merged);
  }, [open, maestraColumns, config]);

  const enabledRows = useMemo(() => rows.filter((r) => r.enabled && r.prompt.trim() !== ""), [rows]);

  const updateRow = (dbColumn: string, patch: Partial<ColumnState>) => {
    setRows((prev) => prev.map((r) => (r.dbColumn === dbColumn ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cfg: MaestraFixConfig = {
        columns: rows.map((r) => ({
          dbColumn: r.dbColumn,
          enabled: r.enabled,
          prompt: r.prompt,
        })),
      };
      const result = await saveMaestraFixConfigAction(cfg);
      if (result.success) {
        toast.success("Configuración guardada");
        onConfigSaved(cfg);
      } else {
        toast.error(result.error || "Error al guardar");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async (mode: "selected" | "all") => {
    if (enabledRows.length === 0) {
      toast.error("Marca al menos una columna y escribe su criterio de corrección");
      return;
    }
    // Save current state before running so the config is persisted
    const cfg: MaestraFixConfig = {
      columns: rows.map((r) => ({
        dbColumn: r.dbColumn,
        enabled: r.enabled,
        prompt: r.prompt,
      })),
    };
    try {
      await saveMaestraFixConfigAction(cfg);
      onConfigSaved(cfg);
    } catch {
      // continue anyway
    }
    onRun(
      mode,
      enabledRows.map((r) => ({ dbColumn: r.dbColumn, name: r.name, prompt: r.prompt }))
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            AI Fix — Maestra
          </DialogTitle>
          <DialogDescription>
            Marca las columnas que quieres revisar y define el criterio de corrección para cada una.
            Por ejemplo: &quot;Capitalizar primera letra&quot;, &quot;Corregir errores de ortografía&quot;, etc.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2">
          {rows.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12">
              No hay columnas cargadas en la maestra. Importa un archivo primero.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => (
                <div
                  key={r.dbColumn}
                  className={`rounded-lg border p-3 transition-colors ${
                    r.enabled ? "border-violet-300 bg-violet-50/40" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`fix-${r.dbColumn}`}
                      checked={r.enabled}
                      onCheckedChange={(checked) =>
                        updateRow(r.dbColumn, { enabled: Boolean(checked) })
                      }
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      <Label
                        htmlFor={`fix-${r.dbColumn}`}
                        className="font-medium cursor-pointer block"
                      >
                        {r.name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({r.dbColumn})
                        </span>
                      </Label>
                      <Textarea
                        placeholder="Criterio de corrección (ej: Capitalizar primera letra de cada palabra)"
                        value={r.prompt}
                        onChange={(e) => updateRow(r.dbColumn, { prompt: e.target.value })}
                        disabled={!r.enabled}
                        className="min-h-[60px] text-sm resize-y"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between border-t pt-4 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || rows.length === 0}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="ml-2">Guardar config</span>
          </Button>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleRun("selected")}
              disabled={isRunning || enabledRows.length === 0 || !hasSelectedRows}
              className="border-violet-300 text-violet-700 hover:bg-violet-50"
            >
              <Wand2 className="h-4 w-4" />
              <span className="ml-2">Ejecutar en seleccionados</span>
            </Button>
            <Button
              size="sm"
              onClick={() => handleRun("all")}
              disabled={isRunning || enabledRows.length === 0}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Sparkles className="h-4 w-4" />
              <span className="ml-2">Ejecutar en todos</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
