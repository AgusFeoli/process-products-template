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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  checkConnection,
  fetchMaestraData,
  fetchMagentoData,
  fetchKeywordStatus,
  fetchSystemPrompt,
  updateSystemPrompt,
  resetSystemPrompt,
  updateCell,
  deleteRow,
  deleteAllRows,
  exportCsv,
  exportMagentoCsv,
  updateMagentoField,
  updateMagentoConfig,
  deleteMagentoView,
  fetchColumnMeta,
  fetchIdentifierColumn,
  updateIdentifierColumn,
  fetchMagentoConfig,
  type MaestraProduct,
  type MagentoProduct,
  type ColumnMeta,
  type MagentoConfig,
} from "./actions";
import {
  getMaestraDisplayName,
} from "@/lib/maestra-columns";
import { createDefaultView, manualDbColumn } from "@/lib/magento-config";
import { MagentoConfigDialog } from "@/components/magento-config-dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  RefreshCw,
  Download,
  AlertCircle,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Trash2,
  Search,
  X,
  FileSpreadsheet,
  CheckCircle2,
  Sparkles,
  Database,
  ShoppingCart,
  Tags,
  Settings,
  RotateCcw,
  Save,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Square,
  Plus,
} from "lucide-react";
import { Login } from "@/components/login";
import {
  AIReviewDialog,
  type AiProductChange,
  type AiColumnDef,
} from "@/components/ai-review-dialog";

