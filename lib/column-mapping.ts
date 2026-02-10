// Excel column mapping: Spanish Excel headers -> lowercase DB columns
export const CSV_COLUMN_MAP: Record<string, string> = {
  "Proveedor": "proveedor",
  "Modelo": "modelo",
  "Descripción": "descripcion",
  "Composición": "composicion",
  "Nuevo": "nuevo",
  "Preventa": "preventa",
  "Sale": "sale",
  "Outlet": "outlet",
  "Descripción e-Shop": "descripcion_eshop",
  "Repite Color": "repite_color",
  "Prioridad": "prioridad",
  "Video": "video",
  "Imagen": "imagen",
  "IA": "ia",
};

// Reverse mapping: DB columns -> Spanish Excel headers
export const DB_TO_CSV_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CSV_COLUMN_MAP).map(([csv, db]) => [db, csv])
);

// Fixed Excel column order for export - matches the exact import format
export const XLSX_EXPORT_ORDER = [
  "Proveedor",
  "Modelo",
  "Descripción",
  "Composición",
  "Nuevo",
  "Preventa",
  "Sale",
  "Outlet",
  "Descripción e-Shop",
  "Repite Color",
  "Prioridad",
  "Video",
];

// Keep CSV_EXPORT_ORDER as alias for backward compatibility
export const CSV_EXPORT_ORDER = XLSX_EXPORT_ORDER;

// DB column order for table display (includes all columns)
export const TABLE_COLUMN_ORDER = [
  "proveedor",
  "modelo",
  "descripcion",
  "descripcion_eshop",
  "composicion",
  "nuevo",
  "preventa",
  "sale",
  "outlet",
  "repite_color",
  "prioridad",
  "video",
  "imagen",
  "ia",
  "image",
  "created_at",
  "updated_at",
];

// Additional display name mappings for non-CSV columns
export const EXTRA_DISPLAY_NAMES: Record<string, string> = {
  "image": "Image",
  "created_at": "Creado",
  "updated_at": "Actualizado",
};

// Get display name for any column
export function getColumnDisplayName(dbColumn: string): string {
  return DB_TO_CSV_MAP[dbColumn] || EXTRA_DISPLAY_NAMES[dbColumn] || dbColumn;
}
