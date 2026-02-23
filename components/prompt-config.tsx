"use client";

import { useState, useEffect } from "react";
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
import { Info, Settings, ChevronDown, ChevronUp } from "lucide-react";

const DEFAULT_PROMPT_TEMPLATE = `Eres un redactor técnico especializado en fichas de producto para e-commerce. Tu trabajo es crear descripciones objetivas, informativas y elegantes.

IDIOMA Y TONO:
- Escribí en ESPAÑOL RIOPLATENSE (Argentina/Uruguay).
- Tono: Elegante, profesional, informativo.
- Estilo: Objetivo y descriptivo, como una ficha técnica refinada.
{{IMAGE_INSTRUCTIONS}}
DATOS DEL PRODUCTO:
{{PRODUCT_CONTEXT}}

INSTRUCCIONES:
1. Escribí una descripción en texto continuo, sin párrafos separados (máximo 60 palabras).
2. Describí el producto de forma objetiva: diseño, estilo, materiales, características.
3. Incluí detalles específicos visibles en las imágenes: corte, texturas, terminaciones.
4. Si hay información de composición o materiales, mencionála claramente.
5. NO menciones precios, descuentos, promociones u ofertas.
6. NO describas colores - la descripción se usa para todas las variantes.
7. NO uses emojis ni caracteres especiales.
8. La descripción debe ser puramente informativa, similar a una especificación técnica elegante.

FORMATO DE SALIDA:
Texto continuo descriptivo del producto. Sin títulos, sin etiquetas, sin párrafos separados.`;

// Removed STORAGE_KEY - now using database

interface PromptConfigProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (prompt: string) => void;
}

// Default variable configurations
const DEFAULT_IMAGE_INSTRUCTIONS = {
  single: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Analizá la imagen del producto para extraer detalles visuales únicos.  
- Describí el estilo, color, textura y características visibles que hacen al producto especial.  
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).`,
  multiple: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Tenés **{{IMAGE_COUNT}}** imágenes del producto para analizar.  
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.  
- Describí el estilo, color, textura, detalles y características visibles desde diferentes ángulos.  
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.`
};

const DEFAULT_PRODUCT_CONTEXT_TEMPLATE = `{{MARCA}}
{{MODELO}}
{{DESCRIPCION}}
{{COMPOSICION}}
{{ESTADO}}
{{COLOR}}`;

