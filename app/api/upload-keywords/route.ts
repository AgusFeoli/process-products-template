import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  ensureKeywordsTable,
  insertKeywords,
  deleteAllKeywords,
} from "@/lib/maestra-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Common SEMrush column name mappings (case-insensitive)
const COLUMN_MAP: Record<string, string> = {
  keyword: "keyword",
  "search volume": "search_volume",
  volume: "search_volume",
  "keyword difficulty": "keyword_difficulty",
  "kd%": "keyword_difficulty",
  kd: "keyword_difficulty",
  difficulty: "keyword_difficulty",
  cpc: "cpc",
  "cpc (usd)": "cpc",
  "com.": "competitive_density",
  "competitive density": "competitive_density",
  competition: "competitive_density",
  trend: "trend",
  // Spanish variants
  "volumen de busqueda": "search_volume",
  "volumen de búsqueda": "search_volume",
  "dificultad de palabra clave": "keyword_difficulty",
  "densidad competitiva": "competitive_density",
  tendencia: "trend",
};

function normalizeHeader(header: string): string {
  const lower = header.toLowerCase().trim();
  return COLUMN_MAP[lower] || lower.replace(/[^a-z0-9]+/g, "_");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, message: "No se proporcionó archivo" },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (
      !fileName.endsWith(".xlsx") &&
      !fileName.endsWith(".xls") &&
      !fileName.endsWith(".csv")
    ) {
      return NextResponse.json(
        { success: false, message: "El archivo debe ser .xlsx, .xls o .csv" },
        { status: 400 }
      );
    }

    await ensureKeywordsTable();

    // Delete existing keywords (replace mode)
    const deletedCount = await deleteAllKeywords();

    // Parse file
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(uint8, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      worksheet,
      { header: 1, defval: null }
    );

    if (data.length < 2) {
      return NextResponse.json(
        {
          success: false,
          message:
            "El archivo debe tener encabezados y al menos una fila de datos",
        },
        { status: 400 }
      );
    }

    // Parse headers
    const excelHeaders = (data[0] as (string | number | null)[]).map((h) =>
      String(h ?? "").trim()
    );
    const dbHeaders = excelHeaders.map(normalizeHeader);

    // Find the keyword column index
    const keywordIdx = dbHeaders.indexOf("keyword");
    if (keywordIdx === -1) {
      return NextResponse.json(
        {
          success: false,
          message:
            'No se encontró una columna "Keyword" en el archivo. Asegúrate de que el archivo tenga una columna con ese nombre.',
        },
        { status: 400 }
      );
    }

    // Parse rows
    const rows: Record<string, string | number | null>[] = [];
    for (let i = 1; i < data.length; i++) {
      const values = data[i] as (string | number | null)[];
      if (
        !values ||
        values.length === 0 ||
        values.every((v) => v === null || v === undefined || v === "")
      ) {
        continue;
      }

      const row: Record<string, string | number | null> = {};
      // Collect all extra columns into extra_data
      const extraFields: Record<string, string | number | null> = {};

      for (let j = 0; j < dbHeaders.length; j++) {
        const dbCol = dbHeaders[j];
        const val = values[j] ?? null;

        if (
          [
            "keyword",
            "search_volume",
            "keyword_difficulty",
            "cpc",
            "competitive_density",
            "trend",
          ].includes(dbCol)
        ) {
          row[dbCol] = val;
        } else {
          if (val !== null && val !== undefined && val !== "") {
            extraFields[excelHeaders[j]] = val;
          }
        }
      }

      // Only add rows that have a keyword
      if (row.keyword && String(row.keyword).trim()) {
        if (Object.keys(extraFields).length > 0) {
          row.extra_data = JSON.stringify(extraFields);
        }
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "No se encontraron filas con keywords válidos" },
        { status: 400 }
      );
    }

    const result = await insertKeywords(rows);

    return NextResponse.json({
      success: true,
      message: `Se importaron ${result.inserted} de ${rows.length} keywords${deletedCount > 0 ? ` (se reemplazaron ${deletedCount} keywords anteriores)` : ""}`,
      inserted: result.inserted,
      total: rows.length,
      replaced: deletedCount,
      errors:
        result.errors.length > 0 ? result.errors.slice(0, 20) : undefined,
      errorCount: result.errors.length,
    });
  } catch (error) {
    console.error("Upload keywords error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al procesar archivo de keywords",
      },
      { status: 500 }
    );
  }
}
