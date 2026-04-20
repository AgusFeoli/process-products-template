import { NextResponse } from "next/server";
import { bulkUpdateMagentoDynamicFieldsByRowId } from "@/lib/maestra-db";

export const dynamic = "force-dynamic";

interface ApprovedChange {
  _row_id: string;
  fields: Record<string, string>;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { changes, dbColumns } = body as {
      changes: ApprovedChange[];
      dbColumns: string[];
    };

    if (!changes || changes.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No hay cambios para aplicar",
      });
    }

    if (!dbColumns || dbColumns.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se especificaron columnas",
      });
    }

    // Build update rows in the format expected by bulkUpdateMagentoDynamicFieldsByRowId
    const updateRows = changes.map((change) => {
      const row: Record<string, unknown> = { _row_id: change._row_id };
      for (const col of dbColumns) {
        if (change.fields[col] !== undefined) {
          row[col] = change.fields[col];
        }
      }
      return row;
    });

    const updated = await bulkUpdateMagentoDynamicFieldsByRowId(
      updateRows,
      dbColumns
    );

    return NextResponse.json({
      success: true,
      message: `Se aplicaron cambios AI para ${updated} productos`,
      updated,
    });
  } catch (error) {
    console.error("Apply AI changes error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al aplicar cambios AI",
      },
      { status: 500 }
    );
  }
}
