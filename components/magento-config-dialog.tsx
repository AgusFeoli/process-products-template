"use client";

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Save,
} from "lucide-react";
import {
  updateMagentoConfig,
  type MagentoConfig,
  type MagentoViewConfig,
  type MagentoColumn,
  type ColumnMeta,
} from "@/app/actions";
import { generateColumnId } from "@/lib/magento-config";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The full config (all views) */
  config: MagentoConfig;
  /** The view currently being edited */
  viewId: string | null;
  maestraColumns: ColumnMeta[];
  onSaved: (config: MagentoConfig) => void;
  /** Called when user clicks "Eliminar vista" */
  onDeleteView?: (viewId: string) => void;
}

type SourceType = "maestra" | "fixed" | "manual";

export function MagentoConfigDialog({
  open,
  onOpenChange,
  config,
  viewId,
  maestraColumns,
  onSaved,
  onDeleteView,
}: Props) {
  const view = viewId ? config.views.find((v) => v.id === viewId) : null;

  const [viewName, setViewName] = useState("");
  const [buttonLabel, setButtonLabel] = useState("");
  const [columns, setColumns] = useState<MagentoColumn[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open && view) {
      setViewName(view.name);
      setButtonLabel(view.buttonLabel);
      setColumns(view.columns);
    }
  }, [open, view]);

  const addColumn = () => {
    const newCol: MagentoColumn = {
      id: generateColumnId(),
      name: "",
      source: { type: "manual" },
    };
    setColumns((prev) => [...prev, newCol]);
  };

  const updateColumn = (id: string, patch: Partial<MagentoColumn>) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const updateColumnSource = (id: string, sourceType: SourceType) => {
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (sourceType === "manual") {
          return { ...c, source: { type: "manual" } };
        }
        if (sourceType === "fixed") {
          return { ...c, source: { type: "fixed", value: "" } };
        }
        return {
          ...c,
          source: {
            type: "maestra",
            maestraColumn: maestraColumns[0]?.dbColumn ?? "",
          },
        };
      })
    );
  };

  const removeColumn = (id: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const moveColumn = (id: string, direction: -1 | 1) => {
    setColumns((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  const handleSave = async () => {
    if (!view) return;

    const cleanName = viewName.trim() || "Magento";
    const cleanLabel = buttonLabel.trim() || "Exportar Magento";

    for (const col of columns) {
      if (!col.name.trim()) {
        toast.error("Cada columna debe tener un nombre");
        return;
      }
      if (col.source.type === "maestra" && !col.source.maestraColumn) {
        toast.error(`La columna "${col.name}" debe tener una columna de maestra asociada`);
        return;
      }
    }

    const updatedView: MagentoViewConfig = {
      id: view.id,
      name: cleanName,
      buttonLabel: cleanLabel,
      columns: columns.map((c) => ({ ...c, name: c.name.trim() })),
    };

    const newConfig: MagentoConfig = {
      views: config.views.map((v) => (v.id === view.id ? updatedView : v)),
    };

    setIsSaving(true);
    try {
      const result = await updateMagentoConfig(newConfig);
      if (result.success) {
        toast.success("Configuración guardada");
        onSaved(newConfig);
        onOpenChange(false);
      } else {
        toast.error(result.error || "Error al guardar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!view || !onDeleteView) return;
    onDeleteView(view.id);
    onOpenChange(false);
  };

  if (!view) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Configurar vista de exportación</DialogTitle>
          <DialogDescription>
            Personaliza el nombre de la vista, el botón y las columnas que se exportarán. Cada columna puede venir de la maestra (se copia fila por fila), un valor fijo, o ser manual (editable).
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          {/* View name + button label */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="view-name" className="text-sm">Nombre de la vista</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="Magento"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="magento-btn-label" className="text-sm">Nombre del botón de exportación</Label>
              <Input
                id="magento-btn-label"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder="Exportar Magento"
              />
            </div>
          </div>

          {/* Columns list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Columnas a exportar ({columns.length})</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addColumn}
                className="h-8 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="ml-1.5">Agregar columna</span>
              </Button>
            </div>

            {columns.length === 0 ? (
              <div className="border border-dashed rounded-md p-8 text-center text-sm text-muted-foreground">
                No hay columnas configuradas. Haz clic en &ldquo;Agregar columna&rdquo; para comenzar.
              </div>
            ) : (
              <div className="space-y-2">
                {columns.map((col, idx) => (
                  <div
                    key={col.id}
                    className="border border-border rounded-md p-3 bg-muted/30 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-1 pt-5">
                        <button
                          type="button"
                          onClick={() => moveColumn(col.id, -1)}
                          disabled={idx === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label="Mover arriba"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveColumn(col.id, 1)}
                          disabled={idx === columns.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label="Mover abajo"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Nombre</Label>
                          <Input
                            value={col.name}
                            onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                            placeholder="ej. sku"
                            className="h-8 text-sm"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Origen</Label>
                          <Select
                            value={col.source.type}
                            onValueChange={(v) => updateColumnSource(col.id, v as SourceType)}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="maestra">Columna de maestra</SelectItem>
                              <SelectItem value="fixed">Valor fijo</SelectItem>
                              <SelectItem value="manual">Manual (editable)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          {col.source.type === "maestra" && (
                            <>
                              <Label className="text-xs text-muted-foreground">Columna de maestra</Label>
                              <Select
                                value={col.source.maestraColumn}
                                onValueChange={(v) =>
                                  updateColumn(col.id, {
                                    source: { type: "maestra", maestraColumn: v },
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Seleccionar..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {maestraColumns.length === 0 ? (
                                    <SelectItem value="__none__" disabled>
                                      Importa una maestra primero
                                    </SelectItem>
                                  ) : (
                                    maestraColumns.map((m) => (
                                      <SelectItem key={m.dbColumn} value={m.dbColumn}>
                                        {m.excelHeader}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </>
                          )}

                          {col.source.type === "fixed" && (
                            <>
                              <Label className="text-xs text-muted-foreground">Valor fijo</Label>
                              <Input
                                value={col.source.value}
                                onChange={(e) =>
                                  updateColumn(col.id, {
                                    source: { type: "fixed", value: e.target.value },
                                  })
                                }
                                placeholder="ej. Default"
                                className="h-8 text-sm"
                              />
                            </>
                          )}

                          {col.source.type === "manual" && (
                            <>
                              <Label className="text-xs text-muted-foreground">Editable por fila</Label>
                              <div className="h-8 flex items-center text-xs text-muted-foreground italic">
                                Se llena desde la vista
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeColumn(col.id)}
                        className="text-muted-foreground hover:text-destructive pt-5"
                        aria-label="Eliminar columna"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          {onDeleteView ? (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={isSaving}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              <span className="ml-2">Eliminar vista</span>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2">Guardando...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span className="ml-2">Guardar</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
