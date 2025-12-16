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

const DEFAULT_CTA_INSTRUCTIONS = {
  nuevo: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **NUEVO**.
- El CTA debe enfatizar **novedad**, **exclusividad**, **estar a la vanguardia** y **ser de los primeros**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"Descubrí esta novedad exclusiva"*
  *"Sé de los primeros en tenerlo"*
  *"Llevate el tuyo, es edición nueva"*
  *"No te pierdas esta pieza única"*
  *"Sumalo a tu colección, es tendencia"*
  *"Está nuevo, descubrilo primero"*
  *"Novedad exclusiva, llevatela ya"*
  *"Sé la primera en tenerlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
  preventa: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **PREVENTA**.
- El CTA debe enfatizar **reservar**, **asegurar**, **anticiparse** y **ser de los primeros**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"Reservá el tuyo ahora y asegurate de tenerlo"*
  *"Sé de los primeros en llevártelo"*
  *"Anticipate y reservalo ya"*
  *"Asegurá tu pieza, reservalo ahora"*
  *"No te quedes sin el tuyo, reservalo"*
  *"Reservalo antes que se agote"*
  *"Asegurá tu lugar, es preventa"*
  *"Anticipate y llevatelo primero"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
  sale: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **SALE** (en oferta).
- El CTA debe enfatizar **oportunidad**, **aprovechar la oferta** y **no perder el momento**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Aprovechá esta oferta especial!"*
  *"No dejes pasar esta oportunidad"*
  *"Sumalo a tu guardarropa, es tu momento"*
  *"Llevatelo ahora, está en oferta"*
  *"Aprovechá el precio especial"*
  *"No te pierdas esta oportunidad única"*
  *"Hacelo tuyo mientras está en oferta"*
  *"Es el momento ideal para sumarlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares. El CTA de SALE debe ser diferente al de OUTLET.`,
  outlet: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **OUTLET** (liquidación final).
- El CTA debe enfatizar **última oportunidad**, **stock limitado**, **no volver a encontrar** y **liquidación final**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Última oportunidad! No volverás a encontrarlo"*
  *"Stock limitado, no te quedes sin el tuyo"*
  *"Liquidación final, aprovechá antes de que se agote"*
  *"Últimas unidades, no te lo pierdas"*
  *"Esta es tu última chance, llevatelo ya"*
  *"No volverás a verlo a este precio"*
  *"Aprovechá esta liquidación, quedan pocos"*
  *"Última oportunidad de tenerlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
  default: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El CTA debe enfatizar **exclusividad** y **urgencia** de adquirir el producto.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Llevate el tuyo antes de que se agote!"*
  *"Descubrí esta pieza única y exclusiva"*
  *"No te lo pierdas"*
  *"Sumalo a tu colección ahora"*
  *"Hacelo tuyo, quedan pocas unidades"*
  *"Llevatelo, es exclusivo"*
  *"No dejes pasar esta oportunidad"*
  *"Sumalo a tu guardarropa ya"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`
};

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
  const [ctaInstructions, setCtaInstructions] = useState(DEFAULT_CTA_INSTRUCTIONS);
  
  // Collapsible states
  const [showImageConfig, setShowImageConfig] = useState(false);
  const [showProductContextConfig, setShowProductContextConfig] = useState(false);
  const [showCtaConfig, setShowCtaConfig] = useState(false);

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
        if (data.ctaInstructionsConfig) {
          setCtaInstructions(data.ctaInstructionsConfig);
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
          productContextConfig: productContextTemplate,
          ctaInstructionsConfig: ctaInstructions
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
        if (data.ctaInstructionsConfig) {
          setCtaInstructions(data.ctaInstructionsConfig);
        }
      } else {
        // Reset to defaults
        setPrompt(DEFAULT_PROMPT_TEMPLATE);
        setImageInstructions(DEFAULT_IMAGE_INSTRUCTIONS);
        setProductContextTemplate(DEFAULT_PRODUCT_CONTEXT_TEMPLATE);
        setCtaInstructions(DEFAULT_CTA_INSTRUCTIONS);
      }
    } catch (error) {
      console.error("Error resetting prompt:", error);
      // Reset to defaults on error
      setPrompt(DEFAULT_PROMPT_TEMPLATE);
      setImageInstructions(DEFAULT_IMAGE_INSTRUCTIONS);
      setProductContextTemplate(DEFAULT_PRODUCT_CONTEXT_TEMPLATE);
      setCtaInstructions(DEFAULT_CTA_INSTRUCTIONS);
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

            {/* CTA_INSTRUCTIONS Configuration */}
            <Card className="border-orange-200 bg-gradient-to-br from-orange-50/80 to-amber-50/80 dark:from-orange-950/30 dark:to-amber-950/30 dark:border-orange-800">
              <CardHeader 
                className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setShowCtaConfig(!showCtaConfig)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2 font-semibold">
                      <code className="px-2 py-1 bg-orange-100 dark:bg-orange-900/50 rounded text-orange-800 dark:text-orange-200 font-mono text-xs">
                        {"{{CTA_INSTRUCTIONS}}"}
                      </code>
                      <span>Configuración</span>
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      Personalizá las instrucciones de CTA según el tipo de producto
                    </CardDescription>
                  </div>
                  {showCtaConfig ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
              {showCtaConfig && (
                <CardContent className="pt-0 space-y-4">
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para productos NUEVOS:</label>
                    <Textarea
                      value={ctaInstructions.nuevo}
                      onChange={(e) => setCtaInstructions({ ...ctaInstructions, nuevo: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones de CTA para productos nuevos..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para productos en PREVENTA:</label>
                    <Textarea
                      value={ctaInstructions.preventa}
                      onChange={(e) => setCtaInstructions({ ...ctaInstructions, preventa: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones de CTA para preventa..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para productos en SALE:</label>
                    <Textarea
                      value={ctaInstructions.sale}
                      onChange={(e) => setCtaInstructions({ ...ctaInstructions, sale: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones de CTA para productos en oferta..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para productos en OUTLET:</label>
                    <Textarea
                      value={ctaInstructions.outlet}
                      onChange={(e) => setCtaInstructions({ ...ctaInstructions, outlet: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones de CTA para productos outlet..."
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Para productos sin atributos especiales (Default):</label>
                    <Textarea
                      value={ctaInstructions.default}
                      onChange={(e) => setCtaInstructions({ ...ctaInstructions, default: e.target.value })}
                      className="min-h-[180px] font-mono text-xs"
                      placeholder="Instrucciones de CTA por defecto..."
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
