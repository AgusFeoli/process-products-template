"use client";

import { useState } from "react";
import { FileSpreadsheet, Trash2, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TableInfo {
  id: number;
  name: string;
  created_at: Date;
}

interface TableSelectorProps {
  tables: TableInfo[];
  selectedTableId: number | null;
  onSelectTable: (tableId: number) => void;
  onDeleteTable: (tableId: number) => Promise<void>;
}

export function TableSelector({
  tables,
  selectedTableId,
  onSelectTable,
  onDeleteTable,
}: TableSelectorProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (e: React.MouseEvent, tableId: number) => {
    e.stopPropagation();
    setDeletingId(tableId);
    await onDeleteTable(tableId);
    setDeletingId(null);
  };

  if (tables.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
        Imported Tables
      </h3>
      <div className="space-y-2">
        {tables.map((table) => (
          <div
            key={table.id}
            onClick={() => onSelectTable(table.id)}
            className={cn(
              "group flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all duration-200",
              selectedTableId === table.id
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/30 hover:bg-muted/50"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "p-2 rounded-md transition-colors",
                  selectedTableId === table.id
                    ? "bg-primary/10"
                    : "bg-muted group-hover:bg-primary/10"
                )}
              >
                <FileSpreadsheet
                  className={cn(
                    "h-4 w-4 transition-colors",
                    selectedTableId === table.id
                      ? "text-primary"
                      : "text-muted-foreground group-hover:text-primary"
                  )}
                />
              </div>
              <div>
                <p className="font-medium text-sm">{table.name}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(table.created_at), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => handleDelete(e, table.id)}
                disabled={deletingId === table.id}
              >
                {deletingId === table.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  selectedTableId === table.id && "text-primary rotate-90"
                )}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
