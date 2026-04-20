"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  X,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  Check,
  XCircle,
  CheckCheck,
  Ban,
} from "lucide-react";

/** A single field change: old value vs AI-generated new value */
export interface FieldChange {
  oldValue: string | null;
  newValue: string;
}

/** One product's AI-generated changes */
export interface AiProductChange {
  _row_id: string;
  sku: string;
  item_description: string;
  fields: Record<string, FieldChange>;
}

/** Column metadata */
export interface AiColumnDef {
  dbColumn: string;
  name: string;
}

interface AIReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: AiProductChange[];
  columns: AiColumnDef[];
  onConfirm: (
    approvedChanges: {
      _row_id: string;
      fields: Record<string, string>;
    }[],
    dbColumns: string[]
  ) => Promise<void>;
  onDiscard: () => void;
}

/**
 * Unique key for a specific field on a specific product.
 * Used to track which individual field changes are accepted.
 */
function fieldKey(rowId: string, dbColumn: string) {
  return `${rowId}::${dbColumn}`;
}

export function AIReviewDialog({
  open,
  onOpenChange,
  changes,
  columns,
  onConfirm,
  onDiscard,
}: AIReviewDialogProps) {
  // Track which individual field changes are accepted (all accepted by default)
  const [acceptedFields, setAcceptedFields] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);

  // Column name lookup
  const columnNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      map.set(col.dbColumn, col.name);
    }
    return map;
  }, [columns]);

  // Initialize: accept all fields by default when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const allKeys = new Set<string>();
      for (const change of changes) {
        for (const col of Object.keys(change.fields)) {
          allKeys.add(fieldKey(change._row_id, col));
        }
      }
      setAcceptedFields(allKeys);
      setSearchQuery("");
      // Expand all products by default so all changes are visible
      setExpandedRows(new Set(changes.map((c) => c._row_id)));
    }
    prevOpenRef.current = open;
  }, [open, changes]);

  // Filter products by search
  const filteredChanges = useMemo(() => {
    if (!searchQuery.trim()) return changes;
    const q = searchQuery.toLowerCase().trim();
    return changes.filter(
      (c) =>
        (c.sku || "").toLowerCase().includes(q) ||
        (c.item_description || "").toLowerCase().includes(q) ||
        c._row_id.includes(q)
    );
  }, [changes, searchQuery]);

  // Count stats
  const totalFields = useMemo(() => {
    let count = 0;
    for (const c of changes) {
      count += Object.keys(c.fields).length;
    }
    return count;
  }, [changes]);

  const acceptedCount = acceptedFields.size;

  // Per-product acceptance counts
  const getProductAcceptedCount = (change: AiProductChange) => {
    let count = 0;
    for (const col of Object.keys(change.fields)) {
      if (acceptedFields.has(fieldKey(change._row_id, col))) count++;
    }
    return count;
  };

  const getProductTotalFields = (change: AiProductChange) =>
    Object.keys(change.fields).length;

  // Check if an entire product is fully accepted
  const isProductFullyAccepted = (change: AiProductChange) =>
    getProductAcceptedCount(change) === getProductTotalFields(change);

  // Check if an entire product has no accepted fields
  const isProductFullyRejected = (change: AiProductChange) =>
    getProductAcceptedCount(change) === 0;

  // Toggle a single field
  const toggleField = (rowId: string, dbColumn: string) => {
    const key = fieldKey(rowId, dbColumn);
    setAcceptedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Accept all fields for a product
  const acceptProduct = (change: AiProductChange) => {
    setAcceptedFields((prev) => {
      const next = new Set(prev);
      for (const col of Object.keys(change.fields)) {
        next.add(fieldKey(change._row_id, col));
      }
      return next;
    });
  };

  // Reject all fields for a product
  const rejectProduct = (change: AiProductChange) => {
    setAcceptedFields((prev) => {
      const next = new Set(prev);
      for (const col of Object.keys(change.fields)) {
        next.delete(fieldKey(change._row_id, col));
      }
      return next;
    });
  };

  // Accept all fields for all products
  const acceptAll = () => {
    const allKeys = new Set<string>();
    for (const change of changes) {
      for (const col of Object.keys(change.fields)) {
        allKeys.add(fieldKey(change._row_id, col));
      }
    }
    setAcceptedFields(allKeys);
  };

  // Reject all fields for all products
  const rejectAll = () => {
    setAcceptedFields(new Set());
  };

  // Toggle expand/collapse a product row
  const toggleExpanded = (rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  // Handle confirm: build the approved changes and send them
  const handleConfirm = async () => {
    setIsApplying(true);
    try {
      // Build approved changes: only include products with at least one accepted field
      const approved: { _row_id: string; fields: Record<string, string> }[] = [];
      const usedColumns = new Set<string>();

      for (const change of changes) {
        const fields: Record<string, string> = {};
        for (const [col, fieldChange] of Object.entries(change.fields)) {
          if (acceptedFields.has(fieldKey(change._row_id, col))) {
            fields[col] = fieldChange.newValue;
            usedColumns.add(col);
          }
        }
        if (Object.keys(fields).length > 0) {
          approved.push({ _row_id: change._row_id, fields });
        }
      }

      if (approved.length === 0) {
        onDiscard();
        onOpenChange(false);
        return;
      }

      await onConfirm(approved, Array.from(usedColumns));
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscard = () => {
    onDiscard();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isApplying) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-6xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Revisión de cambios IA
          </DialogTitle>
          <DialogDescription className="text-sm">
            Se generaron cambios para{" "}
            <strong className="text-foreground">{changes.length}</strong>{" "}
            {changes.length === 1 ? "producto" : "productos"} en{" "}
            <strong className="text-foreground">{columns.length}</strong>{" "}
            {columns.length === 1 ? "campo" : "campos"}.{" "}
            Revisá cada cambio y decidí cuáles aplicar.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 shrink-0 border-b border-border/50 bg-muted/30">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por SKU o descripción..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
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

          <div className="flex items-center gap-2 ml-auto">
            <Badge
              variant="outline"
              className={`text-xs ${
                acceptedCount === totalFields
                  ? "text-emerald-600 border-emerald-200 bg-emerald-50"
                  : acceptedCount === 0
                    ? "text-red-600 border-red-200 bg-red-50"
                    : "text-violet-600 border-violet-200 bg-violet-50"
              }`}
            >
              {acceptedCount}/{totalFields} campos aceptados
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={acceptAll}
              className="h-8 text-xs gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Validar todos
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={rejectAll}
              className="h-8 text-xs gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Descartar todos
            </Button>
          </div>
        </div>

        {/* Products list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            {filteredChanges.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                {searchQuery
                  ? "No se encontraron productos con los filtros aplicados"
                  : "No hay cambios para revisar"}
              </div>
            ) : (
              filteredChanges.map((change) => (
                <ProductChangeCard
                  key={change._row_id}
                  change={change}
                  columns={columns}
                  columnNameMap={columnNameMap}
                  isExpanded={expandedRows.has(change._row_id)}
                  acceptedFields={acceptedFields}
                  acceptedCount={getProductAcceptedCount(change)}
                  totalFields={getProductTotalFields(change)}
                  isFullyAccepted={isProductFullyAccepted(change)}
                  isFullyRejected={isProductFullyRejected(change)}
                  onToggleExpand={() => toggleExpanded(change._row_id)}
                  onToggleField={(dbCol) => toggleField(change._row_id, dbCol)}
                  onAcceptAll={() => acceptProduct(change)}
                  onRejectAll={() => rejectProduct(change)}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">{acceptedCount}</strong> de{" "}
              {totalFields} campos aceptados en{" "}
              <strong className="text-foreground">
                {changes.filter((c) => getProductAcceptedCount(c) > 0).length}
              </strong>{" "}
              productos
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleDiscard}
                disabled={isApplying}
              >
                Descartar todo
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isApplying || acceptedCount === 0}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="ml-2">Aplicando...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span className="ml-2">
                      Aplicar {acceptedCount}{" "}
                      {acceptedCount === 1 ? "cambio" : "cambios"}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Product change card ----
function ProductChangeCard({
  change,
  columns,
  columnNameMap,
  isExpanded,
  acceptedFields,
  acceptedCount,
  totalFields,
  isFullyAccepted,
  isFullyRejected,
  onToggleExpand,
  onToggleField,
  onAcceptAll,
  onRejectAll,
}: {
  change: AiProductChange;
  columns: AiColumnDef[];
  columnNameMap: Map<string, string>;
  isExpanded: boolean;
  acceptedFields: Set<string>;
  acceptedCount: number;
  totalFields: number;
  isFullyAccepted: boolean;
  isFullyRejected: boolean;
  onToggleExpand: () => void;
  onToggleField: (dbColumn: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  return (
    <div
      className={`border rounded-xl transition-all ${
        isFullyRejected
          ? "border-red-200 bg-red-50/20 opacity-60"
          : isFullyAccepted
            ? "border-emerald-200 bg-emerald-50/20"
            : "border-violet-200 bg-violet-50/10"
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-0.5"
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {change.sku && (
              <Badge variant="outline" className="text-xs font-mono">
                {change.sku}
              </Badge>
            )}
            <span className="text-sm text-foreground truncate">
              {change.item_description || "Sin descripción"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className={`text-xs ${
              isFullyAccepted
                ? "text-emerald-600 border-emerald-200"
                : isFullyRejected
                  ? "text-red-600 border-red-200"
                  : "text-violet-600 border-violet-200"
            }`}
          >
            {acceptedCount}/{totalFields}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAcceptAll}
            className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
            title="Validar todos los campos"
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRejectAll}
            className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
            title="Descartar todos los campos"
          >
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded: show all field changes */}
      {isExpanded && (
        <div className="border-t border-border/50 mx-4 pb-4 pt-3">
          <div className="space-y-2">
            {columns.map((col) => {
              const fc = change.fields[col.dbColumn];
              if (!fc) return null;
              const key = fieldKey(change._row_id, col.dbColumn);
              const isAccepted = acceptedFields.has(key);
              const hasOldValue = fc.oldValue !== null && fc.oldValue.trim() !== "";
              const isChanged = fc.oldValue !== fc.newValue;

              return (
                <FieldChangeRow
                  key={col.dbColumn}
                  columnName={columnNameMap.get(col.dbColumn) || col.dbColumn}
                  oldValue={fc.oldValue}
                  newValue={fc.newValue}
                  isAccepted={isAccepted}
                  hasOldValue={hasOldValue}
                  isChanged={isChanged}
                  onToggle={() => onToggleField(col.dbColumn)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Individual field change row ----
function FieldChangeRow({
  columnName,
  oldValue,
  newValue,
  isAccepted,
  hasOldValue,
  isChanged,
  onToggle,
}: {
  columnName: string;
  oldValue: string | null;
  newValue: string;
  isAccepted: boolean;
  hasOldValue: boolean;
  isChanged: boolean;
  onToggle: () => void;
}) {
  const isLongText = newValue.length > 100 || (oldValue && oldValue.length > 100);

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        isAccepted
          ? "border-emerald-200 bg-emerald-50/30"
          : "border-red-200 bg-red-50/20 opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox
            checked={isAccepted}
            onCheckedChange={onToggle}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {columnName}
            </span>
            {!isChanged && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Sin cambio
              </Badge>
            )}
          </div>

          {isLongText ? (
            // Long text: stack vertically
            <div className="space-y-2">
              {hasOldValue && (
                <div>
                  <span className="text-[10px] font-medium text-red-500 uppercase tracking-wide block mb-1">
                    Anterior
                  </span>
                  <div className="text-sm text-muted-foreground bg-red-50/50 border border-red-100 rounded-md px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">
                    {oldValue}
                  </div>
                </div>
              )}
              <div>
                <span className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide block mb-1">
                  {hasOldValue ? "Nuevo" : "Generado"}
                </span>
                <div
                  className={`text-sm leading-relaxed rounded-md px-3 py-2 whitespace-pre-wrap break-words ${
                    isAccepted
                      ? "text-foreground bg-emerald-50/50 border border-emerald-100"
                      : "text-muted-foreground bg-muted/50 border border-border line-through"
                  }`}
                >
                  {newValue}
                </div>
              </div>
            </div>
          ) : (
            // Short text: side by side
            <div className="flex items-start gap-3">
              {hasOldValue && (
                <>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium text-red-500 uppercase tracking-wide block mb-1">
                      Anterior
                    </span>
                    <div className="text-sm text-muted-foreground bg-red-50/50 border border-red-100 rounded-md px-2.5 py-1.5 truncate">
                      {oldValue}
                    </div>
                  </div>
                  <span className="text-muted-foreground pt-5 shrink-0">→</span>
                </>
              )}
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-medium text-emerald-600 uppercase tracking-wide block mb-1">
                  {hasOldValue ? "Nuevo" : "Generado"}
                </span>
                <div
                  className={`text-sm rounded-md px-2.5 py-1.5 truncate ${
                    isAccepted
                      ? "text-foreground bg-emerald-50/50 border border-emerald-100"
                      : "text-muted-foreground bg-muted/50 border border-border line-through"
                  }`}
                  title={newValue}
                >
                  {newValue}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
