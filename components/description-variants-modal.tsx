"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Loader2, Save, Edit3 } from "lucide-react";
import { toast } from "sonner";
import { type ProductData } from "@/lib/ai-service";

interface DescriptionVariantsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalDescription: string;
  product: ProductData;
  onSave: (selectedVariant: string) => void;
}

export function DescriptionVariantsModal({
  open,
  onOpenChange,
  originalDescription,
  product,
  onSave,
}: DescriptionVariantsModalProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedVariants, setEditedVariants] = useState<string[]>([]);

  const handleGenerateVariants = async () => {
    if (!originalDescription.trim()) {
      toast.error("No hay descripción original para generar variantes");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/generate-variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalDescription: originalDescription.trim(),
          productData: product,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Error al generar variantes");
      }

      setVariants(data.variants);
      setEditedVariants([...data.variants]);
      setEditingIndex(null);

      toast.success("Variantes generadas exitosamente");
    } catch (error) {
      console.error("Error generando variantes:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error al generar variantes con IA"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleEditVariant = (index: number) => {
    setEditingIndex(index);
  };

  const handleSaveEdit = (index: number, newText: string) => {
    const newEditedVariants = [...editedVariants];
    newEditedVariants[index] = newText;
    setEditedVariants(newEditedVariants);
    setEditingIndex(null);
    toast.success("Variante editada");
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditedVariants([...variants]);
  };

  const handleSelectVariant = (index: number) => {
    const selectedVariant = editedVariants[index];
    onSave(selectedVariant);
    onOpenChange(false);
    toast.success("Variante guardada");
  };

  const handleClose = () => {
    setVariants([]);
    setEditedVariants([]);
    setEditingIndex(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <span>Generar Variantes con IA</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Generá variantes diferentes de la descripción usando inteligencia artificial.
            Podés editar cada variante antes de guardarla.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="flex flex-col gap-4 py-6">
          {/* Original Description */}
          <Card className="border-gray-200 bg-gray-50/50 dark:bg-gray-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                <Edit3 className="h-4 w-4 text-gray-600" />
                Descripción Original
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-sm leading-relaxed whitespace-normal text-muted-foreground bg-white dark:bg-gray-800 p-3 rounded border">
                {originalDescription ? originalDescription.replace(/\n+/g, ' ').trim() : "Sin descripción"}
              </div>
            </CardContent>
          </Card>

          {/* Generate Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleGenerateVariants}
              disabled={isGenerating || !originalDescription.trim()}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Generando variantes...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generar 3 Variantes
                </>
              )}
            </Button>
          </div>

          {/* Variants */}
          {variants.length > 0 && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-foreground">
                  Variantes Generadas
                </h3>
                <p className="text-sm text-muted-foreground">
                  Seleccioná una variante para guardarla o editá antes de guardar
                </p>
              </div>

              <div className="space-y-3">
                {variants.map((_, index) => (
                  <Card key={index} className="border-violet-200 bg-gradient-to-br from-violet-50/50 to-indigo-50/50 dark:from-violet-950/20 dark:to-indigo-950/20">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center justify-between">
                        <span className="font-semibold">Variante {index + 1}</span>
                        <div className="flex gap-2">
                          {editingIndex === index ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleCancelEdit}
                              className="text-xs"
                            >
                              Cancelar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditVariant(index)}
                              className="text-xs"
                            >
                              <Edit3 className="h-3 w-3 mr-1" />
                              Editar
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={() => handleSelectVariant(index)}
                            className="text-xs text-white bg-violet-600 hover:bg-violet-700"
                          >
                            <Save className="h-3 w-3 mr-1" />
                            Seleccionar esta variante
                          </Button>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {editingIndex === index ? (
                        <Textarea
                          value={editedVariants[index]}
                          onChange={(e) => {
                            const newEditedVariants = [...editedVariants];
                            newEditedVariants[index] = e.target.value;
                            setEditedVariants(newEditedVariants);
                          }}
                          className="min-h-[180px] h-[180px] text-sm leading-relaxed resize-none p-3 rounded border bg-white dark:bg-gray-800 overflow-y-auto"
                          placeholder="Editá la variante aquí..."
                        />
                      ) : (
                        <div className="min-h-[180px] h-[180px] text-sm leading-relaxed whitespace-normal bg-white dark:bg-gray-800 p-3 rounded border overflow-y-auto">
                          {editedVariants[index].replace(/\n+/g, ' ').trim()}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t bg-muted/30">
          <Button variant="outline" onClick={handleClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}