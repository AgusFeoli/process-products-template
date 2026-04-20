// Column metadata type: maps Excel headers to DB column names (preserves import order)
export interface ColumnMeta {
  excelHeader: string;
  dbColumn: string;
}

// Well-known Excel header -> DB column mapping (used as fallback for known headers)
export const MAESTRA_COLUMN_MAP: Record<string, string> = {
  "Item No.": "item_no",
  "Item Description": "item_description",
  "Super Familia": "super_familia",
  "Familia": "familia",
  "Sub Familia": "sub_familia",
  "Sub Agrupación": "sub_agrupacion",
  "Temporalidad": "temporalidad",
  "CLASIFICACION ABC": "clasificacion_abc",
  "Estado del Artículo": "estado_articulo",
  "Tipo de Artículo": "tipo_articulo",
  "Pais Origen": "pais_origen",
  "Procedencia": "procedencia",
  "Colección": "coleccion",
  "Calidad": "calidad",
  "Composición": "composicion",
  "Rubro": "rubro",
  "Diseño": "diseno",
  "Color": "color",
  "Color Homologado": "color_homologado",
  "Estilo": "estilo",
  "Marca": "marca",
  "Categoria de venta": "categoria_venta",
  "Exclusivo": "exclusivo",
  "Shipping_Type": "shipping_type",
  "Inner": "inner_qty",
  "Sub Inner": "sub_inner",
  "Length 1 - Sales Unit": "length_sales_unit",
  "Width 1 - Sales Unit": "width_sales_unit",
  "Height 1 - Sales Unit": "height_sales_unit",
  "Weight 1 - Sales Unit": "weight_sales_unit",
  "Volume - Sales Unit": "volume_sales_unit",
  "Profundidad": "profundidad",
  "Ancho(Unidad)": "ancho_unidad",
  "Alto(Unidad)": "alto_unidad",
  "Tamaño": "tamano",
  "Peso Neto (Unidad)": "peso_neto_unidad",
  "Unidades por pallet": "unidades_por_pallet",
};

// Convert an Excel header to a safe DB column name
export function excelHeaderToDbColumn(header: string): string {
  // Check known mapping first
  if (MAESTRA_COLUMN_MAP[header]) {
    return MAESTRA_COLUMN_MAP[header];
  }
  // Generate a safe column name: lowercase, replace non-alphanumeric with underscores, trim
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 63) || "col";
}

// Build ColumnMeta array from Excel header row
export function buildColumnMeta(excelHeaders: string[]): ColumnMeta[] {
  const seen = new Set<string>();
  return excelHeaders
    .filter((h) => h.trim() !== "")
    .map((header) => {
      let dbColumn = excelHeaderToDbColumn(header);
      // Ensure unique db column names
      const base = dbColumn;
      let suffix = 2;
      while (seen.has(dbColumn)) {
        dbColumn = `${base}_${suffix}`;
        suffix++;
      }
      seen.add(dbColumn);
      return { excelHeader: header, dbColumn };
    });
}

// Get display name for a DB column given column metadata
export function getMaestraDisplayName(
  dbColumn: string,
  columnMeta?: ColumnMeta[]
): string {
  if (dbColumn === "created_at") return "Creado";
  if (dbColumn === "updated_at") return "Actualizado";
  if (columnMeta) {
    const meta = columnMeta.find((m) => m.dbColumn === dbColumn);
    if (meta) return meta.excelHeader;
  }
  // Fallback: reverse lookup from known map
  const reverseMap = Object.fromEntries(
    Object.entries(MAESTRA_COLUMN_MAP).map(([excel, db]) => [db, excel])
  );
  return reverseMap[dbColumn] || dbColumn;
}

// MaestraProduct is now dynamic - use Record type
export type MaestraProduct = Record<string, string | number | null | undefined>;
