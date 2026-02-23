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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  X,
  CheckSquare,
  Square,
  ArrowRight,
  Sparkles,
  Ban,
  Loader2,
  ImageOff,
  ChevronDown,
  ChevronUp,
  Pencil,
  Save,
  Image,
  RefreshCw,
} from "lucide-react";

// Types matching the API
export interface PendingChange {
  id: number;
  modelo: string;
  proveedor: string;
  descripcion: string;
  oldDescripcionEshop: string | null;
  newDescripcionEshop: string;
  oldImagen: string | null;
  newImagen: string | null;
  hasImage: boolean;
  productUpdatedAt: string | null;
  primaryImagePath: string | null;
  imageModifyTime: string | null;
  allImagesJson: string | null;
}

export interface SkippedProduct {
  id: number;
  modelo: string;
  proveedor: string;
  descripcion: string;
  descripcionEshop?: string | null;
}

interface AIReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingChanges: PendingChange[];
  skippedProducts: SkippedProduct[];
  skippedNoImageProducts?: SkippedProduct[];
  onConfirm: (selectedIds: number[], editedDescriptions?: Record<number, string>) => Promise<void>;
  onDiscard: () => void;
  onSaveDescriptions?: (descriptions: Record<number, string>) => Promise<void>;
}

type TabKey = "ai-generated" | "edited" | "no-image" | "skipped";

