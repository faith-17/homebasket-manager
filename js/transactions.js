// Transaction operations go through database RPCs so authorization, idempotency, and audit
// logging are enforced by PostgreSQL rather than by a hidden or disabled browser control.
import { supabase } from "./supabase.js";
export { parseNairaToKobo } from "./money.js";

export const TRANSACTION_TYPES = [
  { value: "daily_sales", label: "Daily sales total", account: true },
  { value: "stock_purchase", label: "Major stock purchase", account: true },
  { value: "stock_restock", label: "Small stock restock", account: true },
  { value: "operating_expense", label: "Operating expense", account: true },
  { value: "household_use", label: "Household goods taken from stock", account: false },
  { value: "stock_loss", label: "Stock loss / damaged goods", account: false },
  { value: "owner_withdrawal", label: "Owner withdrawal", account: true },
  { value: "family_contribution", label: "Family contribution", account: true },
  { value: "account_transfer", label: "Transfer between accounts", account: true, transfer: true },
  { value: "opening_balance", label: "Opening account balance", account: true, direction: true },
  { value: "opening_stock", label: "Opening stock valuation", account: false },
  { value: "closing_stock", label: "Closing stock valuation", account: false }
];

// Stable request IDs let a retry after a dropped connection reuse the same database operation.
export function createRequestId() {
  return crypto.randomUUID();
}

export async function createTransaction(businessId, requestId, record) {
  const { data, error } = await supabase.rpc("create_business_transaction", {
    p_business_id: businessId,
    p_request_id: requestId,
    p_record: record
  });
  if (error) throw error;
  return data;
}

export async function updateTransaction(transactionId, record) {
  const { data, error } = await supabase.rpc("update_business_transaction", {
    p_transaction_id: transactionId,
    p_record: record
  });
  if (error) throw error;
  return data;
}

export async function deleteTransaction(transactionId) {
  const { data, error } = await supabase.rpc("delete_business_transaction", {
    p_transaction_id: transactionId
  });
  if (error) throw error;
  return data;
}

// Load all pages for reliable date-range reports and searches instead of silently truncating
// at the API's default row limit.
export async function loadTransactions(businessId) {
  const records = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("business_transactions")
      .select("id, business_id, request_id, transaction_type, occurred_on, amount_kobo, category, account_id, transfer_to_account_id, balance_direction, notes, created_by, created_at, updated_at")
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    records.push(...(data || []));
    if (!data || data.length < pageSize) return records;
  }
}

export function transactionTypeLabel(type) {
  return TRANSACTION_TYPES.find((item) => item.value === type)?.label || type;
}