type SortDirection = "asc" | "desc" | null;
/** Active view id: "maestra" or a magento view id. */
type DatasetView = string;

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [products, setProducts] = useState<MaestraProduct[]>([]);
  const [magentoProducts, setMagentoProducts] = useState<MagentoProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dataset view
  const [activeView, setActiveView] = useState<DatasetView>("maestra");

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    status: string;
    inserted?: number;
    total?: number;
  } | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importMode, setImportMode] = useState<"replace" | "append">("replace");

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Row selection (works for both views)
  const [selectedMaestraRows, setSelectedMaestraRows] = useState<Set<number>>(new Set());
  const [selectedMagentoRows, setSelectedMagentoRows] = useState<Set<number>>(new Set());

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // AI generation state
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiJobId, setAiJobId] = useState<string | null>(null);
  const [aiJobProgress, setAiJobProgress] = useState<{
    processed: number;
    total: number;
    successful: number;
    failed: number;
  } | null>(null);
  const aiPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard to ensure completion toast fires exactly once
  const aiCompletedRef = useRef(false);

  // AI review dialog state
  const [showAiReview, setShowAiReview] = useState(false);
  const [pendingAiChanges, setPendingAiChanges] = useState<AiProductChange[]>([]);
  const [pendingAiColumns, setPendingAiColumns] = useState<AiColumnDef[]>([]);

  // Keywords state
  const [keywordStatus, setKeywordStatus] = useState<{ loaded: boolean; count: number }>({ loaded: false, count: 0 });
  const [isUploadingKeywords, setIsUploadingKeywords] = useState(false);
  const keywordFileInputRef = useRef<HTMLInputElement>(null);

  // System prompt state
  const [showPromptDialog, setShowPromptDialog] = useState(false);
  const [systemPromptText, setSystemPromptText] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);

  // Dynamic column metadata (from imported file headers)
  const [columnMeta, setColumnMeta] = useState<ColumnMeta[] | null>(null);

  // Identifier column: the dbColumn chosen by the user to represent each product
  // in AI preview/diff. null means "use the internal row id".
  const [identifierColumn, setIdentifierColumn] = useState<string | null>(null);

  // Identifier picker dialog state (shown after a successful upload)
  const [showIdentifierPicker, setShowIdentifierPicker] = useState(false);
  const [identifierPickerValue, setIdentifierPickerValue] = useState<string>("__none__");
  const [isSavingIdentifier, setIsSavingIdentifier] = useState(false);

  // Magento configurable export schema (multi-view)
  const [magentoConfig, setMagentoConfig] = useState<MagentoConfig>({ views: [] });
  const [showMagentoConfig, setShowMagentoConfig] = useState(false);
  const [configuringViewId, setConfiguringViewId] = useState<string | null>(null);
  const [isCreatingView, setIsCreatingView] = useState(false);

  // Generic confirmation dialog state (replaces native browser confirm())
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const askConfirm = useCallback(
    (title: string, description: string, onConfirm: () => void) => {
      setConfirmDialog({ open: true, title, description, onConfirm });
    },
    []
  );

  // Current magento view (if any)
  const activeMagentoView = useMemo(() => {
    if (activeView === "maestra") return null;
    return magentoConfig.views.find((v) => v.id === activeView) ?? null;
  }, [activeView, magentoConfig]);

  const isMagentoView = activeMagentoView !== null;

  // Visible columns for current view
  const visibleColumns = useMemo(() => {
    if (activeMagentoView) {
      // Only show columns that the user has manually added to this view
      return activeMagentoView.columns
        .filter((c) => c.source.type !== "fixed")
        .map((c) =>
          c.source.type === "manual"
            ? manualDbColumn(activeMagentoView.id, c.id)
            : `__maestra__:${(c.source as { type: "maestra"; maestraColumn: string }).maestraColumn}`
        );
    }
    // Use dynamic column metadata if available
    if (columnMeta && columnMeta.length > 0) {
      return columnMeta.map((m) => m.dbColumn);
    }
    // Fallback: derive columns from product data (excluding system columns)
    if (products.length > 0) {
      return Object.keys(products[0]).filter(
        (k) => k !== "id" && k !== "created_at" && k !== "updated_at"
      );
    }
    return [];
  }, [activeMagentoView, columnMeta, products]);

  const getDisplayName = useCallback(
    (col: string) => {
      if (activeMagentoView) {
        if (col.startsWith("__maestra__:")) {
          const maestraCol = col.slice("__maestra__:".length);
          const match = activeMagentoView.columns.find(
            (c) => c.source.type === "maestra" && c.source.maestraColumn === maestraCol
          );
          return match?.name ?? maestraCol;
        }
        const match = activeMagentoView.columns.find(
          (c) => c.source.type === "manual" && manualDbColumn(activeMagentoView.id, c.id) === col
        );
        return match?.name ?? col;
      }
      return getMaestraDisplayName(col, columnMeta ?? undefined);
    },
    [activeMagentoView, columnMeta]
  );

  // Handle column header click for sorting
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

  // Check authentication
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

  // Current dataset rows
  const currentRows = useMemo(() => {
    if (isMagentoView) {
      // Merge maestra values into each magento row under "__maestra__:<col>" keys
      // so the table can show them alongside manual columns.
      const maestraMap = new Map<number, MaestraProduct>();
      for (const p of products) {
        if (p.id != null) maestraMap.set(p.id as number, p);
      }
      return magentoProducts.map((mg) => {
        const merged: Record<string, unknown> = { ...(mg as unknown as Record<string, unknown>) };
        const maestra = maestraMap.get(mg.maestra_id);
        if (maestra) {
          for (const [k, v] of Object.entries(maestra)) {
            merged[`__maestra__:${k}`] = v;
          }
        }
        return merged;
      });
    }
    return products as unknown as Record<string, unknown>[];
  }, [isMagentoView, products, magentoProducts]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let rows = currentRows;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      rows = rows.filter((row) => {
        return Object.values(row).some((val) => {
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(q);
        });
      });
    }

    return rows;
  }, [currentRows, searchQuery]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return filteredRows;
    }

    return [...filteredRows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === "asc" ? 1 : -1;
      if (bVal === null) return sortDirection === "asc" ? -1 : 1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [filteredRows, sortColumn, sortDirection]);

  // Active selection set for current view
  const selectedRows = isMagentoView ? selectedMagentoRows : selectedMaestraRows;
  const setSelectedRows = isMagentoView ? setSelectedMagentoRows : setSelectedMaestraRows;

  // Pagination: compute page slice from sortedRows
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  // Reset page when search/sort/view change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeView, sortColumn, sortDirection]);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsRefreshing(true);
    setError(null);

    try {
      const [maestraResult, kwStatus, colMeta, mgConfig, identifier] = await Promise.all([
        fetchMaestraData(),
        fetchKeywordStatus(),
        fetchColumnMeta(),
        fetchMagentoConfig(),
        fetchIdentifierColumn(),
      ]);

      if (maestraResult.success && maestraResult.data) {
        setProducts(maestraResult.data);
      } else {
        setError(maestraResult.error || "Failed to load data");
      }

      setKeywordStatus(kwStatus);
      if (colMeta) {
        setColumnMeta(colMeta);
      }
      setMagentoConfig(mgConfig);
      setIdentifierColumn(identifier);
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
      if (status.connected && status.tableExists) {
        await loadData(false);
      } else {
        setIsLoading(false);
        if (!status.connected) {
          setError("Cannot connect to database. Check DATABASE_URL in .env");
        }
      }
    };
    init();
  }, [loadData]);

  // Load magento products when active view changes to a magento view
  const loadViewProducts = useCallback(async (viewId: string) => {
    const result = await fetchMagentoData(viewId);
    if (result.success && result.data) {
      setMagentoProducts(result.data);
    }
  }, []);

  useEffect(() => {
    if (activeView !== "maestra" && magentoConfig.views.some((v) => v.id === activeView)) {
      loadViewProducts(activeView);
    }
  }, [activeView, magentoConfig, loadViewProducts]);

  const handleRefresh = async () => {
    await loadData();
    if (activeView !== "maestra") {
      await loadViewProducts(activeView);
    }
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
        toast.error(result.error || "Error al eliminar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleImportClick = () => {
    if (products.length > 0) {
      setShowImportConfirm(true);
    } else {
      setImportMode("replace");
      fileInputRef.current?.click();
    }
  };

  const handleImportConfirmed = (mode: "replace" | "append") => {
    setImportMode(mode);
    setShowImportConfirm(false);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress({ status: "Procesando archivo..." });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", importMode);

      const response = await fetch("/api/upload-maestra", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        setUploadProgress({
          status: "Completado",
          inserted: data.inserted,
          total: data.total,
        });
        toast.success(data.message);
        if (data.errorCount > 0) {
          toast.warning(`${data.errorCount} filas tuvieron errores`);
        }
        await loadData();
        // After a successful import, ask the user to pick the identifier column.
        // Seed the picker with the currently persisted choice (or "__none__").
        const currentIdentifier = await fetchIdentifierColumn();
        setIdentifierPickerValue(currentIdentifier ?? "__none__");
        setShowIdentifierPicker(true);
      } else {
        toast.error(data.message || "Error al importar");
        setUploadProgress(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar");
      setUploadProgress(null);
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(null), 3000);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSaveIdentifierColumn = async () => {
    setIsSavingIdentifier(true);
    try {
      const chosen = identifierPickerValue === "__none__" ? null : identifierPickerValue;
      const result = await updateIdentifierColumn(chosen);
      if (result.success) {
        setIdentifierColumn(chosen);
        setShowIdentifierPicker(false);
        toast.success(
          chosen
            ? "Columna identificadora guardada"
            : "Se usará el identificador interno"
        );
      } else {
        toast.error(result.error || "Error al guardar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSavingIdentifier(false);
    }
  };

  const handleExportMaestra = async () => {
    const ids = selectedMaestraRows.size > 0 ? Array.from(selectedMaestraRows) : undefined;
    const result = await exportCsv(ids);
    if (result.success && result.csv) {
      const blob = new Blob(["\uFEFF" + result.csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const msg = ids ? `${ids.length} productos exportados` : "Maestra exportada exitosamente";
      toast.success(msg);
    } else {
      toast.error(result.error || "Error al exportar");
    }
  };

  const handleExportMagento = async () => {
    if (!activeMagentoView) {
      toast.error("Selecciona una vista Magento primero");
      return;
    }
    const ids = selectedMagentoRows.size > 0 ? Array.from(selectedMagentoRows) : undefined;
    const result = await exportMagentoCsv(activeMagentoView.id, ids);
    if (result.success && result.csv) {
      const blob = new Blob(["\uFEFF" + result.csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || "magento-export.csv";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      const msg = ids ? `${ids.length} productos exportados` : "Magento CSV exportado exitosamente";
      toast.success(msg);
    } else {
      toast.error(result.error || "Error al exportar Magento CSV");
    }
  };

  const handleKeywordFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingKeywords(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload-keywords", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        setKeywordStatus({ loaded: true, count: data.inserted });
      } else {
        toast.error(data.message || "Error al importar keywords");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar keywords");
    } finally {
      setIsUploadingKeywords(false);
      if (keywordFileInputRef.current) {
        keywordFileInputRef.current.value = "";
      }
    }
  };

  // System prompt handlers
  const handleOpenPromptDialog = async () => {
    setShowPromptDialog(true);
    setIsLoadingPrompt(true);
    try {
      const prompt = await fetchSystemPrompt();
      setSystemPromptText(prompt);
    } catch {
      toast.error("Error al cargar el system prompt");
    } finally {
      setIsLoadingPrompt(false);
    }
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    try {
      const result = await updateSystemPrompt(systemPromptText);
      if (result.success) {
        toast.success("System prompt guardado");
        setShowPromptDialog(false);
      } else {
        toast.error(result.error || "Error al guardar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setIsSavingPrompt(true);
    try {
      const result = await resetSystemPrompt();
      if (result.success) {
        setSystemPromptText(result.prompt);
        toast.success("System prompt restaurado al original");
      } else {
        toast.error(result.error || "Error al restaurar");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al restaurar");
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleCellUpdate = async (
    id: number,
    columnName: string,
    value: string
  ) => {
    if (isMagentoView) {
      // Maestra-backed Magento columns are read-only (they reflect maestra data)
      if (columnName.startsWith("__maestra__:")) {
        toast.error("Esta columna viene de la maestra y no se edita aquí");
        return;
      }
      const result = await updateMagentoField(activeMagentoView!.id, id, columnName, value);
      if (result.success) {
        await loadViewProducts(activeMagentoView!.id);
        toast.success("Celda actualizada");
      } else {
        toast.error(result.error || "Error al actualizar");
      }
    } else {
      const result = await updateCell(id, columnName, value);
      if (result.success) {
        await loadData(false);
        toast.success("Celda actualizada");
      } else {
        toast.error(result.error || "Error al actualizar");
      }
    }
  };

  const handleDeleteRow = async (id: number) => {
    const result = await deleteRow(id);
    if (result.success) {
      toast.success("Fila eliminada");
      await loadData();
    } else {
      toast.error(result.error || "Error al eliminar");
    }
  };

  // Row selection handlers
  const toggleRowSelection = (id: number) => {
    setSelectedRows((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    // Select/deselect all filtered rows (not just current page)
    if (selectedRows.size === sortedRows.length && sortedRows.length > 0) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedRows.map((r) => r.id as number)));
    }
  };

  const toggleSelectPage = () => {
    // Select/deselect rows on current page only
    const pageIds = new Set(paginatedRows.map((r) => r.id as number));
    const allPageSelected = paginatedRows.length > 0 && paginatedRows.every((r) => selectedRows.has(r.id as number));
    if (allPageSelected) {
      setSelectedRows((prev: Set<number>) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedRows((prev: Set<number>) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // Stop polling for AI job
  const stopAiPolling = useCallback(() => {
    if (aiPollingRef.current) {
      clearInterval(aiPollingRef.current);
      aiPollingRef.current = null;
    }
  }, []);

  // Stop AI job processing
  const handleStopAiJob = useCallback(async () => {
    if (aiJobId) {
      // Background job — cancel via API
      try {
        const response = await fetch("/api/ai-jobs/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: aiJobId }),
        });

        const data = await response.json();

        if (data.success) {
          stopAiPolling();
          setIsGeneratingAi(false);
          setAiJobId(null);
          setAiJobProgress(null);
          aiCompletedRef.current = false;
          toast.success("Procesamiento AI detenido");
        } else {
          toast.error(data.message || "Error al detener procesamiento");
        }
      } catch (err) {
        console.error("Error stopping AI job:", err);
        toast.error("Error al detener procesamiento AI");
      }
    } else {
      // Direct API call — just reset UI state
      stopAiPolling();
      setIsGeneratingAi(false);
      setAiJobId(null);
      setAiJobProgress(null);
      aiCompletedRef.current = false;
      toast.success("Procesamiento AI detenido");
    }
  }, [aiJobId, stopAiPolling]);

  // Poll AI job status
  const pollAiJobStatus = useCallback(
    async (jobId: string) => {
      // Guard: if already handled completion, skip
      if (aiCompletedRef.current) return;

      try {
        const response = await fetch(`/api/ai-jobs/status?jobId=${jobId}`);
        const data = await response.json();

        if (!data.success || !data.job) {
          return;
        }

        const job = data.job;

        // Update progress counter (simple: processed / total)
        setAiJobProgress({
          processed: job.processedProducts,
          total: job.totalProducts,
          successful: job.successfulProducts,
          failed: job.failedProducts,
        });

        // Handle terminal states — exactly once
        if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
          // Set guard immediately to prevent duplicate handling
          aiCompletedRef.current = true;
          stopAiPolling();
          setIsGeneratingAi(false);
          setAiJobId(null);

          // Reload data once now that processing is finished
          await loadData(false);
          // Also reload the magento view products
          if (activeMagentoView) {
            await loadViewProducts(activeMagentoView.id);
          }

          if (job.status === "completed") {
            const msg = job.failedProducts > 0
              ? `AI completado: ${job.successfulProducts} exitosos, ${job.failedProducts} fallidos de ${job.totalProducts}`
              : `AI completado: ${job.successfulProducts} de ${job.totalProducts} productos procesados`;
            toast.success(msg);
          } else if (job.status === "cancelled") {
            // Stop handler already showed a toast — no duplicate here
          } else {
            toast.error("El procesamiento AI falló. Revisa los errores.");
          }

          // Clear progress UI after a short delay
          setTimeout(() => {
            setAiJobProgress(null);
          }, 3000);

          setSelectedMagentoRows(new Set());
        }
      } catch (err) {
        console.error("Error polling AI job status:", err);
      }
    },
    [loadData, loadViewProducts, activeMagentoView, stopAiPolling]
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopAiPolling();
    };
  }, [stopAiPolling]);

  // AI generation handler
  const handleAiGenerate = async (mode: "selected" | "all") => {
    if (mode === "selected" && selectedMagentoRows.size === 0) {
      toast.error("Selecciona al menos un producto");
      return;
    }

    if (!activeMagentoView) {
      toast.error("No hay una vista activa");
      return;
    }

    // Collect manual columns from the active view — these are the columns AI should fill
    const manualColumns = activeMagentoView.columns
      .filter((c) => c.source.type === "manual")
      .map((c) => ({
        dbColumn: manualDbColumn(activeMagentoView.id, c.id),
        name: c.name,
      }));

    if (manualColumns.length === 0) {
      toast.error("No hay columnas manuales para generar. Agrega columnas primero.");
      return;
    }

    const count = mode === "selected" ? selectedMagentoRows.size : magentoProducts.length;

    // Always use direct API with preview — shows review dialog before applying changes
    setIsGeneratingAi(true);
    setAiJobProgress({ processed: 0, total: count, successful: 0, failed: 0 });

    try {
      const response = await fetch("/api/generate-magento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds: mode === "selected" ? Array.from(selectedMagentoRows) : undefined,
          mode,
          columns: manualColumns,
          preview: true,
          viewId: activeMagentoView.id,
        }),
      });

      const data = await response.json();

      if (data.success && data.preview) {
        // Open review dialog with the changes
        setPendingAiChanges(data.changes as AiProductChange[]);
        setPendingAiColumns(data.columns as AiColumnDef[]);
        setShowAiReview(true);
        toast.success(`IA generó cambios para ${data.changes.length} productos. Revisá los cambios.`);
      } else if (data.success) {
        toast.success(data.message);
        await loadViewProducts(activeMagentoView.id);
        setSelectedMagentoRows(new Set());
      } else {
        toast.error(data.message || "Error al generar con AI");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al generar con AI");
    } finally {
      setIsGeneratingAi(false);
      setAiJobProgress(null);
    }
  };

  // Handle AI review dialog confirmation — apply approved changes
  const handleAiReviewConfirm = async (
    approvedChanges: { _row_id: string; fields: Record<string, string> }[],
    dbColumns: string[]
  ) => {
    try {
      const response = await fetch("/api/apply-ai-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: approvedChanges, dbColumns, viewId: activeMagentoView?.id }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        if (activeMagentoView) await loadViewProducts(activeMagentoView.id);
        setSelectedMagentoRows(new Set());
      } else {
        toast.error(data.message || "Error al aplicar cambios");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al aplicar cambios");
    } finally {
      setShowAiReview(false);
      setPendingAiChanges([]);
      setPendingAiColumns([]);
    }
  };

  // Handle AI review dialog discard
  const handleAiReviewDiscard = () => {
    setPendingAiChanges([]);
    setPendingAiColumns([]);
    toast.info("Cambios descartados");
  };

  // Reset sort/search when switching views
  const handleViewChange = (view: string) => {
    setActiveView(view);
    setSortColumn(null);
    setSortDirection(null);
    setSearchQuery("");
    setCurrentPage(1);
  };

  // Create a new magento-style view
  const handleCreateView = async () => {
    if (isCreatingView) return;
    setIsCreatingView(true);
    try {
      const nextIndex = magentoConfig.views.length + 1;
      const newView = createDefaultView(nextIndex);
      const newConfig: MagentoConfig = {
        views: [...magentoConfig.views, newView],
      };
      const result = await updateMagentoConfig(newConfig);
      if (result.success) {
        setMagentoConfig(newConfig);
        setActiveView(newView.id);
        setConfiguringViewId(newView.id);
        setShowMagentoConfig(true);
        toast.success("Vista creada");
      } else {
        toast.error(result.error || "Error al crear vista");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear vista");
    } finally {
      setIsCreatingView(false);
    }
  };

  // Delete the given magento view
  const handleDeleteView = (viewId: string) => {
    const viewName = magentoConfig.views.find((v) => v.id === viewId)?.name ?? "vista";
    askConfirm(
      `Eliminar vista "${viewName}"`,
      "Los datos manuales de esta vista se perderán. Esta acción no se puede deshacer.",
      async () => {
        const newConfig: MagentoConfig = {
          views: magentoConfig.views.filter((v) => v.id !== viewId),
        };
        try {
          // Drop the view's table first, then save the updated config
          await deleteMagentoView(viewId);
          const result = await updateMagentoConfig(newConfig);
          if (result.success) {
            setMagentoConfig(newConfig);
            if (activeView === viewId) setActiveView("maestra");
            toast.success("Vista eliminada");
          } else {
            toast.error(result.error || "Error al eliminar vista");
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Error al eliminar vista");
        }
      }
    );
  };

  // Open config dialog for the current magento view
  const handleOpenConfigForCurrentView = () => {
    if (!activeMagentoView) return;
    setConfiguringViewId(activeMagentoView.id);
    setShowMagentoConfig(true);
  };

  // Delete a single column from the active Magento view
  const handleDeleteMagentoColumn = (colName: string) => {
    if (!activeMagentoView) return;
    // Find the MagentoColumn that maps to this visible column name
    const colConfig = activeMagentoView.columns.find((c) => {
      if (c.source.type === "manual") {
        return manualDbColumn(activeMagentoView.id, c.id) === colName;
      }
      if (c.source.type === "maestra") {
        return `__maestra__:${c.source.maestraColumn}` === colName;
      }
      return false;
    });
    if (!colConfig) return;
    const displayName = colConfig.name;
    askConfirm(
      `Eliminar columna "${displayName}"`,
      "La columna será eliminada de esta vista. Esta acción no se puede deshacer.",
      async () => {
        const updatedViews = magentoConfig.views.map((v) =>
          v.id === activeMagentoView.id
            ? { ...v, columns: v.columns.filter((c) => c.id !== colConfig.id) }
            : v
        );
        const newConfig: MagentoConfig = { views: updatedViews };
        try {
          const result = await updateMagentoConfig(newConfig);
          if (result.success) {
            setMagentoConfig(newConfig);
            toast.success(`Columna "${displayName}" eliminada`);
          } else {
            toast.error(result.error || "Error al eliminar columna");
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Error al eliminar columna");
        }
      }
    );
  };

  // Auth check loading
  if (isCheckingAuth) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="text-muted-foreground">Verificando autenticacion...</p>
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
  if (error && products.length === 0) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-4">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">Error de Conexion</h2>
          <p className="text-muted-foreground">{error}</p>
          <div className="bg-muted p-4 rounded-lg text-left w-full">
            <p className="text-sm font-mono text-muted-foreground">
              DATABASE_URL=postgresql://user:pass@host:5432/db
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

  const totalRows = isMagentoView ? magentoProducts.length : products.length;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={keywordFileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleKeywordFileChange}
        className="hidden"
      />

      {/* Import confirmation modal */}
      <AlertDialog open={showImportConfirm} onOpenChange={setShowImportConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Importar archivo</AlertDialogTitle>
            <AlertDialogDescription>
              Ya existen {products.length} registros en la base de datos.
              ¿Qué deseas hacer con los datos existentes?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleImportConfirmed("append")}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
            >
              Agregar a los existentes
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => handleImportConfirmed("replace")}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reemplazar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Identifier column picker — shown after a successful maestra import */}
      <Dialog
        open={showIdentifierPicker}
        onOpenChange={(open) => {
          if (!isSavingIdentifier) setShowIdentifierPicker(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Columna identificadora</DialogTitle>
            <DialogDescription>
              Elegí qué columna de la maestra identificará a cada producto cuando
              se muestren los cambios generados por la IA. Si no elegís ninguna,
              se usará el identificador interno.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Select
              value={identifierPickerValue}
              onValueChange={setIdentifierPickerValue}
            >
              <SelectTrigger>
                <SelectValue placeholder="Elegí una columna" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  No elegir (usar identificador interno)
                </SelectItem>
                {(columnMeta ?? []).map((meta) => (
                  <SelectItem key={meta.dbColumn} value={meta.dbColumn}>
                    {meta.excelHeader}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowIdentifierPicker(false)}
              disabled={isSavingIdentifier}
            >
              Cancelar
            </Button>
            <Button onClick={handleSaveIdentifierColumn} disabled={isSavingIdentifier}>
              {isSavingIdentifier ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generic confirmation dialog (replaces native browser confirm) */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog((prev) => ({ ...prev, open: false }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirmDialog.onConfirm();
                setConfirmDialog((prev) => ({ ...prev, open: false }));
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* System Prompt Dialog */}
      <Dialog open={showPromptDialog} onOpenChange={setShowPromptDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Prompt - AI Generation
            </DialogTitle>
            <DialogDescription>
              Este prompt se usa como instruccion del sistema en cada solicitud de generacion AI.
              Define el comportamiento, tono, y reglas SEO para la generacion de campos Magento.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {isLoadingPrompt ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Textarea
                value={systemPromptText}
                onChange={(e) => setSystemPromptText(e.target.value)}
                className="w-full h-[50vh] font-mono text-sm resize-none"
                placeholder="Escribe el system prompt aqui..."
              />
            )}
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetPrompt}
              disabled={isSavingPrompt || isLoadingPrompt}
              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Restaurar Original
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPromptDialog(false)}
                disabled={isSavingPrompt}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSavePrompt}
                disabled={isSavingPrompt || isLoadingPrompt}
              >
                {isSavingPrompt ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Save className="h-4 w-4 mr-1.5" />
                )}
                Guardar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Magento Export Config Dialog */}
      <MagentoConfigDialog
        open={showMagentoConfig}
        onOpenChange={setShowMagentoConfig}
        config={magentoConfig}
        viewId={configuringViewId}
        maestraColumns={columnMeta ?? []}
        onSaved={(cfg) => {
          setMagentoConfig(cfg);
          void loadData(false);
        }}
        onDeleteView={handleDeleteView}
      />

      {/* AI Review Dialog */}
      <AIReviewDialog
        open={showAiReview}
        onOpenChange={setShowAiReview}
        changes={pendingAiChanges}
        columns={pendingAiColumns}
        onConfirm={handleAiReviewConfirm}
        onDiscard={handleAiReviewDiscard}
      />

      {/* Top Bar */}
      <header className="shrink-0 border-b border-border bg-background px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-6 px-3 flex items-center justify-center border border-dashed border-muted-foreground/40 rounded bg-muted/30">
              <span className="text-xs font-medium text-muted-foreground tracking-wide">LOGO</span>
            </div>
            <span className="text-muted-foreground">|</span>
            <span className="text-sm text-muted-foreground">
              {sortedRows.length !== totalRows
                ? `${sortedRows.length} / ${totalRows} filas`
                : `${totalRows} filas`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeletingAll || products.length === 0}
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
                  <AlertDialogTitle>Eliminar todos los registros</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta accion eliminara permanentemente todos los {products.length} registros de la base de datos. Esta accion no se puede deshacer.
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
              onClick={handleImportClick}
              disabled={isUploading}
            >
              {isUploading ? (
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

            {/* Export buttons */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportMaestra}
              disabled={products.length === 0}
            >
              <Download className="h-4 w-4" />
              <span className="ml-2">
                {selectedMaestraRows.size > 0
                  ? `Exportar Maestra (${selectedMaestraRows.size})`
                  : "Exportar Maestra"}
              </span>
            </Button>

            {activeMagentoView && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportMagento}
                disabled={products.length === 0 || activeMagentoView.columns.length === 0}
                className="border-primary/30 text-primary hover:bg-primary/5"
              >
                <ShoppingCart className="h-4 w-4" />
                <span className="ml-2">
                  {selectedMagentoRows.size > 0
                    ? `${activeMagentoView.buttonLabel} (${selectedMagentoRows.size})`
                    : activeMagentoView.buttonLabel}
                </span>
              </Button>
            )}

          </div>
        </div>

        {/* Dataset Tabs + Search/Filter Row */}
        <div className="mt-2 flex items-center gap-3">
          <Tabs value={activeView} onValueChange={handleViewChange} className="flex-none">
            <TabsList className="h-8">
              <TabsTrigger value="maestra" className="text-xs px-3 gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Maestra
              </TabsTrigger>
              {magentoConfig.views.map((v) => (
                <TabsTrigger key={v.id} value={v.id} className="text-xs px-3 gap-1.5 group/tab pr-1.5">
                  <ShoppingCart className="h-3.5 w-3.5" />
                  {v.name}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleDeleteView(v.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        handleDeleteView(v.id);
                      }
                    }}
                    className="opacity-0 group-hover/tab:opacity-100 ml-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-all inline-flex items-center"
                    title={`Eliminar ${v.name}`}
                    aria-label={`Eliminar ${v.name}`}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateView}
            disabled={isCreatingView}
            className="h-8 w-8 p-0 flex-none"
            title="Nueva vista de exportación"
          >
            {isCreatingView ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>

          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isMagentoView ? `Buscar en ${activeMagentoView?.name ?? "vista"}...` : "Buscar en Maestra..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {!isMagentoView && products.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => {
                setIdentifierPickerValue(identifierColumn ?? "__none__");
                setShowIdentifierPicker(true);
              }}
              title="Elegir la columna que identifica a cada producto en el preview de IA"
            >
              <Settings className="h-3.5 w-3.5" />
              Identificador
              {identifierColumn && columnMeta ? (
                <span className="text-muted-foreground">
                  : {columnMeta.find((c) => c.dbColumn === identifierColumn)?.excelHeader ?? identifierColumn}
                </span>
              ) : (
                <span className="text-muted-foreground">: interno</span>
              )}
            </Button>
          )}

          {isMagentoView && (
            <div className="flex items-center gap-2">
              {/* Keyword dataset indicator */}
              <div className="flex items-center gap-1.5 border border-border rounded-md px-2.5 py-1 h-8">
                <Tags className="h-3.5 w-3.5 text-muted-foreground" />
                {keywordStatus.loaded ? (
                  <span className="text-xs text-emerald-600 font-medium">
                    {keywordStatus.count.toLocaleString()} keywords
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Sin keywords
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => keywordFileInputRef.current?.click()}
                  disabled={isUploadingKeywords}
                  className="h-6 px-2 text-xs"
                >
                  {isUploadingKeywords ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span>{keywordStatus.loaded ? "Reemplazar" : "Importar"}</span>
                  )}
                </Button>
              </div>

              {/* System prompt button */}
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenPromptDialog}
                className="h-8 text-xs gap-1.5"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Prompt</span>
              </Button>

              <span className="text-border">|</span>

              {selectedMagentoRows.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedMagentoRows.size} seleccionados
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAiGenerate("selected")}
                disabled={isGeneratingAi || selectedMagentoRows.size === 0}
                className="h-8 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
              >
                {isGeneratingAi ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">AI Seleccionados</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAiGenerate("all")}
                disabled={isGeneratingAi || magentoProducts.length === 0}
                className="h-8 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
              >
                {isGeneratingAi ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5">AI Todos</span>
              </Button>
              {isGeneratingAi && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleStopAiJob}
                  className="h-8 text-xs gap-1.5"
                >
                  <Square className="h-3 w-3 fill-current" />
                  <span>Detener</span>
                </Button>
              )}
            </div>
          )}

          {searchQuery && (
            <span className="text-xs text-muted-foreground">
              {sortedRows.length} de {totalRows} registros
            </span>
          )}
        </div>

        {/* Upload Progress */}
        {uploadProgress && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              <span className="text-sm font-medium">{uploadProgress.status}</span>
              {uploadProgress.inserted !== undefined && (
                <span className="text-sm text-muted-foreground">
                  ({uploadProgress.inserted} de {uploadProgress.total} filas importadas)
                </span>
              )}
            </div>
            {isUploading && <Progress value={50} className="h-1.5 mt-2" />}
          </div>
        )}

        {/* AI Progress — clean minimal UI */}
        {aiJobProgress && (
          <div className="mt-3 p-3 bg-violet-50 rounded-lg border border-violet-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isGeneratingAi ? (
                  <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
                <span className="text-sm font-medium text-violet-700">
                  {isGeneratingAi
                    ? `Procesando ${aiJobProgress.processed} de ${aiJobProgress.total} productos`
                    : `Completado: ${aiJobProgress.successful} de ${aiJobProgress.total} productos`}
                </span>
                {aiJobProgress.total > 0 && (
                  <span className="text-xs font-medium text-violet-500">
                    {Math.round((aiJobProgress.processed / aiJobProgress.total) * 100)}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {aiJobProgress.failed > 0 && (
                  <span className="text-xs text-red-600">{aiJobProgress.failed} fallidos</span>
                )}
                {isGeneratingAi && aiJobId && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleStopAiJob}
                    className="h-7 px-3 text-xs gap-1.5"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    Detener
                  </Button>
                )}
              </div>
            </div>
            <Progress
              value={
                aiJobProgress.total > 0
                  ? (aiJobProgress.processed / aiJobProgress.total) * 100
                  : isGeneratingAi ? 5 : 100
              }
              className="h-1.5 mt-2"
            />
          </div>
        )}
      </header>

      {/* Main Table */}
      <main className="flex-1 overflow-auto">
        {totalRows > 0 ? (
          <div className="min-w-full">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-muted z-10">
                <tr>
                  <th className="border-b border-border px-3 py-3 text-center w-10">
                    <Checkbox
                      checked={paginatedRows.length > 0 && paginatedRows.every((r) => selectedRows.has(r.id as number))}
                      onCheckedChange={toggleSelectPage}
                    />
                  </th>
                  {visibleColumns.map((colName) => {
                    const displayName = getDisplayName(colName);
                    const isCurrentSort = sortColumn === colName;

                    return (
                      <th
                        key={colName}
                        className="border-b border-border px-4 py-3 text-left font-medium text-foreground whitespace-nowrap cursor-pointer hover:bg-muted/80 transition-colors select-none group/col"
                        onClick={() => handleSort(colName)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-[180px]">{displayName}</span>
                          <span className="text-muted-foreground shrink-0">
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
                          {isMagentoView && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMagentoColumn(colName);
                              }}
                              className="opacity-0 group-hover/col:opacity-100 ml-auto text-muted-foreground hover:text-destructive transition-all shrink-0"
                              title="Eliminar columna"
                              aria-label="Eliminar columna"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  {!isMagentoView && (
                    <th className="border-b border-border px-4 py-3 text-left font-medium w-20">
                      Acciones
                    </th>
                  )}
                  {isMagentoView && (
                    <th className="border-b border-border px-2 py-3 text-right font-medium w-12">
                      <button
                        type="button"
                        onClick={handleOpenConfigForCurrentView}
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Agregar / configurar columnas"
                        aria-label="Configurar columnas"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => {
                  const rowId = row.id as number;
                  const isSelected = selectedRows.has(rowId);

                  return (
                    <tr
                      key={rowId}
                      className={`hover:bg-muted/50 transition-colors ${isSelected ? "bg-violet-50" : ""}`}
                    >
                      <td className="border-b border-border px-3 py-2 text-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRowSelection(rowId)}
                        />
                      </td>
                      {visibleColumns.map((colName) => (
                          <td
                            key={colName}
                            className="border-b border-border px-4 py-2"
                          >
                            <EditableCell
                              value={row[colName] as string | number | null}
                              onSave={(newValue) => handleCellUpdate(rowId, colName, newValue)}
                            />
                          </td>
                      ))}
                      {!isMagentoView && (
                        <td className="border-b border-border px-4 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteRow(rowId)}
                          >
                            Eliminar
                          </Button>
                        </td>
                      )}
                      {isMagentoView && (
                        <td className="border-b border-border px-2 py-2" />
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Empty state with upload prompt */
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-6 max-w-md text-center px-4">
              <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FileSpreadsheet className="h-10 w-10 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2">No hay datos cargados</h2>
                <p className="text-muted-foreground text-sm">
                  Importa un archivo Excel con formato Maestra (.xlsx) para cargar los datos de productos en la base de datos.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={handleImportClick}
                  disabled={isUploading}
                  className="bg-gradient-to-r from-primary to-primary/80"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Importar Maestra.xlsx
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Pagination + Selection Footer */}
      {totalRows > 0 && (
        <footer className="shrink-0 border-t border-border bg-background px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Selection info */}
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {selectedRows.size > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    {selectedRows.size} de {sortedRows.length} seleccionados
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRows(new Set())}
                    className="h-7 text-xs px-2"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Deseleccionar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleSelectAll}
                    className="h-7 text-xs px-2"
                  >
                    Seleccionar todos ({sortedRows.length})
                  </Button>
                </>
              ) : (
                <span>
                  {sortedRows.length !== totalRows
                    ? `${sortedRows.length} de ${totalRows} registros`
                    : `${totalRows} registros`}
                </span>
              )}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground mr-2">
                  Pagina {safePage} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(1)}
                  disabled={safePage <= 1}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={safePage >= totalPages}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </footer>
      )}
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
      {value === null || value === undefined || value === "" ? (
        <span className="text-muted-foreground italic">-</span>
      ) : (
        String(value)
      )}
    </div>
  );
}