export function AIReviewDialog({
  open,
  onOpenChange,
  pendingChanges,
  skippedProducts,
  skippedNoImageProducts = [],
  onConfirm,
  onDiscard,
  onSaveDescriptions,
}: AIReviewDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(pendingChanges.map((c) => c.id))
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [proveedorFilter, setProveedorFilter] = useState("__all__");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("ai-generated");

  // Track edited descriptions: productId -> edited text
  const [editedDescriptions, setEditedDescriptions] = useState<Record<number, string>>({});
  // Track which items are in edit mode
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set());

  // ---- Categorize products into tabs ----
  // AI Generated: new descriptions WITH image (no old description)
  const aiGenerated = useMemo(
    () => pendingChanges.filter((c) => c.hasImage && !c.oldDescripcionEshop?.trim()),
    [pendingChanges]
  );

  // Edited/Updated: products that HAD an existing description
  const editedProducts = useMemo(
    () => pendingChanges.filter((c) => !!c.oldDescripcionEshop?.trim()),
    [pendingChanges]
  );

  // No Image: products skipped because no image was found on SFTP
  const noImageProducts = skippedNoImageProducts;

  // Counts
  const hasAiGenerated = aiGenerated.length > 0;
  const hasEdited = editedProducts.length > 0;
  const hasNoImage = noImageProducts.length > 0;
  const hasSkipped = skippedProducts.length > 0;
  const hasAnyChanges = pendingChanges.length > 0;

  // Reset selections when dialog opens with new data
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setSelectedIds(new Set(pendingChanges.map((c) => c.id)));
      setSearchQuery("");
      setProveedorFilter("__all__");
      setExpandedIds(new Set());
      setEditedDescriptions({});
      setEditingIds(new Set());
      // Set active tab to first non-empty tab
      if (hasAiGenerated) setActiveTab("ai-generated");
      else if (hasEdited) setActiveTab("edited");
      else if (hasNoImage) setActiveTab("no-image");
      else if (hasSkipped) setActiveTab("skipped");
    }
    prevOpenRef.current = open;
  }, [open, pendingChanges, hasAiGenerated, hasEdited, hasNoImage, hasSkipped]);

  // Get current tab's items for filtering (only for PendingChange tabs)
  const currentTabItems = useMemo(() => {
    switch (activeTab) {
      case "ai-generated": return aiGenerated;
      case "edited": return editedProducts;
      default: return [];
    }
  }, [activeTab, aiGenerated, editedProducts]);

  // Get unique providers across all changes
  const uniqueProveedores = useMemo(() => {
    const set = new Set<string>();
    for (const change of pendingChanges) {
      if (change.proveedor?.trim()) set.add(change.proveedor.trim());
    }
    for (const p of skippedProducts) {
      if (p.proveedor?.trim()) set.add(p.proveedor.trim());
    }
    for (const p of noImageProducts) {
      if (p.proveedor?.trim()) set.add(p.proveedor.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [pendingChanges, skippedProducts]);

  // Filter items (for pending change tabs)
  const filteredItems = useMemo(() => {
    let items = currentTabItems;

    if (proveedorFilter && proveedorFilter !== "__all__") {
      items = items.filter(
        (c) => c.proveedor.trim().toLowerCase() === proveedorFilter.toLowerCase()
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(
        (c) =>
          c.modelo.toLowerCase().includes(q) ||
          c.proveedor.toLowerCase().includes(q) ||
          c.descripcion.toLowerCase().includes(q) ||
          c.newDescripcionEshop.toLowerCase().includes(q) ||
          String(c.id).includes(q)
      );
    }

    return items;
  }, [currentTabItems, proveedorFilter, searchQuery]);

  // Filter skipped products
  const filteredSkipped = useMemo(() => {
    let items = skippedProducts;

    if (proveedorFilter && proveedorFilter !== "__all__") {
      items = items.filter(
        (p) => p.proveedor.trim().toLowerCase() === proveedorFilter.toLowerCase()
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(
        (p) =>
          p.modelo.toLowerCase().includes(q) ||
          p.proveedor.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q) ||
          String(p.id).includes(q)
      );
    }

    return items;
  }, [skippedProducts, proveedorFilter, searchQuery]);

  // Filter no-image products
  const filteredNoImage = useMemo(() => {
    let items = noImageProducts;

    if (proveedorFilter && proveedorFilter !== "__all__") {
      items = items.filter(
        (p) => p.proveedor.trim().toLowerCase() === proveedorFilter.toLowerCase()
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(
        (p) =>
          p.modelo.toLowerCase().includes(q) ||
          p.proveedor.toLowerCase().includes(q) ||
          p.descripcion.toLowerCase().includes(q) ||
          String(p.id).includes(q)
      );
    }

    return items;
  }, [noImageProducts, proveedorFilter, searchQuery]);

  // Count selected in current view
  const selectedInView = useMemo(
    () => filteredItems.filter((c) => selectedIds.has(c.id)).length,
    [filteredItems, selectedIds]
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filteredItems) next.add(c.id);
      return next;
    });
  };

  const deselectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const c of filteredItems) next.delete(c.id);
      return next;
    });
  };

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Description editing
  const startEditing = (id: number, currentDescription: string) => {
    setEditingIds((prev) => new Set(prev).add(id));
    if (!(id in editedDescriptions)) {
      setEditedDescriptions((prev) => ({ ...prev, [id]: currentDescription }));
    }
  };

  const stopEditing = (id: number) => {
    setEditingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const updateDescription = (id: number, text: string) => {
    setEditedDescriptions((prev) => ({ ...prev, [id]: text }));
  };

  // For skipped products description editing
  const startEditingSkipped = (id: number, currentDescription: string) => {
    setEditingIds((prev) => new Set(prev).add(id));
    if (!(id in editedDescriptions)) {
      setEditedDescriptions((prev) => ({
        ...prev,
        [id]: currentDescription,
      }));
    }
  };

  const hasUnsavedEdits = Object.keys(editedDescriptions).length > 0;

  const handleConfirm = async () => {
    setIsApplying(true);
    try {
      await onConfirm(Array.from(selectedIds), editedDescriptions);
    } finally {
      setIsApplying(false);
    }
  };

  const handleSave = async () => {
    if (!onSaveDescriptions || !hasUnsavedEdits) return;
    setIsSaving(true);
    try {
      await onSaveDescriptions(editedDescriptions);
      setEditedDescriptions({});
      setEditingIds(new Set());
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    onDiscard();
    onOpenChange(false);
  };

  // Determine the effective description for a pending change
  const getEffectiveDescription = (change: PendingChange) => {
    if (change.id in editedDescriptions) return editedDescriptions[change.id];
    return change.newDescripcionEshop;
  };

  // Determine effective description for a skipped product
  const getEffectiveSkippedDescription = (product: SkippedProduct) => {
    if (product.id in editedDescriptions) return editedDescriptions[product.id];
    return product.descripcionEshop || product.descripcion || "";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !isApplying && !isSaving) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="h-5 w-5 text-violet-500" />
            Revisión de productos procesados
          </DialogTitle>
          <DialogDescription className="text-sm">
            {hasAnyChanges && (
              <span>
                Se procesaron{" "}
                <strong className="text-foreground">
                  {pendingChanges.length}
                </strong>{" "}
                productos.
              </span>
            )}
            {hasSkipped && (
              <span>
                {hasAnyChanges && " "}
                <strong className="text-orange-600">
                  {skippedProducts.length}
                </strong>{" "}
                omitidos por proveedor.
              </span>
            )}
            {" Revisá, editá y confirmá los cambios que querés aplicar."}
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabKey)}
          className="flex-1 flex flex-col min-h-0 overflow-hidden"
        >
          <div className="px-6 pt-3 shrink-0">
            <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
              {hasAiGenerated && (
                <TabsTrigger value="ai-generated" className="gap-1.5 text-xs">
                  <Sparkles className="h-3.5 w-3.5" />
                  Generados por IA
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                    {aiGenerated.length}
                  </Badge>
                </TabsTrigger>
              )}
              {hasEdited && (
                <TabsTrigger value="edited" className="gap-1.5 text-xs">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Editados
                  <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0 text-amber-600">
                    {editedProducts.length}
                  </Badge>
                </TabsTrigger>
              )}
              {hasNoImage && (
                <TabsTrigger value="no-image" className="gap-1.5 text-xs">
                  <ImageOff className="h-3.5 w-3.5" />
                  Sin imagen FTP
                  <Badge variant="outline" className="ml-1 text-xs px-1.5 py-0 text-muted-foreground">
                    {noImageProducts.length}
                  </Badge>
                </TabsTrigger>
              )}
              {hasSkipped && (
                <TabsTrigger value="skipped" className="gap-1.5 text-xs">
                  <Ban className="h-3.5 w-3.5" />
                  Omitidos
                  <Badge
                    variant="outline"
                    className="ml-1 text-xs px-1.5 py-0 text-orange-600 border-orange-200"
                  >
                    {skippedProducts.length}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {/* Search / Filters bar — shared across tabs */}
          <div className="flex items-center gap-3 px-6 py-3 shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por modelo, proveedor, descripción..."
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
            <Select value={proveedorFilter} onValueChange={setProveedorFilter}>
              <SelectTrigger className="w-[200px] h-9 text-sm">
                <SelectValue placeholder="Todos los proveedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos los proveedores</SelectItem>
                {uniqueProveedores.map((prov) => (
                  <SelectItem key={prov} value={prov}>
                    {prov}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTab !== "skipped" && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">
                  {selectedInView}/{filteredItems.length} sel.
                </span>
                <Button variant="outline" size="sm" onClick={selectAll} className="h-8 text-xs">
                  <CheckSquare className="h-3.5 w-3.5 mr-1" />
                  Todos
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll} className="h-8 text-xs">
                  <Square className="h-3.5 w-3.5 mr-1" />
                  Ninguno
                </Button>
              </div>
            )}
          </div>

          {/* AI Generated Tab */}
          {hasAiGenerated && (
            <TabsContent
              value="ai-generated"
              className="flex-1 flex flex-col min-h-0 overflow-hidden mt-0 px-6 pb-0"
            >
              <ChangesList
                items={filteredItems}
                selectedIds={selectedIds}
                expandedIds={expandedIds}
                editingIds={editingIds}
                editedDescriptions={editedDescriptions}
                onToggleSelect={toggleSelect}
                onToggleExpand={toggleExpanded}
                onStartEditing={startEditing}
                onStopEditing={stopEditing}
                onUpdateDescription={updateDescription}
                getEffectiveDescription={getEffectiveDescription}
                emptyMessage="No hay productos generados por IA"
                hasFilters={!!searchQuery || proveedorFilter !== "__all__"}
              />
            </TabsContent>
          )}

          {/* Edited/Updated Tab */}
          {hasEdited && (
            <TabsContent
              value="edited"
              className="flex-1 flex flex-col min-h-0 overflow-hidden mt-0 px-6 pb-0"
            >
              <ChangesList
                items={filteredItems}
                selectedIds={selectedIds}
                expandedIds={expandedIds}
                editingIds={editingIds}
                editedDescriptions={editedDescriptions}
                onToggleSelect={toggleSelect}
                onToggleExpand={toggleExpanded}
                onStartEditing={startEditing}
                onStopEditing={stopEditing}
                onUpdateDescription={updateDescription}
                getEffectiveDescription={getEffectiveDescription}
                emptyMessage="No hay productos editados"
                hasFilters={!!searchQuery || proveedorFilter !== "__all__"}
              />
            </TabsContent>
          )}

          {/* No Image Tab */}
          {hasNoImage && (
            <TabsContent
              value="no-image"
              className="flex-1 flex flex-col min-h-0 overflow-hidden mt-0 px-6 pb-0"
            >
              <div className="flex-1 min-h-0 -mx-6 px-6 overflow-y-auto">
                <div className="space-y-2 pb-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Estos productos no pudieron ser procesados por la IA porque no se
                    encontr&oacute; su imagen en el FTP.
                  </p>
                  {filteredNoImage.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                      {searchQuery || proveedorFilter !== "__all__"
                        ? "No se encontraron productos con los filtros aplicados"
                        : "No hay productos sin imagen"}
                    </div>
                  ) : (
                    filteredNoImage.map((product) => (
                      <SkippedCard
                        key={product.id}
                        product={product}
                        isExpanded={expandedIds.has(product.id)}
                        isEditing={editingIds.has(product.id)}
                        editedDescription={editedDescriptions[product.id]}
                        onToggleExpand={() => toggleExpanded(product.id)}
                        onStartEditing={() =>
                          startEditingSkipped(
                            product.id,
                            getEffectiveSkippedDescription(product)
                          )
                        }
                        onStopEditing={() => stopEditing(product.id)}
                        onUpdateDescription={(text) =>
                          updateDescription(product.id, text)
                        }
                        effectiveDescription={getEffectiveSkippedDescription(product)}
                      />
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          )}

          {/* Skipped Tab */}
          {hasSkipped && (
            <TabsContent
              value="skipped"
              className="flex-1 flex flex-col min-h-0 overflow-hidden mt-0 px-6 pb-0"
            >
              <div className="flex-1 min-h-0 -mx-6 px-6 overflow-y-auto">
                <div className="space-y-2 pb-4">
                  <p className="text-sm text-muted-foreground mb-3">
                    Estos productos fueron omitidos porque su proveedor tiene
                    &quot;Omitir IA&quot; activado. Podés editar sus descripciones
                    manualmente.
                  </p>
                  {filteredSkipped.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                      {searchQuery || proveedorFilter !== "__all__"
                        ? "No se encontraron productos con los filtros aplicados"
                        : "No hay productos omitidos"}
                    </div>
                  ) : (
                    filteredSkipped.map((product) => (
                      <SkippedCard
                        key={product.id}
                        product={product}
                        isExpanded={expandedIds.has(product.id)}
                        isEditing={editingIds.has(product.id)}
                        editedDescription={editedDescriptions[product.id]}
                        onToggleExpand={() => toggleExpanded(product.id)}
                        onStartEditing={() =>
                          startEditingSkipped(
                            product.id,
                            getEffectiveSkippedDescription(product)
                          )
                        }
                        onStopEditing={() => stopEditing(product.id)}
                        onUpdateDescription={(text) =>
                          updateDescription(product.id, text)
                        }
                        effectiveDescription={getEffectiveSkippedDescription(product)}
                      />
                    ))
                  )}
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {hasAnyChanges && (
                <span>
                  <strong className="text-foreground">{selectedIds.size}</strong>{" "}
                  de {pendingChanges.length} cambios seleccionados
                </span>
              )}
              {hasUnsavedEdits && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                  <Pencil className="h-3 w-3 mr-1" />
                  {Object.keys(editedDescriptions).length} editados
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              {hasUnsavedEdits && onSaveDescriptions && (
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={isSaving || isApplying}
                  className="border-amber-200 text-amber-700 hover:bg-amber-50"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span className="ml-2">Guardar cambios</span>
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handleDiscard}
                disabled={isApplying || isSaving}
              >
                Descartar todo
              </Button>
              {hasAnyChanges && (
                <Button
                  onClick={handleConfirm}
                  disabled={isApplying || isSaving || selectedIds.size === 0}
                  className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
                >
                  {isApplying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2">Aplicando...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span className="ml-2">
                        Confirmar {selectedIds.size}{" "}
                        {selectedIds.size === 1 ? "cambio" : "cambios"}
                      </span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Shared changes list component ----
function ChangesList({
  items,
  selectedIds,
  expandedIds,
  editingIds,
  editedDescriptions,
  onToggleSelect,
  onToggleExpand,
  onStartEditing,
  onStopEditing,
  onUpdateDescription,
  getEffectiveDescription,
  emptyMessage,
  hasFilters,
}: {
  items: PendingChange[];
  selectedIds: Set<number>;
  expandedIds: Set<number>;
  editingIds: Set<number>;
  editedDescriptions: Record<number, string>;
  onToggleSelect: (id: number) => void;
  onToggleExpand: (id: number) => void;
  onStartEditing: (id: number, currentDesc: string) => void;
  onStopEditing: (id: number) => void;
  onUpdateDescription: (id: number, text: string) => void;
  getEffectiveDescription: (change: PendingChange) => string;
  emptyMessage: string;
  hasFilters: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 -mx-6 px-6 overflow-y-auto">
      <div className="space-y-2 pb-4">
        {items.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {hasFilters
              ? "No se encontraron productos con los filtros aplicados"
              : emptyMessage}
          </div>
        ) : (
          items.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              isSelected={selectedIds.has(change.id)}
              isExpanded={expandedIds.has(change.id)}
              isEditing={editingIds.has(change.id)}
              editedDescription={editedDescriptions[change.id]}
              onToggleSelect={() => onToggleSelect(change.id)}
              onToggleExpand={() => onToggleExpand(change.id)}
              onStartEditing={() =>
                onStartEditing(change.id, getEffectiveDescription(change))
              }
              onStopEditing={() => onStopEditing(change.id)}
              onUpdateDescription={(text) => onUpdateDescription(change.id, text)}
              effectiveDescription={getEffectiveDescription(change)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---- Individual change card with editable description ----
function ChangeCard({
  change,
  isSelected,
  isExpanded,
  isEditing,
  editedDescription,
  onToggleSelect,
  onToggleExpand,
  onStartEditing,
  onStopEditing,
  onUpdateDescription,
  effectiveDescription,
}: {
  change: PendingChange;
  isSelected: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  editedDescription?: string;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onUpdateDescription: (text: string) => void;
  effectiveDescription: string;
}) {
  const hasOldDescription =
    change.oldDescripcionEshop && change.oldDescripcionEshop.trim().length > 0;
  const wasEdited = editedDescription !== undefined;
  const truncatedDesc =
    effectiveDescription.length > 150
      ? effectiveDescription.slice(0, 150) + "..."
      : effectiveDescription;

  // Determine the image URL to display
  const imageUrl = change.primaryImagePath
    ? `/api/images?path=${encodeURIComponent(change.primaryImagePath)}`
    : null;

  return (
    <div
      className={`border rounded-xl transition-all ${
        isSelected
          ? "border-violet-200 bg-violet-50/30 dark:bg-violet-950/10 dark:border-violet-800"
          : "border-border bg-background hover:bg-muted/30"
      }`}
    >
      {/* Card Header */}
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="pt-0.5">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect()}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">
              #{change.id}
            </span>
            <span className="font-medium text-sm truncate">
              {change.modelo || "Sin modelo"}
            </span>
            <Badge variant="outline" className="text-xs shrink-0">
              {change.proveedor || "Sin proveedor"}
            </Badge>
            {change.hasImage && (
              <Badge
                variant="secondary"
                className="text-xs text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30 shrink-0"
              >
                <Image className="h-3 w-3 mr-1" />
                Con imagen
              </Badge>
            )}
            {hasOldDescription && (
              <Badge
                variant="secondary"
                className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 shrink-0"
              >
                Actualización
              </Badge>
            )}
            {wasEdited && (
              <Badge
                variant="secondary"
                className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 shrink-0"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Editado
              </Badge>
            )}
          </div>

          {/* Preview / Collapsed view */}
          {!isExpanded && (
            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
              {truncatedDesc}
            </p>
          )}
        </div>
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1"
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded Detail - 30/70 layout with image on left */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-border/50 mx-4 mt-0 pt-3">
          <div className="flex gap-4">
            {/* Left side: Product Image (30%) */}
            <div className="w-[30%] shrink-0">
              {imageUrl ? (
                <div className="aspect-square rounded-lg overflow-hidden bg-muted border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl}
                    alt={change.modelo || "Producto"}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Hide broken image and show placeholder
                      const target = e.target as HTMLImageElement;
                      target.style.display = "none";
                      target.nextElementSibling?.classList.remove("hidden");
                    }}
                  />
                  <div className="hidden w-full h-full flex items-center justify-center text-muted-foreground">
                    <ImageOff className="h-8 w-8" />
                  </div>
                </div>
              ) : (
                <div className="aspect-square rounded-lg bg-muted border border-border flex items-center justify-center text-muted-foreground">
                  <ImageOff className="h-8 w-8" />
                </div>
              )}
            </div>

            {/* Right side: Content (70%) */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Old description */}
              {hasOldDescription && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-2 w-2 rounded-full bg-red-400 shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Descripción anterior
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground bg-red-50/50 dark:bg-red-950/10 border border-red-100 dark:border-red-900/30 rounded-lg px-3 py-2.5 leading-relaxed">
                    {change.oldDescripcionEshop}
                  </div>
                </div>
              )}

              {hasOldDescription && (
                <div className="flex justify-center">
                  <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
                </div>
              )}

              {/* New/Editable description */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {wasEdited ? "Descripción editada" : "Nueva descripción (IA)"}
                  </span>
                  <div className="ml-auto">
                    {isEditing ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-green-600 hover:text-green-700"
                        onClick={onStopEditing}
                      >
                        <CheckSquare className="h-3.5 w-3.5 mr-1" />
                        Listo
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={onStartEditing}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Editar
                      </Button>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <Textarea
                    value={editedDescription ?? change.newDescripcionEshop}
                    onChange={(e) => onUpdateDescription(e.target.value)}
                    className="min-h-[100px] text-sm leading-relaxed"
                    placeholder="Escribí la descripción..."
                  />
                ) : (
                  <div
                    className={`text-sm leading-relaxed rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                      wasEdited
                        ? "text-foreground bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30"
                        : "text-foreground bg-green-50/50 dark:bg-green-950/10 border border-green-100 dark:border-green-900/30"
                    } hover:opacity-80`}
                    onClick={onStartEditing}
                    title="Click para editar"
                  >
                    {effectiveDescription}
                  </div>
                )}
              </div>

              {/* Product info */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                {change.descripcion && (
                  <span>
                    <strong>Producto:</strong> {change.descripcion}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Skipped product card with editable description ----
function SkippedCard({
  product,
  isExpanded,
  isEditing,
  editedDescription,
  onToggleExpand,
  onStartEditing,
  onStopEditing,
  onUpdateDescription,
  effectiveDescription,
}: {
  product: SkippedProduct;
  isExpanded: boolean;
  isEditing: boolean;
  editedDescription?: string;
  onToggleExpand: () => void;
  onStartEditing: () => void;
  onStopEditing: () => void;
  onUpdateDescription: (text: string) => void;
  effectiveDescription: string;
}) {
  const wasEdited = editedDescription !== undefined;

  return (
    <div className="border rounded-xl border-border bg-background hover:bg-muted/30 transition-all">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">
              #{product.id}
            </span>
            <span className="font-medium text-sm truncate">
              {product.modelo || "Sin modelo"}
            </span>
            <Badge
              variant="outline"
              className="text-xs text-orange-600 border-orange-200 bg-orange-50 shrink-0"
            >
              {product.proveedor}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs text-orange-500 border-orange-200 shrink-0"
            >
              <Ban className="h-3 w-3 mr-1" />
              Omitido
            </Badge>
            {wasEdited && (
              <Badge
                variant="secondary"
                className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 shrink-0"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Editado
              </Badge>
            )}
          </div>
          {!isExpanded && effectiveDescription && (
            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">
              {effectiveDescription.length > 150
                ? effectiveDescription.slice(0, 150) + "..."
                : effectiveDescription}
            </p>
          )}
        </div>
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1"
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-border/50 mx-4 mt-0 pt-3">
          {/* Product description */}
          {product.descripcion && (
            <div className="text-xs text-muted-foreground">
              <strong>Producto:</strong> {product.descripcion}
            </div>
          )}

          {/* Editable description */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-2 w-2 rounded-full bg-orange-400 shrink-0" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Descripción e-shop
              </span>
              <div className="ml-auto">
                {isEditing ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-green-600 hover:text-green-700"
                    onClick={onStopEditing}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    Listo
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onStartEditing}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Editar
                  </Button>
                )}
              </div>
            </div>
            {isEditing ? (
              <Textarea
                value={editedDescription ?? effectiveDescription}
                onChange={(e) => onUpdateDescription(e.target.value)}
                className="min-h-[100px] text-sm leading-relaxed"
                placeholder="Escribí la descripción..."
              />
            ) : (
              <div
                className={`text-sm leading-relaxed rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                  wasEdited
                    ? "text-foreground bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30"
                    : "text-muted-foreground bg-muted/50 border border-border"
                } hover:opacity-80`}
                onClick={onStartEditing}
                title="Click para editar"
              >
                {effectiveDescription || (
                  <span className="italic text-muted-foreground/60">
                    Sin descripción — click para agregar
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
