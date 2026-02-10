"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchProveedores,
  addProveedor,
  editProveedor,
  removeProveedor,
  removeAllProveedores,
  importProveedores,
  exportProveedoresXlsx,
  toggleSkipAi,
  type Proveedor,
} from "./actions";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Upload,
  Download,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Users,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import Link from "next/link";

type SortDirection = "asc" | "desc" | null;

export default function ProveedoresPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sort state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Add/Edit dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProveedor, setEditingProveedor] = useState<Proveedor | null>(null);
  const [formData, setFormData] = useState({ codigo: "", nombre: "", tipo: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const result = await fetchProveedores();
      if (result.success && result.data) {
        setProveedores(result.data);
      } else {
        toast.error(result.error || "Error al cargar proveedores");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar proveedores");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered and sorted proveedores
  const filteredProveedores = proveedores.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      String(p.codigo).includes(q) ||
      p.nombre.toLowerCase().includes(q) ||
      (p.tipo || "").toLowerCase().includes(q)
    );
  });

  const sortedProveedores = (() => {
    if (!sortColumn || !sortDirection) return filteredProveedores;
    return [...filteredProveedores].sort((a, b) => {
      const aVal = a[sortColumn as keyof Proveedor];
      const bVal = b[sortColumn as keyof Proveedor];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null) return sortDirection === "asc" ? -1 : 1;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  })();

  const handleSort = (columnName: string) => {
    if (sortColumn === columnName) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumn(null);
        setSortDirection(null);
      }
    } else {
      setSortColumn(columnName);
      setSortDirection("asc");
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const result = await importProveedores(fd);
      if (result.success) {
        toast.success(`Se importaron ${result.inserted} proveedores`);
        if (result.errors && result.errors.length > 0) {
          toast.warning(`${result.errors.length} filas tuvieron errores`);
        }
        await loadData();
      } else {
        toast.error(result.error || "Error al importar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleExport = async () => {
    const result = await exportProveedoresXlsx();
    if (result.success && result.base64) {
      const byteCharacters = atob(result.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "proveedores-export.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Exportado exitosamente");
    } else {
      toast.error(result.error || "Error al exportar");
    }
  };

  const openAddDialog = () => {
    setEditingProveedor(null);
    setFormData({ codigo: "", nombre: "", tipo: "" });
    setIsDialogOpen(true);
  };

  const openEditDialog = (p: Proveedor) => {
    setEditingProveedor(p);
    setFormData({
      codigo: String(p.codigo),
      nombre: p.nombre,
      tipo: p.tipo || "",
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.codigo || !formData.nombre.trim()) {
      toast.error("Código y nombre son obligatorios");
      return;
    }

    setIsSaving(true);
    try {
      if (editingProveedor) {
        const result = await editProveedor(editingProveedor.id!, {
          codigo: Number(formData.codigo),
          nombre: formData.nombre.trim(),
          tipo: formData.tipo.trim(),
        });
        if (result.success) {
          toast.success("Proveedor actualizado");
          setIsDialogOpen(false);
          await loadData();
        } else {
          toast.error(result.error || "Error al actualizar");
        }
      } else {
        const result = await addProveedor({
          codigo: Number(formData.codigo),
          nombre: formData.nombre.trim(),
          tipo: formData.tipo.trim(),
        });
        if (result.success) {
          toast.success("Proveedor agregado");
          setIsDialogOpen(false);
          await loadData();
        } else {
          toast.error(result.error || "Error al agregar");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const result = await removeProveedor(id);
      if (result.success) {
        toast.success("Proveedor eliminado");
        await loadData();
      } else {
        toast.error(result.error || "Error al eliminar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    }
  };

  const handleToggleSkipAi = async (id: number, currentValue: boolean) => {
    const newValue = !currentValue;
    // Optimistic update
    setProveedores((prev) =>
      prev.map((p) => (p.id === id ? { ...p, skip_ai: newValue } : p))
    );
    try {
      const result = await toggleSkipAi(id, newValue);
      if (!result.success) {
        // Revert on error
        setProveedores((prev) =>
          prev.map((p) => (p.id === id ? { ...p, skip_ai: currentValue } : p))
        );
        toast.error(result.error || "Error al actualizar");
      }
    } catch (err) {
      setProveedores((prev) =>
        prev.map((p) => (p.id === id ? { ...p, skip_ai: currentValue } : p))
      );
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    try {
      const result = await removeAllProveedores();
      if (result.success) {
        toast.success(
          `Se eliminaron ${result.deletedCount} proveedores`
        );
        await loadData();
      } else {
        toast.error(result.error || "Error al eliminar proveedores");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error al eliminar proveedores"
      );
    } finally {
      setIsDeletingAll(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Cargando proveedores...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Top Bar */}
      <header className="shrink-0 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Volver
              </Button>
            </Link>
            <div className="h-5 w-px bg-border" />
            <Users className="h-5 w-5 text-primary" />
            <span className="font-semibold">Proveedores</span>
            <span className="text-sm text-muted-foreground">
              {proveedores.length} registros
            </span>
          </div>

          <div className="flex items-center gap-2">
            {proveedores.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                    disabled={isDeletingAll}
                  >
                    {isDeletingAll ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="ml-2">Eliminar todos</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Eliminar todos los proveedores
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      ¿Estás seguro de que querés eliminar los{" "}
                      <strong>{proveedores.length}</strong> proveedores
                      cargados? Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteAll}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Eliminar todos
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleImportClick}
              disabled={isImporting}
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span className="ml-2">Importar</span>
            </Button>

            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span className="ml-2">Exportar</span>
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={openAddDialog}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
            >
              <Plus className="h-4 w-4" />
              <span className="ml-2">Agregar</span>
            </Button>
          </div>
        </div>

        {/* Search bar */}
        <div className="mt-2 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por código, nombre o tipo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
        </div>
      </header>

      {/* Table */}
      <main className="flex-1 overflow-auto">
        <div className="min-w-full">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-muted z-10">
              <tr>
                {[
                  { key: "codigo", label: "Código" },
                  { key: "nombre", label: "Nombre" },
                  { key: "tipo", label: "Tipo (magma / magmaxmagma)" },
                  { key: "skip_ai", label: "Omitir IA" },
                ].map((col) => {
                  const isCurrentSort = sortColumn === col.key;
                  return (
                    <th
                      key={col.key}
                      className="border-b border-border px-4 py-3 text-left font-medium text-foreground whitespace-nowrap cursor-pointer hover:bg-muted/80 transition-colors select-none"
                      onClick={() => handleSort(col.key)}
                    >
                      <div className="flex items-center gap-2">
                        <span>{col.label}</span>
                        <span className="text-muted-foreground">
                          {isCurrentSort ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="h-4 w-4" />
                            ) : (
                              <ArrowDown className="h-4 w-4" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 opacity-30" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
                <th className="border-b border-border px-4 py-3 text-left font-medium w-32">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProveedores.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="border-b border-border px-4 py-2 font-mono">
                    {p.codigo}
                  </td>
                  <td className="border-b border-border px-4 py-2 font-medium">
                    {p.nombre}
                  </td>
                  <td className="border-b border-border px-4 py-2 text-muted-foreground">
                    {p.tipo || "-"}
                  </td>
                  <td className="border-b border-border px-4 py-2">
                    <div className="flex items-center justify-center">
                      <Switch
                        checked={!!p.skip_ai}
                        onCheckedChange={() => handleToggleSkipAi(p.id!, !!p.skip_ai)}
                      />
                    </div>
                  </td>
                  <td className="border-b border-border px-4 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => openEditDialog(p)}
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Eliminar proveedor</AlertDialogTitle>
                            <AlertDialogDescription>
                              ¿Estás seguro de que querés eliminar a {p.nombre} (Código: {p.codigo})?
                              Esta acción no se puede deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(p.id!)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sortedProveedores.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
              <Users className="h-12 w-12 opacity-30" />
              <p>
                {searchQuery
                  ? "No se encontraron proveedores con esa búsqueda"
                  : "No hay proveedores cargados. Importá un archivo o agregá uno manualmente."}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProveedor ? "Editar Proveedor" : "Agregar Proveedor"}
            </DialogTitle>
            <DialogDescription>
              {editingProveedor
                ? "Modificá los datos del proveedor."
                : "Completá los datos para agregar un nuevo proveedor."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="codigo">Código *</Label>
              <Input
                id="codigo"
                type="number"
                placeholder="Ej: 1001"
                value={formData.codigo}
                onChange={(e) =>
                  setFormData({ ...formData, codigo: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                placeholder="Ej: JAZMIN CHEBAR"
                value={formData.nombre}
                onChange={(e) =>
                  setFormData({ ...formData, nombre: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo (magma / magmaxmagma)</Label>
              <Input
                id="tipo"
                placeholder="Ej: Magmaxmagma"
                value={formData.tipo}
                onChange={(e) =>
                  setFormData({ ...formData, tipo: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editingProveedor ? "Guardar Cambios" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
