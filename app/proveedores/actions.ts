"use server";

import {
  getProveedores as getProveedoresFromDb,
  insertProveedor as insertProveedorDb,
  insertProveedoresBulk,
  updateProveedor as updateProveedorDb,
  deleteProveedor as deleteProveedorDb,
  deleteAllProveedores as deleteAllProveedoresDb,
  getSkipAiProveedorNames,
  type Proveedor,
} from "@/lib/proveedores-db";
import * as XLSX from "xlsx";

export type { Proveedor };

export async function fetchProveedores(): Promise<{
  success: boolean;
  data?: Proveedor[];
  error?: string;
}> {
  try {
    const data = await getProveedoresFromDb();
    return { success: true, data };
  } catch (error) {
    console.error("Fetch proveedores error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al obtener proveedores",
    };
  }
}

export async function addProveedor(proveedor: Omit<Proveedor, "id">): Promise<{
  success: boolean;
  data?: Proveedor;
  error?: string;
}> {
  try {
    const data = await insertProveedorDb(proveedor);
    return { success: true, data };
  } catch (error) {
    console.error("Add proveedor error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al agregar proveedor",
    };
  }
}

export async function editProveedor(
  id: number,
  data: Partial<Omit<Proveedor, "id">>
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateProveedorDb(id, data);
    return { success: true };
  } catch (error) {
    console.error("Edit proveedor error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al editar proveedor",
    };
  }
}

export async function removeProveedor(
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteProveedorDb(id);
    return { success: true };
  } catch (error) {
    console.error("Delete proveedor error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al eliminar proveedor",
    };
  }
}

export async function importProveedores(
  formData: FormData
): Promise<{
  success: boolean;
  inserted?: number;
  errors?: string[];
  error?: string;
}> {
  try {
    const file = formData.get("file") as File;
    if (!file) {
      return { success: false, error: "No se proporcionó archivo" };
    }

    const fileName = file.name.toLowerCase();
    const proveedores: Omit<Proveedor, "id">[] = [];

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const workbook = XLSX.read(uint8, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
        header: 1,
        defval: null,
      });

      if (data.length < 2) {
        return {
          success: false,
          error: "El archivo debe tener encabezados y al menos una fila de datos",
        };
      }

      // Find column indices from headers
      const headers = (data[0] as (string | number | null)[]).map((h) =>
        String(h ?? "")
          .trim()
          .toLowerCase()
      );
      const codigoIdx = headers.findIndex(
        (h) => h === "proveedor" || h === "codigo" || h === "código"
      );
      const nombreIdx = headers.findIndex(
        (h) => h === "nombre" || h === "name"
      );
      const tipoIdx = headers.findIndex(
        (h) =>
          h === "tipo" ||
          h === "magma / magmaxmagma" ||
          h.includes("magma")
      );

      for (let i = 1; i < data.length; i++) {
        const row = data[i] as (string | number | null)[];
        if (!row || row.length === 0 || row.every((v) => v === null || v === undefined || v === "")) {
          continue;
        }

        const codigo = codigoIdx >= 0 ? Number(row[codigoIdx]) : 0;
        const nombre =
          nombreIdx >= 0 ? String(row[nombreIdx] ?? "").trim() : "";
        const tipo =
          tipoIdx >= 0 ? String(row[tipoIdx] ?? "").trim() : "";

        if (codigo && nombre) {
          proveedores.push({ codigo, nombre, tipo });
        }
      }
    } else {
      // Parse as CSV
      const content = await file.text();
      const lines = content.split(/\r?\n/).filter((line) => line.trim());

      if (lines.length < 2) {
        return {
          success: false,
          error: "El archivo debe tener encabezados y al menos una fila de datos",
        };
      }

      const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
      const codigoIdx = headers.findIndex(
        (h) => h === "proveedor" || h === "codigo" || h === "código"
      );
      const nombreIdx = headers.findIndex(
        (h) => h === "nombre" || h === "name"
      );
      const tipoIdx = headers.findIndex(
        (h) =>
          h === "tipo" ||
          h === "magma / magmaxmagma" ||
          h.includes("magma")
      );

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const codigo = codigoIdx >= 0 ? Number(values[codigoIdx]) : 0;
        const nombre =
          nombreIdx >= 0 ? (values[nombreIdx] || "").trim() : "";
        const tipo =
          tipoIdx >= 0 ? (values[tipoIdx] || "").trim() : "";

        if (codigo && nombre) {
          proveedores.push({ codigo, nombre, tipo });
        }
      }
    }

    if (proveedores.length === 0) {
      return {
        success: false,
        error: "No se encontraron proveedores válidos en el archivo",
      };
    }

    const result = await insertProveedoresBulk(proveedores);

    return {
      success: true,
      inserted: result.inserted,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  } catch (error) {
    console.error("Import proveedores error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al importar proveedores",
    };
  }
}

// Helper function to parse CSV line handling quoted values
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}

export async function removeAllProveedores(): Promise<{
  success: boolean;
  deletedCount?: number;
  error?: string;
}> {
  try {
    const result = await deleteAllProveedoresDb();
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error("Delete all proveedores error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Error al eliminar todos los proveedores",
    };
  }
}

export async function toggleSkipAi(
  id: number,
  skipAi: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateProveedorDb(id, { skip_ai: skipAi });
    return { success: true };
  } catch (error) {
    console.error("Toggle skip_ai error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al actualizar",
    };
  }
}

export async function fetchSkipAiProveedorNames(): Promise<{
  success: boolean;
  data?: string[];
  error?: string;
}> {
  try {
    const data = await getSkipAiProveedorNames();
    return { success: true, data };
  } catch (error) {
    console.error("Fetch skip_ai names error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al obtener proveedores skip_ai",
    };
  }
}

export async function exportProveedoresXlsx(): Promise<{
  success: boolean;
  base64?: string;
  filename?: string;
  error?: string;
}> {
  try {
    const proveedores = await getProveedoresFromDb();

    const headers = ["Proveedor", "Nombre", "magma / magmaxmagma"];
    const rows = proveedores.map((p) => [p.codigo, p.nombre, p.tipo || ""]);

    const wb = XLSX.utils.book_new();
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 20 }];

    XLSX.utils.book_append_sheet(wb, ws, "Hoja 1");

    const buffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

    return {
      success: true,
      base64: buffer,
      filename: "proveedores-export.xlsx",
    };
  } catch (error) {
    console.error("Export proveedores error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error al exportar proveedores",
    };
  }
}
