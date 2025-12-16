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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info, Settings } from "lucide-react";

const DEFAULT_PROMPT_TEMPLATE = `Eres un especialista experto en redacción de productos para e-commerce. Generá una descripción de producto convincente y atractiva.

IMPORTANTE - IDIOMA Y ESTILO:
- Todo el contenido debe estar en ESPAÑOL LATINO RIOPLATENSE (estilo Argentina/Uruguay - Cono Sur).
- Usá el voseo: "vos" en lugar de "tú" (ej: "llevate", "descubrí", "sumá", "elegí", "no te pierdas").
- Usá expresiones naturales del Río de la Plata.
- Esta es una marca uruguaya que busca atraer clientas con productos **EXCLUSIVOS** y **ORIGINALES**.
- El tono debe ser elegante y aspiracional, destacando la exclusividad y originalidad del producto.
- Los llamados a la acción (CTAs) deben transmitir **urgencia** y **exclusividad**.
{{IMAGE_INSTRUCTIONS}}
DATOS DEL PRODUCTO:  
{{PRODUCT_CONTEXT}}

INSTRUCCIONES:  
1. Escribí una descripción de 2 a 3 **párrafos cortos** (en total máximo 60 palabras).  
2. Empezá captando la atención con un tono elegante y aspiracional, adecuado a una marca exclusiva.  
3. Destacá los **beneficios** y **características principales** del producto – su estilo, diseño y materiales – no solo las especificaciones técnicas frías. Mostrá qué lo hace especial y deseable.  
4. Incluí detalles específicos del diseño y la calidad del producto, tal como se ven en las imágenes o se infieren de los datos (ej.: corte de la prenda, tipo de tela, detalles de terminación, funcionalidad). Usá frases breves y descriptivas para cada aspecto, manteniendo la fluidez del texto.  
5. Si se proporciona información sobre la **composición o materiales**, mencionála de forma clara y atractiva. Podés integrarla al final de la descripción (ej.: "Confeccionado en algodón y lino de alta calidad", o "Composición: 100% cuero genuino").  
6. **No** incluyas información sobre el precio, descuentos ni promociones en la descripción. (Esos datos se muestran por separado en el e-commerce).  
7. Si el producto está en oferta, liquidación u outlet, **no** lo menciones en la descripción. (Evitá frases como "precio rebajado" o similares).  
8. Si el producto es nuevo, de temporada actual o una **edición limitada/exclusiva**, podés mencionarlo sutilmente para generar entusiasmo (ej.: "nueva colección", "edición especial de la temporada"), pero sin exagerar ni distraer de la descripción principal.  
9. **No** uses emojis ni caracteres especiales innecesarios. Mantené un estilo profesional y sofisticado.  
10. **No** incluyas referencias a "imágenes" o comandos; la descripción debe leerse como un texto escrito por un redactor humano, no por una IA siguiendo instrucciones.  
11. **SOBRE EL CALL-TO-ACTION (CTA)**: 
    - El CTA es **OPCIONAL**. Solo incluilo si realmente suma valor y urgencia a la descripción.
    - Si la descripción ya es convincente y completa, podés finalizarla sin CTA.
    - Si decidís incluir un CTA, debe ser creativo y variado.
    - El CTA debe estar en español rioplatense y enfatizar **exclusividad** y **urgencia** cuando sea apropiado.
{{CTA_INSTRUCTIONS}}

**DESCRIPCIÓN:**  
*(A continuación, redactá la descripción siguiendo todas las instrucciones anteriores. No incluyas títulos ni etiquetas, solo el texto descriptivo en párrafos.)*`;

// Removed STORAGE_KEY - now using database

interface PromptConfigProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (prompt: string) => void;
}

export function PromptConfig({ open, onOpenChange, onSave }: PromptConfigProps) {
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT_TEMPLATE);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
      
      if (data.success && data.promptTemplate) {
        setPrompt(data.promptTemplate);
      } else {
        // Use default if no prompt found
        setPrompt(DEFAULT_PROMPT_TEMPLATE);
      }
    } catch (error) {
      console.error("Error loading prompt:", error);
      // Fallback to default on error
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
        body: JSON.stringify({ promptTemplate: prompt }),
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
      
      if (data.success && data.promptTemplate) {
        setPrompt(data.promptTemplate);
      } else {
        setPrompt(DEFAULT_PROMPT_TEMPLATE);
      }
    } catch (error) {
      console.error("Error resetting prompt:", error);
      setPrompt(DEFAULT_PROMPT_TEMPLATE);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Settings className="h-5 w-5 text-violet-600" />
            <span>Configuración del Prompt de IA</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Personalizá el prompt que se le envía a la IA para generar las descripciones de productos. 
            Las variables se reemplazarán automáticamente durante el procesamiento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 p-6">
          <Card className="border-blue-200 bg-gradient-to-br from-blue-50/80 to-indigo-50/80 dark:from-blue-950/30 dark:to-indigo-950/30 dark:border-blue-800 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                Variables disponibles
              </CardTitle>
              <CardDescription className="text-xs">
                Estas variables se reemplazarán automáticamente durante el procesamiento:
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <code className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-md text-blue-800 dark:text-blue-200 font-mono text-xs border border-blue-200 dark:border-blue-800 shadow-sm">
                    {"{{IMAGE_INSTRUCTIONS}}"}
                  </code>
                  <span className="flex-1 text-muted-foreground leading-relaxed pt-0.5">
                    Instrucciones sobre cómo analizar imágenes (se agrega automáticamente si hay imágenes)
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <code className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-md text-blue-800 dark:text-blue-200 font-mono text-xs border border-blue-200 dark:border-blue-800 shadow-sm">
                    {"{{PRODUCT_CONTEXT}}"}
                  </code>
                  <span className="flex-1 text-muted-foreground leading-relaxed pt-0.5">
                    Información del producto (marca, modelo, descripción, composición, etc.)
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <code className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-md text-blue-800 dark:text-blue-200 font-mono text-xs border border-blue-200 dark:border-blue-800 shadow-sm">
                    {"{{CTA_INSTRUCTIONS}}"}
                  </code>
                  <span className="flex-1 text-muted-foreground leading-relaxed pt-0.5">
                    Instrucciones específicas para el CTA basadas en los atributos del producto (Nuevo, Preventa, Sale, Outlet)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold">
                Template del Prompt
              </label>
              <span className="text-xs text-muted-foreground font-mono">
                {prompt.length.toLocaleString()} caracteres
              </span>
            </div>
            <div className="flex-1 border rounded-lg overflow-hidden bg-muted/30">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-muted-foreground">Cargando prompt...</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="min-h-[450px] font-mono text-sm leading-relaxed resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                    placeholder="Escribí tu prompt aquí..."
                    disabled={isLoading}
                  />
                </ScrollArea>
              )}
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
