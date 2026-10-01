/**
 * Invoice line / address shapes shared by the client invoice actions
 * (`components/orders/invoice-actions.tsx`) and the server PDF renderer
 * (`server/invoice-pdf-server.tsx`). Types only — safe in any bundle.
 */
export interface InvoiceItem {
  name: string;
  quantity: number;
  unit_price: number;
  notes?: string | null;
}

export interface InvoiceAddress {
  label?: string | null;
  text?: string | null;
  city?: string | null;
  district?: string | null;
}
