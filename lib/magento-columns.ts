// Magento CSV column definitions

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
