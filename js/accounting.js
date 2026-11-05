// Recalculate balances from the same ledger rules as the SQL view to verify account totals.
// The app still displays the database view; this independent check catches faulty ledger effects.
export function calculateAccountBalances(accounts, transactions) {
  const balances = new Map(accounts.map((account) => [account.account_id, 0n]));
  transactions.forEach((record) => {
    const amount = BigInt(record.amount_kobo);
    const accountId = record.account_id;
    if (accountId && balances.has(accountId)) {
      let movement = 0n;
      switch (record.transaction_type) {
        case "daily_sales":
        case "family_contribution":
          movement = amount;
          break;
        case "opening_balance":
          movement = amount * BigInt(record.balance_direction || 1);
          break;
        case "account_transfer":
        case "stock_purchase":
        case "stock_restock":
        case "operating_expense":
        case "owner_withdrawal":
          movement = -amount;
          break;
        default:
          break;
      }
      balances.set(accountId, balances.get(accountId) + movement);
    }

    if (record.transaction_type === "account_transfer"
        && record.transfer_to_account_id
        && balances.has(record.transfer_to_account_id)) {
      const destinationBalance = balances.get(record.transfer_to_account_id);
      balances.set(record.transfer_to_account_id, destinationBalance + amount);
    }
  });
  return balances;
}

