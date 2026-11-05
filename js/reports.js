// Report math uses BigInt kobo throughout. Missing stock valuations are reported as incomplete,
// never silently replaced with a made-up zero inventory value.
const TRANSACTION_LABELS = {
  daily_sales: "Daily sales total",
  stock_purchase: "Major stock purchase",
  stock_restock: "Small stock restock",
  operating_expense: "Operating expense",
  household_use: "Household goods taken from stock",
  stock_loss: "Stock loss / damaged goods",
  owner_withdrawal: "Owner withdrawal",
  family_contribution: "Family contribution",
  account_transfer: "Account transfer",
  opening_balance: "Opening account balance",
  opening_stock: "Opening stock valuation",
  closing_stock: "Closing stock valuation"
};

function koboToDecimalString(value) {
  const kobo = BigInt(String(value));
  const negative = kobo < 0n;
  const absolute = negative ? -kobo : kobo;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function sumType(records, type) {
  return records.reduce((total, record) => (
    record.transaction_type === type ? total + BigInt(record.amount_kobo) : total
  ), 0n);
}

function latestValuation(records, type, cutoffDate) {
  return records
    .filter((record) => record.transaction_type === type && record.occurred_on <= cutoffDate)
    .sort((left, right) => right.occurred_on.localeCompare(left.occurred_on)
      || right.created_at.localeCompare(left.created_at))[0] || null;
}

export function calculateProfitAndLoss(records, startDate, endDate) {
  const inRange = records.filter((record) => (
    record.occurred_on >= startDate && record.occurred_on <= endDate
  ));
  const openingRecord = latestValuation(records, "opening_stock", startDate);
  const closingRecord = latestValuation(records, "closing_stock", endDate);
  const sales = sumType(inRange, "daily_sales");
  const salesRecordCount = inRange.filter((record) => record.transaction_type === "daily_sales").length;
  const purchases = sumType(inRange, "stock_purchase") + sumType(inRange, "stock_restock");
  const householdUse = sumType(inRange, "household_use");
  const stockLosses = sumType(inRange, "stock_loss");
  const operatingExpenses = sumType(inRange, "operating_expense");
  const contributions = sumType(inRange, "family_contribution");
  const withdrawals = sumType(inRange, "owner_withdrawal");
  const transfers = inRange.filter((record) => record.transaction_type === "account_transfer");
  const openingStock = openingRecord ? BigInt(openingRecord.amount_kobo) : null;
  const closingStock = closingRecord ? BigInt(closingRecord.amount_kobo) : null;
  const hasValuations = openingStock !== null && closingStock !== null;
  // Remove non-sale stock movements from COGS, then list them separately below gross profit.
  const estimatedCogs = hasValuations
    ? openingStock + purchases - closingStock - householdUse - stockLosses
    : null;
  const grossProfit = estimatedCogs === null ? null : sales - estimatedCogs;
  const netProfit = grossProfit === null
    ? null
    : grossProfit - householdUse - stockLosses - operatingExpenses;

  return {
    startDate,
    endDate,
    sales,
    salesRecordCount,
    openingStock,
    openingStockDate: openingRecord?.occurred_on || null,
    purchases,
    estimatedCogs,
    operatingExpenses,
    householdUse,
    stockLosses,
    closingStock,
    closingStockDate: closingRecord?.occurred_on || null,
    grossProfit,
    netProfit,
    contributions,
    withdrawals,
    transfers: transfers.reduce((total, record) => total + BigInt(record.amount_kobo), 0n),
    transferCount: transfers.length,
    isComplete: hasValuations
      && salesRecordCount > 0
      && openingRecord?.occurred_on === startDate
      && closingRecord?.occurred_on === endDate
      && estimatedCogs >= 0n
  };
}

export function reportRows(report) {
  return [
    ["Report start", report.startDate],
    ["Report end", report.endDate],
    ["Sales", report.sales],
    ["Daily sales records", report.salesRecordCount],
    ["Opening stock", report.openingStock],
    ["Stock purchases and restocks", report.purchases],
    ["Estimated cost of goods sold", report.estimatedCogs],
    ["Operating expenses", report.operatingExpenses],
    ["Household goods taken from stock", report.householdUse],
    ["Stock losses", report.stockLosses],
    ["Closing stock", report.closingStock],
    ["Estimated gross profit", report.grossProfit],
    ["Estimated net profit / loss", report.netProfit],
    ["Family contributions (separate)", report.contributions],
    ["Owner withdrawals (separate)", report.withdrawals],
    ["Internal account transfers (separate)", report.transfers]
  ];
}

export function reportRowsForCsv(report) {
  return reportRows(report).map(([label, amount]) => ({
    item: label,
    value: amount === null
      ? "Incomplete: valuation not recorded"
      : typeof amount === "bigint" ? koboToDecimalString(amount) : amount
  }));
}

export function transactionRowsForCsv(records) {
  return records.map((record) => ({
    id: record.id,
    date: record.occurred_on,
    type: TRANSACTION_LABELS[record.transaction_type] || record.transaction_type,
    category: record.category,
    amount_ngn: koboToDecimalString(record.amount_kobo),
    account_id: record.account_id || "",
    transfer_to_account_id: record.transfer_to_account_id || "",
    notes: record.notes || "",
    created_by: record.created_by,
    created_at: record.created_at,
    updated_at: record.updated_at
  }));
}