export function PromptConfig({ open, onOpenChange, onSave }: PromptConfigProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT_TEMPLATE);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Variable configurations
  const [imageInstructions, setImageInstructions] = useState({
    single: DEFAULT_IMAGE_INSTRUCTIONS.single,
    multiple: DEFAULT_IMAGE_INSTRUCTIONS.multiple
  });
  const [productContextTemplate, setProductContextTemplate] = useState(DEFAULT_PRODUCT_CONTEXT_TEMPLATE);

  // Collapsible states
  const [showImageConfig, setShowImageConfig] = useState(false);
  const [showProductContextConfig, setShowProductContextConfig] = useState(false);

  // Load saved prompt from database when dialog opens
  useEffect(() => {
    if (open) {
      loadPrompt();
    }
  }, [open]);

  const loadPrompt = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/prompt-config");
      const data = await response.json();
      
      if (data.success) {
        if (data.promptTemplate) {
          setPrompt(data.promptTemplate);
        } else {
          setPrompt(DEFAULT_PROMPT_TEMPLATE);
        }
        
        // Load variable configurations
        if (data.imageInstructionsConfig) {
          setImageInstructions(data.imageInstructionsConfig);
        }
        if (data.productContextConfig) {
          setProductContextTemplate(data.productContextConfig);
        }
      } else {
        // Use defaults if no config found
        setPrompt(DEFAULT_PROMPT_TEMPLATE);
      }
    } catch (error) {
      console.error("Error loading prompt:", error);
      // Fallback to defaults on error
      setPrompt(DEFAULT_PROMPT_TEMPLATE);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/prompt-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptTemplate: prompt,
          imageInstructionsConfig: imageInstructions,
          productContextConfig: productContextTemplate
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        onSave(prompt);
        onOpenChange(false);
      } else {
        throw new Error(data.error || "Error al guardar");
      }
    } catch (error) {
      console.error("Error saving prompt:", error);
      alert(error instanceof Error ? error.message : "Error al guardar el prompt");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    try {
      const response = await fetch("/api/prompt-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.promptTemplate) {
          setPrompt(data.promptTemplate);
        }
        if (data.imageInstructionsConfig) {
          setImageInstructions(data.imageInstructionsConfig);
        }
        if (data.productContextConfig) {
          setProductContextTemplate(data.productContextConfig);
        }
      } else {
        // Reset to defaults
        setPrompt(DEFAULT_PROMPT_TEMPLATE);
        setImageInstructions(DEFAULT_IMAGE_INSTRUCTIONS);
        setProductContextTemplate(DEFAULT_PRODUCT_CONTEXT_TEMPLATE);
      }
    } catch (error) {
      console.error("Error resetting prompt:", error);
      // Reset to defaults on error
      setPrompt(DEFAULT_PROMPT_TEMPLATE);
      setImageInstructions(DEFAULT_IMAGE_INSTRUCTIONS);
      setProductContextTemplate(DEFAULT_PRODUCT_CONTEXT_TEMPLATE);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Settings className="h-5 w-5 text-violet-600" />
            <span>Configuración del Prompt de IA</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Personalizá el prompt que se le envía a la IA para generar las descripciones de productos. 
            Las variables se reemplazarán automáticamente durante el procesamiento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6">
          <div className="flex flex-col gap-4 py-6">
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">
                Template del Prompt
              </label>
              <span className="text-xs text-muted-foreground font-mono">
                {prompt.length.toLocaleString()} caracteres
              </span>
            </div>
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              {isLoading ? (
                <div className="flex items-center justify-center h-[450px]">
                  <p className="text-sm text-muted-foreground">Cargando prompt...</p>
                </div>
              ) : (
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="min-h-[450px] font-mono text-sm leading-relaxed resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Escribí tu prompt aquí..."
                  disabled={isLoading}
                />
              )}
            </div>
            </div>

            {/* Variable Configuration Sections */}
            <div className="space-y-4">
            {/* IMAGE_INSTRUCTIONS Configuration */}
            <Card className="border-purple-200 bg-gradient-to-br from-purple-50/80 to-pink-50/80 dark:from-purple-950/30 dark:to-pink-950/30 dark:border-purple-800">
              <CardHeader 
                className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setShowImageConfig(!showImageConfig)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                      <code className="px-2 py-1 bg-purple-100 dark:bg-purple-900/50 rounded text-purple-800 dark:text-purple-200 font-mono text-xs">
                        {"{{IMAGE_INSTRUCTIONS}}"}
                      </code>
                      <span>Configuración</span>
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Personalizá las instrucciones para análisis de imágenes
                    </CardDescription>
                  </div>
                  {showImageConfig ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
              {showImageConfig && (
                <CardContent className="pt-0 space-y-4">
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para 1 imagen:</label>
                    <Textarea
                      value={imageInstructions.single}
                      onChange={(e) => setImageInstructions({ ...imageInstructions, single: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones para una sola imagen..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para múltiples imágenes:</label>
                    <Textarea
                      value={imageInstructions.multiple}
                      onChange={(e) => setImageInstructions({ ...imageInstructions, multiple: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones para múltiples imágenes..."
                    />
                  </div>
                </CardContent>
              )}
            </Card>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t bg-muted/30">
          <Button 
            variant="outline" 
            onClick={handleReset} 
            className="text-xs"
            disabled={isLoading || isSaving}
          >
            Restaurar por defecto
          </Button>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button 
              onClick={handleSave} 
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-sm"
              disabled={isLoading || isSaving}
            >
              {isSaving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Removed getPromptTemplate - now fetched from database via API
