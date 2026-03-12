// Magento CSV column definitions

// Exact column order for Magento CSV export (semicolon-separated)
export const MAGENTO_CSV_COLUMNS = [
  "sku",
  "name",
  "url_key",
  "meta_title",
  "meta_keywords",
  "attribute_set_code",
  "product_type",
  "product_websites",
  "tax_class_name",
  "visibility",
  "price",
  "weight",
  "display_product_options_in",
  "out_of_stock_qty",
  "use_config_min_qty",
  "is_qty_decimal",
  "allow_backorders",
  "use_config_backorders",
  "min_cart_qty",
  "use_config_min_sale_qty",
  "max_cart_qty",
  "use_config_max_sale_qty",
  "notify_on_stock_below",
  "use_config_notify_stock_qty",
  "manage_stock",
  "use_config_manage_stock",
  "use_config_qty_increments",
  "qty_increments",
  "use_config_enable_qty_inc",
  "enable_qty_increments",
  "is_decimal_divided",
  "website_id",
  "deferred_stock_update",
  "use_config_deferred_stock_update",
  "shipping_type",
] as const;

// Fixed values that never change in the Magento CSV
export const MAGENTO_FIXED_VALUES: Record<string, string | number> = {
  attribute_set_code: "Default",
  product_type: "simple",
  product_websites: "base",
  tax_class_name: "Taxable Goods",
  visibility: "Catalog, Search",
  display_product_options_in: "Block after Info Column",
  out_of_stock_qty: 0,
  use_config_min_qty: 1,
  is_qty_decimal: 0,
  allow_backorders: 0,
  use_config_backorders: 1,
  min_cart_qty: 10000,
  use_config_min_sale_qty: 1,
  max_cart_qty: 100000000,
  use_config_max_sale_qty: 1,
  notify_on_stock_below: 10000,
  use_config_notify_stock_qty: 1,
  manage_stock: 1,
  use_config_manage_stock: 1,
  use_config_qty_increments: 1,
  qty_increments: 10000,
  use_config_enable_qty_inc: 1,
  enable_qty_increments: 0,
  is_decimal_divided: 0,
  website_id: 0,
  deferred_stock_update: 0,
  use_config_deferred_stock_update: 1,
};

// Fields that can be generated/filled by AI
export const MAGENTO_AI_FIELDS = [
  "name",
  "url_key",
  "meta_title",
  "meta_keywords",
  "meta_description",
  "short_description",
  "long_description",
] as const;

// Fields that come from Maestra data
export const MAGENTO_MAESTRA_MAPPED_FIELDS: Record<string, string> = {
  sku: "item_no",
  shipping_type: "shipping_type",
  weight: "weight_sales_unit",
};

// Columns visible in the Magento dataset view (editable/AI-generated fields + key fields)
export const MAGENTO_VIEW_COLUMNS = [
  "sku",
  "name",
  "url_key",
  "meta_title",
  "meta_keywords",
  "meta_description",
  "short_description",
  "long_description",
  "price",
  "weight",
  "shipping_type",
] as const;

// Display names for Magento columns
export const MAGENTO_DISPLAY_NAMES: Record<string, string> = {
  sku: "SKU",
  name: "Name",
  url_key: "URL Key",
  meta_title: "Meta Title",
  meta_keywords: "Meta Keywords",
  meta_description: "Meta Description",
  short_description: "Short Description",
  long_description: "Long Description",
  price: "Price",
  weight: "Weight",
  shipping_type: "Shipping Type",
  attribute_set_code: "Attribute Set",
  product_type: "Product Type",
  product_websites: "Websites",
  tax_class_name: "Tax Class",
  visibility: "Visibility",
};

export function getMagentoDisplayName(column: string): string {
  return MAGENTO_DISPLAY_NAMES[column] || column;
}

// Interface for Magento product data stored in DB
export interface MagentoProduct {
  id?: number;
  maestra_id: number;
  sku: string | null;
  name: string | null;
  url_key: string | null;
  meta_title: string | null;
  meta_keywords: string | null;
  meta_description: string | null;
  short_description: string | null;
  long_description: string | null;
  price: number | null;
  weight: number | null;
  shipping_type: string | null;
  created_at?: string;
  updated_at?: string;
}
