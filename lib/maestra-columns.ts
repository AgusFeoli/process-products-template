// Excel header -> DB column mapping
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

// Reverse mapping: DB column -> Excel header
export const MAESTRA_DB_TO_EXCEL: Record<string, string> = Object.fromEntries(
  Object.entries(MAESTRA_COLUMN_MAP).map(([excel, db]) => [db, excel])
);

// Column display order for the table
export const MAESTRA_TABLE_COLUMN_ORDER = [
  "item_no", "item_description", "super_familia", "familia", "sub_familia",
  "sub_agrupacion", "temporalidad", "clasificacion_abc", "estado_articulo",
  "tipo_articulo", "pais_origen", "procedencia", "coleccion", "calidad",
  "composicion", "rubro", "diseno", "color", "color_homologado", "estilo",
  "marca", "categoria_venta", "exclusivo", "shipping_type", "inner_qty",
  "sub_inner", "length_sales_unit", "width_sales_unit", "height_sales_unit",
  "weight_sales_unit", "volume_sales_unit", "profundidad", "ancho_unidad",
  "alto_unidad", "tamano", "peso_neto_unidad", "unidades_por_pallet",
];

// Export order for XLSX (Excel headers)
export const MAESTRA_EXPORT_ORDER = [
  "Item No.", "Item Description", "Super Familia", "Familia", "Sub Familia",
  "Sub Agrupación", "Temporalidad", "CLASIFICACION ABC", "Estado del Artículo",
  "Tipo de Artículo", "Pais Origen", "Procedencia", "Colección", "Calidad",
  "Composición", "Rubro", "Diseño", "Color", "Color Homologado", "Estilo",
  "Marca", "Categoria de venta", "Exclusivo", "Shipping_Type", "Inner",
  "Sub Inner", "Length 1 - Sales Unit", "Width 1 - Sales Unit",
  "Height 1 - Sales Unit", "Weight 1 - Sales Unit", "Volume - Sales Unit",
  "Profundidad", "Ancho(Unidad)", "Alto(Unidad)", "Tamaño",
  "Peso Neto (Unidad)", "Unidades por pallet",
];

// Get display name for a DB column
export function getMaestraDisplayName(dbColumn: string): string {
  if (dbColumn === "created_at") return "Creado";
  if (dbColumn === "updated_at") return "Actualizado";
  return MAESTRA_DB_TO_EXCEL[dbColumn] || dbColumn;
}

// MaestraProduct interface (shared between client and server)
export interface MaestraProduct {
  id?: number;
  item_no: string | null;
  item_description: string | null;
  super_familia: string | null;
  familia: string | null;
  sub_familia: string | null;
  sub_agrupacion: string | null;
  temporalidad: string | null;
  clasificacion_abc: string | null;
  estado_articulo: string | null;
  tipo_articulo: string | null;
  pais_origen: string | null;
  procedencia: string | null;
  coleccion: string | null;
  calidad: string | null;
  composicion: string | null;
  rubro: string | null;
  diseno: string | null;
  color: string | null;
  color_homologado: string | null;
  estilo: string | null;
  marca: string | null;
  categoria_venta: string | null;
  exclusivo: string | null;
  shipping_type: string | null;
  inner_qty: number | null;
  sub_inner: number | null;
  length_sales_unit: number | null;
  width_sales_unit: number | null;
  height_sales_unit: number | null;
  weight_sales_unit: number | null;
  volume_sales_unit: number | null;
  profundidad: number | null;
  ancho_unidad: number | null;
  alto_unidad: number | null;
  tamano: string | null;
  peso_neto_unidad: number | null;
  unidades_por_pallet: number | null;
  created_at?: string;
  updated_at?: string;
}
