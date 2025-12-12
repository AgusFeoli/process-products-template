"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  checkConnection,
  fetchTableData,
  importCsv,
  updateCell,
  deleteRow,
  deleteAllRows,
  exportCsv,
  type TableData,
} from "./actions";
import { getColumnDisplayName, TABLE_COLUMN_ORDER } from "@/lib/column-mapping";
import { Database, Upload, RefreshCw, Download, AlertCircle, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Trash2 } from "lucide-react";

// Sort direction type
type SortDirection = "asc" | "desc" | null;

export default function Home() {
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    tableExists: boolean;
    tableName: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Order columns according to TABLE_COLUMN_ORDER
  const orderedColumns = useMemo(() => {
    if (!tableData?.columns) return [];

    const columnMap = new Map(tableData.columns.map(col => [col.name, col]));
    const ordered: typeof tableData.columns = [];

    // Add columns in the specified order
    for (const colName of TABLE_COLUMN_ORDER) {
      const col = columnMap.get(colName);
      if (col) {
        ordered.push(col);
        columnMap.delete(colName);
      }
    }

    // Add any remaining columns not in the order list (like id/primary key)
    for (const col of columnMap.values()) {
      ordered.push(col);
    }

    return ordered;
  }, [tableData?.columns]);

  // Handle column header click for sorting
  const handleSort = (columnName: string) => {
    if (sortColumn === columnName) {
      // Cycle through: asc -> desc -> null
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

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (!tableData?.rows || !sortColumn || !sortDirection) {
      return tableData?.rows || [];
    }

    return [...tableData.rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null) return sortDirection === "asc" ? -1 : 1;

      // Compare values
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [tableData?.rows, sortColumn, sortDirection]);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsRefreshing(true);
    setError(null);

    try {
      const result = await fetchTableData();
      if (result.success && result.data) {
        setTableData(result.data);
      } else {
        setError(result.error || "Failed to load data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const status = await checkConnection();
      setConnectionStatus(status);

      if (status.connected && status.tableExists) {
        await loadData(false);
      } else {
        setIsLoading(false);
        if (!status.connected) {
          setError("Cannot connect to database. Check DATABASE_URL in .env");
        } else if (!status.tableExists) {
          setError(`Table "${status.tableName}" does not exist. Set TARGET_TABLE in .env`);
        }
      }
    };
    init();
  }, [loadData]);

  const handleRefresh = async () => {
    await loadData();
    toast.success("Datos actualizados");
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    try {
      const result = await deleteAllRows();
      if (result.success) {
        toast.success(`Se eliminaron ${result.deletedCount} filas`);
        await loadData();
      } else {
        toast.error(result.error || "Error al eliminar las filas");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar las filas");
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await importCsv(formData);
      if (result.success) {
        toast.success(`Se importaron ${result.inserted} productos`);
        if (result.errors && result.errors.length > 0) {
          toast.warning(`${result.errors.length} filas tuvieron errores`);
        }
        await loadData();
      } else {
        toast.error(result.error || "Error en la importacion");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en la importacion");
    } finally {
      setIsImporting(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleExport = async () => {
    const result = await exportCsv();
    if (result.success && result.csv) {
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Exportado exitosamente");
    } else {
      toast.error(result.error || "Error en la exportacion");
    }
  };

  const handleCellUpdate = async (
    primaryKeyValue: string | number,
    columnName: string,
    value: string
  ) => {
    const result = await updateCell(primaryKeyValue, columnName, value);
    if (!result.success) {
      toast.error(result.error || "Error al actualizar");
    }
  };

  const handleDeleteRow = async (primaryKeyValue: string | number) => {
    const result = await deleteRow(primaryKeyValue);
    if (result.success) {
      toast.success("Fila eliminada");
      await loadData();
    } else {
      toast.error(result.error || "Error al eliminar");
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Conectando a la base de datos...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !tableData) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">Error de Conexion</h2>
          <p className="text-muted-foreground">{error}</p>
          <div className="bg-muted p-4 rounded-lg text-left w-full">
            <p className="text-sm font-mono text-muted-foreground">
              DATABASE_URL=postgresql://user:pass@host:5432/db
              <br />
              TARGET_TABLE=products
            </p>
          </div>
          <Button onClick={() => window.location.reload()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
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
        accept=".csv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Minimal Top Bar */}
      <header className="flex-shrink-0 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold">{tableData?.tableName || "Productos"}</span>
            <span className="text-sm text-muted-foreground">
              {tableData?.rows.length || 0} filas
            </span>
          </div>

          <div className="flex items-center gap-2">
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

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeletingAll || !tableData?.rows.length}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {isDeletingAll ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  <span className="ml-2">Eliminar Todo</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Eliminar todas las filas</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta accion eliminara permanentemente todas las {tableData?.rows.length || 0} filas de la tabla. Esta accion no se puede deshacer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Eliminar Todo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span className="ml-2">Actualizar</span>
            </Button>

            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4" />
              <span className="ml-2">Exportar</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Full-screen Table */}
      <main className="flex-1 overflow-auto">
        {tableData && tableData.columns.length > 0 ? (
          <div className="min-w-full">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-muted z-10">
                <tr>
                  {orderedColumns.map((col) => {
                    const displayName = getColumnDisplayName(col.name);
                    const isCurrentSort = sortColumn === col.name;

                    return (
                      <th
                        key={col.name}
                        className="border-b border-border px-4 py-3 text-left font-medium text-foreground whitespace-nowrap cursor-pointer hover:bg-muted/80 transition-colors select-none"
                        onClick={() => handleSort(col.name)}
                      >
                        <div className="flex items-center gap-2">
                          <span>{displayName}</span>
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
                  <th className="border-b border-border px-4 py-3 text-left font-medium w-20">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, rowIndex) => {
                  const primaryKeyValue = tableData.primaryKey
                    ? row[tableData.primaryKey]
                    : rowIndex;

                  return (
                    <tr
                      key={rowIndex}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      {orderedColumns.map((col) => (
                        <td
                          key={col.name}
                          className="border-b border-border px-4 py-2"
                        >
                          {col.name === "ia" ? (
                            <BooleanCell
                              value={row[col.name]}
                              onSave={(newValue) =>
                                handleCellUpdate(primaryKeyValue as string | number, col.name, newValue)
                              }
                            />
                          ) : (
                            <EditableCell
                              value={row[col.name]}
                              onSave={(newValue) =>
                                handleCellUpdate(primaryKeyValue as string | number, col.name, newValue)
                              }
                            />
                          )}
                        </td>
                      ))}
                      <td className="border-b border-border px-4 py-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteRow(primaryKeyValue as string | number)}
                        >
                          Eliminar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {tableData.rows.length === 0 && (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                No hay datos en la tabla. Importa un CSV para agregar productos.
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            No se encontraron columnas en la tabla.
          </div>
        )}
      </main>
    </div>
  );
}

// Editable cell component
function EditableCell({
  value,
  onSave,
}: {
  value: string | number | boolean | null;
  onSave: (value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value ?? ""));

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditValue(String(value ?? ""));
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue !== String(value ?? "")) {
      onSave(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setIsEditing(false);
      if (editValue !== String(value ?? "")) {
        onSave(editValue);
      }
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(String(value ?? ""));
    }
  };

  if (isEditing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
        className="w-full px-2 py-1 border border-primary rounded bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="cursor-pointer min-h-[1.5rem] truncate max-w-[300px]"
      title={String(value ?? "")}
    >
      {value === null ? (
        <span className="text-muted-foreground italic">null</span>
      ) : (
        String(value)
      )}
    </div>
  );
}

// Boolean cell component for 'ia' column
function BooleanCell({
  value,
  onSave,
}: {
  value: string | number | boolean | null;
  onSave: (value: string) => void;
}) {
  // Parse value to boolean
  const boolValue = value === true || value === "true" || value === "1" || value === 1;

  const handleChange = (checked: boolean) => {
    onSave(checked ? "true" : "false");
  };

  return (
    <div className="flex items-center justify-center">
      <Checkbox
        checked={boolValue}
        onCheckedChange={handleChange}
        className="h-5 w-5"
      />
    </div>
  );
}
