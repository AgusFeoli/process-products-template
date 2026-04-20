import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import {
  ensureMaestraTable,
  ensureMaestraColumns,
  insertMaestraRows,
  deleteAllMaestraRows,
  saveMaestraColumnMeta,
} from "@/lib/maestra-db";
import { buildColumnMeta } from "@/lib/maestra-columns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string | null; // "replace" or "append"

    if (!file) {
      return NextResponse.json(
        { success: false, message: "No se proporcionó archivo" },
        { status: 400 }
      );
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx") && !fileName.endsWith(".xls")) {
      return NextResponse.json(
        { success: false, message: "El archivo debe ser .xlsx o .xls" },
        { status: 400 }
      );
    }

    // Ensure base table exists
    await ensureMaestraTable();

    // Parse Excel
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
      return NextResponse.json(
        { success: false, message: "El archivo debe tener encabezados y al menos una fila de datos" },
        { status: 400 }
      );
    }

    // Parse headers from the first row of the file
    const excelHeaders = (data[0] as (string | number | null)[]).map((h) =>
      String(h ?? "").trim()
    );

    // Build column metadata from the file's headers
    const columnMeta = buildColumnMeta(excelHeaders);

    if (columnMeta.length === 0) {
      return NextResponse.json(
        { success: false, message: "No se encontraron encabezados válidos en el archivo" },
        { status: 400 }
      );
    }

    // Save column metadata so the UI knows the column names
    await saveMaestraColumnMeta(columnMeta);

    // Ensure all columns exist in the DB table
    await ensureMaestraColumns(columnMeta);

    // Map DB column names for building row objects
    const dbHeaders = columnMeta.map((m) => m.dbColumn);

    // Parse rows
    const rows: Record<string, string | number | null>[] = [];
    for (let i = 1; i < data.length; i++) {
      const values = data[i] as (string | number | null)[];
      if (!values || values.length === 0 || values.every((v) => v === null || v === undefined || v === "")) {
        continue;
      }
      const row: Record<string, string | number | null> = {};
      for (let j = 0; j < dbHeaders.length; j++) {
        const val = values[j];
        row[dbHeaders[j]] = val !== null && val !== undefined ? val : null;
      }
      rows.push(row);
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "No se encontraron filas de datos" },
        { status: 400 }
      );
    }

    // If mode is "replace", delete existing data first
    if (mode === "replace") {
      await deleteAllMaestraRows();
    }

    // Insert rows
    const result = await insertMaestraRows(rows, columnMeta);

    return NextResponse.json({
      success: true,
      message: `Se importaron ${result.inserted} de ${rows.length} filas`,
      inserted: result.inserted,
      total: rows.length,
      errors: result.errors.length > 0 ? result.errors.slice(0, 20) : undefined,
      errorCount: result.errors.length,
      columnMeta,
    });
  } catch (error) {
    console.error("Upload maestra error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Error al procesar archivo",
      },
      { status: 500 }
    );
  }
}
