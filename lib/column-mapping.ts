// CSV column mapping: Spanish CSV headers -> lowercase DB columns
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
};

// Reverse mapping: DB columns -> Spanish CSV headers
export const DB_TO_CSV_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(CSV_COLUMN_MAP).map(([csv, db]) => [db, csv])
);

// Fixed CSV column order for export (does NOT include image, created_at, updated_at)
export const CSV_EXPORT_ORDER = [
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

// DB column order for table display (includes all columns)
export const TABLE_COLUMN_ORDER = [
  "proveedor",
  "modelo",
  "descripcion",
  "composicion",
  "nuevo",
  "preventa",
  "sale",
  "outlet",
  "descripcion_eshop",
  "repite_color",
  "prioridad",
  "video",
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
