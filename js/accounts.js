// Account balances are a database view over transaction history, not cached browser totals.
import { supabase } from "./supabase.js";
import { formatKobo } from "./money.js";
export { formatKobo } from "./money.js";

export async function loadAccounts(businessId) {
  const { data, error } = await supabase
    .from("account_balances")
    .select("account_id, business_id, name, account_type, balance_kobo, sort_order")
    .eq("business_id", businessId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}
