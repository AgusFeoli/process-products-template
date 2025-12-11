"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Download,
  Plus,
  Trash2,
  Loader2,
  Check,
  Pencil,
  X,
  MoreVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TableData } from "@/lib/types";

interface DataTableProps {
  data: TableData;
  onUpdateCell: (cellId: number, value: string) => Promise<void>;
  onDeleteRow: (rowId: number) => Promise<void>;
  onAddRow: () => Promise<void>;
  onExport: () => void;
  onAddColumn: (name: string) => Promise<void>;
  onDeleteColumn: (columnId: number) => Promise<void>;
  onRenameColumn: (columnId: number, newName: string) => Promise<void>;
}

interface EditingCell {
  rowId: number;
  columnId: number;
}

export function DataTable({
  data,
  onUpdateCell,
  onDeleteRow,
  onAddRow,
  onExport,
  onAddColumn,
  onDeleteColumn,
  onRenameColumn,
}: DataTableProps) {
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [savedCells, setSavedCells] = useState<Set<string>>(new Set());
  const [deletingRows, setDeletingRows] = useState<Set<number>>(new Set());
  const [deletingColumns, setDeletingColumns] = useState<Set<number>>(new Set());
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [editingColumnId, setEditingColumnId] = useState<number | null>(null);
  const [editColumnName, setEditColumnName] = useState("");
  const [columnMenuOpen, setColumnMenuOpen] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newColumnInputRef = useRef<HTMLInputElement>(null);
  const editColumnInputRef = useRef<HTMLInputElement>(null);

  const startEditing = (rowId: number, columnId: number, currentValue: string) => {
    setEditingCell({ rowId, columnId });
    setEditValue(currentValue);
  };

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  useEffect(() => {
    if (isAddingColumn && newColumnInputRef.current) {
      newColumnInputRef.current.focus();
    }
  }, [isAddingColumn]);

  useEffect(() => {
    if (editingColumnId && editColumnInputRef.current) {
      editColumnInputRef.current.focus();
      editColumnInputRef.current.select();
    }
  }, [editingColumnId]);

  const saveCell = useCallback(
    async (cellId: number, rowId: number, columnId: number) => {
      const cellKey = `${rowId}-${columnId}`;
      setSavingCells((prev) => new Set(prev).add(cellKey));

      await onUpdateCell(cellId, editValue);

      setSavingCells((prev) => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });

      setSavedCells((prev) => new Set(prev).add(cellKey));
      setTimeout(() => {
        setSavedCells((prev) => {
          const next = new Set(prev);
          next.delete(cellKey);
          return next;
        });
      }, 1500);

      setEditingCell(null);
    },
    [editValue, onUpdateCell]
  );

  const handleKeyDown = (
    e: React.KeyboardEvent,
    cellId: number,
    rowId: number,
    columnId: number
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveCell(cellId, rowId, columnId);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      saveCell(cellId, rowId, columnId);

      // Move to next cell
      const colIndex = data.columns.findIndex((c) => c.id === columnId);
      const rowIndex = data.rows.findIndex((r) => r.rowId === rowId);

      if (colIndex < data.columns.length - 1) {
        const nextColumn = data.columns[colIndex + 1];
        const nextCell = data.rows[rowIndex].cells[nextColumn.id];
        setTimeout(() => {
          startEditing(rowId, nextColumn.id, nextCell?.value || "");
        }, 50);
      } else if (rowIndex < data.rows.length - 1) {
        const nextRow = data.rows[rowIndex + 1];
        const firstColumn = data.columns[0];
        const nextCell = nextRow.cells[firstColumn.id];
        setTimeout(() => {
          startEditing(nextRow.rowId, firstColumn.id, nextCell?.value || "");
        }, 50);
      }
    }
  };

  const handleDeleteRow = async (rowId: number) => {
    setDeletingRows((prev) => new Set(prev).add(rowId));
    await onDeleteRow(rowId);
    setDeletingRows((prev) => {
      const next = new Set(prev);
      next.delete(rowId);
      return next;
    });
  };

  const handleAddRow = async () => {
    setIsAddingRow(true);
    await onAddRow();
    setIsAddingRow(false);
  };

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) return;
    setIsAddingColumn(false);
    await onAddColumn(newColumnName.trim());
    setNewColumnName("");
  };

  const handleDeleteColumn = async (columnId: number) => {
    setColumnMenuOpen(null);
    setDeletingColumns((prev) => new Set(prev).add(columnId));
    await onDeleteColumn(columnId);
    setDeletingColumns((prev) => {
      const next = new Set(prev);
      next.delete(columnId);
      return next;
    });
  };

  const handleRenameColumn = async (columnId: number) => {
    if (!editColumnName.trim()) {
      setEditingColumnId(null);
      return;
    }
    await onRenameColumn(columnId, editColumnName.trim());
    setEditingColumnId(null);
    setEditColumnName("");
  };

  const startEditingColumn = (columnId: number, currentName: string) => {
    setColumnMenuOpen(null);
    setEditingColumnId(columnId);
    setEditColumnName(currentName);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{data.tableName}</h2>
          <p className="text-sm text-muted-foreground">
            {data.rows.length} rows, {data.columns.length} columns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddingColumn(true)}
            disabled={isAddingColumn}
          >
            <Plus className="h-4 w-4" />
            Add Column
          </Button>
          <Button variant="outline" size="sm" onClick={handleAddRow} disabled={isAddingRow}>
            {isAddingRow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add Row
          </Button>
          <Button variant="default" size="sm" onClick={onExport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 text-center font-semibold">#</TableHead>
                {data.columns.map((column) => (
                  <TableHead
                    key={column.id}
                    className={cn(
                      "font-semibold min-w-[150px] relative group",
                      deletingColumns.has(column.id) && "opacity-50 bg-destructive/10"
                    )}
                  >
                    {editingColumnId === column.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          ref={editColumnInputRef}
                          value={editColumnName}
                          onChange={(e) => setEditColumnName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenameColumn(column.id);
                            } else if (e.key === "Escape") {
                              setEditingColumnId(null);
                            }
                          }}
                          onBlur={() => handleRenameColumn(column.id)}
                          className="h-7 text-sm font-semibold"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span
                          className="cursor-pointer hover:text-primary transition-colors"
                          onDoubleClick={() => startEditingColumn(column.id, column.name)}
                        >
                          {column.name}
                        </span>
                        <div className="relative">
                          <button
                            onClick={() =>
                              setColumnMenuOpen(columnMenuOpen === column.id ? null : column.id)
                            }
                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-background/50 rounded transition-all"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {columnMenuOpen === column.id && (
                            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[140px] py-1">
                              <button
                                onClick={() => startEditingColumn(column.id, column.name)}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                              >
                                <Pencil className="h-3 w-3" />
                                Rename
                              </button>
                              <button
                                onClick={() => handleDeleteColumn(column.id)}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-destructive/10 text-destructive transition-colors flex items-center gap-2"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </TableHead>
                ))}
                {isAddingColumn && (
                  <TableHead className="min-w-[150px]">
                    <div className="flex items-center gap-1">
                      <Input
                        ref={newColumnInputRef}
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddColumn();
                          } else if (e.key === "Escape") {
                            setIsAddingColumn(false);
                            setNewColumnName("");
                          }
                        }}
                        placeholder="Column name"
                        className="h-7 text-sm"
                      />
                      <button
                        onClick={handleAddColumn}
                        className="p-1 hover:bg-green-100 rounded text-green-600"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setIsAddingColumn(false);
                          setNewColumnName("");
                        }}
                        className="p-1 hover:bg-red-100 rounded text-red-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </TableHead>
                )}
                <TableHead className="w-20 text-center font-semibold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, rowIndex) => (
                <TableRow
                  key={row.rowId}
                  className={cn(
                    "transition-all duration-200",
                    deletingRows.has(row.rowId) && "opacity-50 bg-destructive/10"
                  )}
                >
                  <TableCell className="text-center text-muted-foreground font-mono text-xs">
                    {rowIndex + 1}
                  </TableCell>
                  {data.columns.map((column) => {
                    const cell = row.cells[column.id];
                    const isEditing =
                      editingCell?.rowId === row.rowId &&
                      editingCell?.columnId === column.id;
                    const cellKey = `${row.rowId}-${column.id}`;
                    const isSaving = savingCells.has(cellKey);
                    const isSaved = savedCells.has(cellKey);

                    return (
                      <TableCell
                        key={column.id}
                        className={cn(
                          "editable-cell p-0 relative",
                          isSaved && "bg-green-50",
                          deletingColumns.has(column.id) && "opacity-50"
                        )}
                        onDoubleClick={() =>
                          startEditing(row.rowId, column.id, cell?.value || "")
                        }
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 p-1">
                            <Input
                              ref={inputRef}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) =>
                                handleKeyDown(e, cell?.cellId, row.rowId, column.id)
                              }
                              onBlur={() =>
                                saveCell(cell?.cellId, row.rowId, column.id)
                              }
                              className="h-8 text-sm"
                            />
                          </div>
                        ) : (
                          <div className="group flex items-center justify-between px-4 py-3 min-h-[52px]">
                            <span className="truncate">{cell?.value || ""}</span>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {isSaving && (
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              )}
                              {isSaved && (
                                <Check className="h-3 w-3 text-green-600" />
                              )}
                              <button
                                onClick={() =>
                                  startEditing(row.rowId, column.id, cell?.value || "")
                                }
                                className="p-1 hover:bg-muted rounded transition-colors"
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                        )}
                      </TableCell>
                    );
                  })}
                  {isAddingColumn && (
                    <TableCell className="bg-muted/30">
                      <span className="text-muted-foreground text-sm">—</span>
                    </TableCell>
                  )}
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteRow(row.rowId)}
                      disabled={deletingRows.has(row.rowId)}
                    >
                      {deletingRows.has(row.rowId) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={data.columns.length + 2 + (isAddingColumn ? 1 : 0)}
                    className="h-32 text-center text-muted-foreground"
                  >
                    No data available. Add a row to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Double-click a cell or column name to edit. Press Enter to save, Escape to cancel, Tab to move to next cell.
      </p>
    </div>
  );
}
