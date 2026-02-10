"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  exportXlsx,
  type TableData,
} from "./actions";
import { getColumnDisplayName, TABLE_COLUMN_ORDER } from "@/lib/column-mapping";
import { Progress } from "@/components/ui/progress";
import { Database, Upload, RefreshCw, Download, AlertCircle, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Trash2, Sparkles, Square, FolderSync, Image, Settings, Users } from "lucide-react";
import Link from "next/link";
import { PromptConfig } from "@/components/prompt-config";
import { DescriptionVariantsModal } from "@/components/description-variants-modal";
import { Login } from "@/components/login";

// Sort direction type
type SortDirection = "asc" | "desc" | null;

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
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

  // AI Processing state
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [processingStats, setProcessingStats] = useState<{
    total: number;
    processed: number;
    success: number;
    errors: number;
    skipped?: number;
    currentBatch: number;
    totalBatches: number;
    lastError: string;
    withImage?: number;
    withoutImage?: number;
  } | null>(null);

  // Prompt config state
  const [isPromptConfigOpen, setIsPromptConfigOpen] = useState(false);

  // Description variants modal state
  const [isVariantsModalOpen, setIsVariantsModalOpen] = useState(false);
  const [currentVariantsProduct, setCurrentVariantsProduct] = useState<{
    description: string;
    productData: any;
    primaryKey: string | number;
  } | null>(null);

  // Image indexing state
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedImageCount, setIndexedImageCount] = useState<number>(0);

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

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/auth/check");
        const data = await response.json();
        if (data.authenticated) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    checkAuth();
  }, []);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
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
    const result = await exportXlsx();
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
      link.download = result.filename || "export.xlsx";
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
    if (result.success) {
      // Recargar datos automáticamente después de actualizar
      await loadData(false);
      toast.success("Celda actualizada");
    } else {
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

  const handleOpenVariantsModal = (
    description: string,
    primaryKey: string | number,
    rowData: any
  ) => {
    // Convert row data to ProductData format
    const productData = {
      proveedor: rowData.proveedor,
      modelo: rowData.modelo,
      descripcion: rowData.descripcion,
      composicion: rowData.composicion,
      nuevo: rowData.nuevo,
      preventa: rowData.preventa,
      sale: rowData.sale,
      outlet: rowData.outlet,
      repite_color: rowData.repite_color,
      prioridad: rowData.prioridad,
      video: rowData.video,
      imagen: rowData.imagen,
    };

    setCurrentVariantsProduct({
      description: description || "",
      productData,
      primaryKey,
    });
    setIsVariantsModalOpen(true);
  };

  // Fetch indexed image count on load
  useEffect(() => {
    const fetchIndexedCount = async () => {
      try {
        const response = await fetch("/api/index-images");
        const data = await response.json();
        setIndexedImageCount(data.dbCount || 0);
      } catch {
        // Ignore errors
      }
    };
    fetchIndexedCount();
  }, []);

  // Image indexing handler
  const handleStartIndexing = async () => {
    setIsIndexing(true);
    try {
      const response = await fetch("/api/index-images", { method: "POST" });
      const data = await response.json();

      if (data.success) {
        toast.success("Indexado de imágenes iniciado");

        // Poll for completion
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch("/api/index-images");
          const statusData = await statusRes.json();
          setIndexedImageCount(statusData.dbCount || 0);

          if (!statusData.isIndexing) {
            clearInterval(pollInterval);
            setIsIndexing(false);
            toast.success(`Indexado completado: ${statusData.dbCount} imágenes`);
          }
        }, 3000);
      } else {
        toast.error(data.message || "Error al iniciar indexado");
        setIsIndexing(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al indexar");
      setIsIndexing(false);
    }
  };

  // Play completion sound - Doble Ping
  const playCompletionSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const frequencies = [700, 900];
      const startTime = audioContext.currentTime;
      
      frequencies.forEach((freq, idx) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const noteStart = startTime + (idx * 0.1);
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.3, noteStart + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.01, noteStart + 0.15);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(noteStart);
        osc.stop(noteStart + 0.15);
      });
    } catch (err) {
      console.error("Error playing completion sound:", err);
    }
  }, []);

  // AI Processing handlers
  const pollProcessingStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const data = await response.json();
      setProcessingStats(data.stats);
      return data.isProcessing;
    } catch {
      return false;
    }
  }, []);

  const handleStartProcessing = async () => {
    setIsProcessingAI(true);
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          action: "start"
        }),
      });
      const data = await response.json();

      if (data.success) {
        toast.success("Procesamiento IA iniciado");

        // Start polling for status
        const pollInterval = setInterval(async () => {
          const stillProcessing = await pollProcessingStatus();
          if (!stillProcessing) {
            clearInterval(pollInterval);
            setIsProcessingAI(false);
            await loadData();
            toast.success("Procesamiento IA completado");
            // Play completion sound
            playCompletionSound();
          }
        }, 2000);
      } else {
        toast.error(data.message || "Error al iniciar procesamiento");
        setIsProcessingAI(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al iniciar procesamiento");
      setIsProcessingAI(false);
    }
  };

  const handleStopProcessing = async () => {
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await response.json();

      if (data.success) {
        toast.success("Procesamiento detenido");
        setIsProcessingAI(false);
        await loadData();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al detener procesamiento");
    }
  };

  // Show login if not authenticated
  if (isCheckingAuth) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Verificando autenticación...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

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
        accept=".xlsx,.xls,.csv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Minimal Top Bar */}
      <header className="shrink-0 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-primary" />
            <span className="font-semibold">{tableData?.tableName || "Productos"}</span>
            <span className="text-sm text-muted-foreground">
              {tableData?.rows.length || 0} filas
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/proveedores">
              <Button
                variant="outline"
                size="sm"
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              >
                <Users className="h-4 w-4" />
                <span className="ml-2">Proveedores</span>
              </Button>
            </Link>

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

             {/* Image Indexing Button */}
             <Button
              variant="outline"
              size="sm"
              onClick={handleStartIndexing}
              disabled={isIndexing}
              className="text-cyan-600 hover:text-cyan-700 hover:bg-cyan-50"
            >
              {isIndexing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderSync className="h-4 w-4" />
              )}
              <span className="ml-2">
                {isIndexing ? "Indexando..." : `Indexar (${indexedImageCount})`}
              </span>
            </Button>

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

            {/* AI Processing Button */}
            {isProcessingAI ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopProcessing}
                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              >
                <Square className="h-4 w-4" />
                <span className="ml-2">Detener IA</span>
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleStartProcessing}
                disabled={!tableData?.rows.length}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
              >
                <Sparkles className="h-4 w-4" />
                <span className="ml-2">Procesar IA</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPromptConfigOpen(true)}
              className="text-muted-foreground hover:text-foreground"
              title="Configurar prompt de IA"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* AI Processing Progress Bar */}
        {isProcessingAI && processingStats && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                <span className="text-sm font-medium">
                  Procesando con IA... Lote {processingStats.currentBatch} de {processingStats.totalBatches}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">
                {processingStats.processed} / {processingStats.total} productos
              </span>
            </div>
            <Progress
              value={processingStats.total > 0 ? (processingStats.processed / processingStats.total) * 100 : 0}
              className="h-2"
            />
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="text-green-600">Exitosos: {processingStats.success}</span>
                {(processingStats.withImage ?? 0) > 0 && (
                  <span className="text-cyan-600 flex items-center gap-1">
                    <Image className="h-3 w-3" />
                    {processingStats.withImage}
                  </span>
                )}
                {(processingStats.skipped ?? 0) > 0 && (
                  <span className="text-gray-500">Omitidos: {processingStats.skipped}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {processingStats.errors > 0 && (
                  <span className="text-red-600">Errores: {processingStats.errors}</span>
                )}
                {processingStats.lastError && (
                  <span className="text-red-500 truncate max-w-[200px]" title={processingStats.lastError}>
                    Ultimo error: {processingStats.lastError}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Prompt Config Dialog */}
      <PromptConfig
        open={isPromptConfigOpen}
        onOpenChange={setIsPromptConfigOpen}
        onSave={() => {
          toast.success("Prompt guardado exitosamente");
        }}
      />

      {/* Description Variants Modal */}
      {currentVariantsProduct && (
        <DescriptionVariantsModal
          open={isVariantsModalOpen}
          onOpenChange={setIsVariantsModalOpen}
          originalDescription={currentVariantsProduct.description}
          product={currentVariantsProduct.productData}
          onSave={(selectedVariant) => {
            handleCellUpdate(
              currentVariantsProduct.primaryKey,
              "descripcion_eshop",
              selectedVariant
            );
          }}
        />
      )}

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
                    const isDescriptionEshop = col.name === "descripcion_eshop";

                    return (
                      <th
                        key={col.name}
                        className={`border-b border-border px-4 py-3 text-left font-medium text-foreground whitespace-nowrap cursor-pointer hover:bg-muted/80 transition-colors select-none ${
                          isDescriptionEshop ? "min-w-[500px] max-w-[800px]" : ""
                        }`}
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
                          className={`border-b border-border px-4 py-2 ${
                            col.name === "descripcion_eshop" ? "min-w-[500px] max-w-[800px]" : ""
                          }`}
                        >
                          {col.name === "descripcion_eshop" ? (
                            <EditableDescriptionCell
                              value={row[col.name]}
                              onSave={(newValue) =>
                                handleCellUpdate(primaryKeyValue as string | number, col.name, newValue)
                              }
                              onOpenVariantsModal={() =>
                                handleOpenVariantsModal(String(row[col.name] || ""), primaryKeyValue as string | number, row)
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
                No hay datos en la tabla. Importá un archivo Excel (.xlsx) para agregar productos.
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
      className="cursor-pointer min-h-6 truncate max-w-[300px]"
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

// Special editable cell for description eshop with better formatting
function EditableDescriptionCell({
  value,
  onSave,
  onOpenVariantsModal,
}: {
  value: string | number | boolean | null;
  onSave: (value: string) => void;
  onOpenVariantsModal: () => void;
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
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd + Enter to save
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
      <textarea
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        autoFocus
        rows={6}
        className="w-full px-3 py-2 border border-primary rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y font-sans text-sm leading-relaxed"
        placeholder="Escribí la descripción aquí..."
      />
    );
  }

  const textValue = value === null ? "" : String(value);
  const isEmpty = !textValue || textValue.trim() === "";

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="group relative cursor-pointer min-h-[80px] p-2 rounded-md hover:bg-muted/50 transition-colors"
      title="Doble clic para editar"
    >
      {/* AI Button - appears on hover */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onOpenVariantsModal();
          }}
          className="h-7 w-7 p-0 bg-violet-600 hover:bg-violet-700 text-white hover:text-white cursor-pointer border-violet-600 hover:border-violet-700 shadow-sm"
          title="Generar variantes con IA"
        >
          <Sparkles className="h-3 w-3" />
        </Button>
      </div>

      {isEmpty ? (
        <span className="text-muted-foreground italic text-sm">Sin descripción</span>
      ) : (
        <div className="text-sm leading-relaxed whitespace-normal break-words text-foreground pr-10">
          {textValue.replace(/\n+/g, ' ').trim()}
        </div>
      )}
    </div>
  );
}

