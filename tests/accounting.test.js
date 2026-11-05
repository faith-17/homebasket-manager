import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateAccountBalances } from "../js/accounting.js";
import { formatKobo, parseNairaToKobo } from "../js/money.js";
import { calculateProfitAndLoss, reportRowsForCsv, transactionRowsForCsv } from "../js/reports.js";

test("app DOM references resolve to unique HTML element IDs", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8")
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const references = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
  assert.deepEqual([...new Set(references)].filter((id) => !ids.includes(id)), []);
});

test("parses naira text to exact integer kobo", () => {
  assert.equal(parseNairaToKobo("0.01"), "1");
  assert.equal(parseNairaToKobo("1250.5"), "125050");
  assert.equal(parseNairaToKobo("90071992547409.91"), "9007199254740991");
});

test("rejects zero, excessive decimals, and malformed amount input", () => {
  for (const amount of ["0", "0.00", "-4", "1.001", "1,000", "abc", ""]) {
    assert.throws(() => parseNairaToKobo(amount));
  }
});

test("formats signed kobo without floating-point rounding", () => {
  assert.match(formatKobo("1"), /₦/);
  assert.match(formatKobo("123456789012345"), /1,234,567,890,123\.45/);
  assert.match(formatKobo("-5"), /0\.05/);
  assert.match(formatKobo("-5"), /-/);
});

test("calculates stock-adjusted estimated COGS and net profit exactly", () => {
  const records = [
    { transaction_type: "opening_stock", occurred_on: "2026-03-01", amount_kobo: "100000", created_at: "2026-03-01T10:00:00Z" },
    { transaction_type: "daily_sales", occurred_on: "2026-03-12", amount_kobo: "100000", created_at: "2026-03-12T10:00:00Z" },
    { transaction_type: "stock_purchase", occurred_on: "2026-03-13", amount_kobo: "40000", created_at: "2026-03-13T10:00:00Z" },
    { transaction_type: "stock_restock", occurred_on: "2026-03-14", amount_kobo: "10000", created_at: "2026-03-14T10:00:00Z" },
    { transaction_type: "household_use", occurred_on: "2026-03-15", amount_kobo: "10000", created_at: "2026-03-15T10:00:00Z" },
    { transaction_type: "stock_loss", occurred_on: "2026-03-16", amount_kobo: "5000", created_at: "2026-03-16T10:00:00Z" },
    { transaction_type: "operating_expense", occurred_on: "2026-03-17", amount_kobo: "5000", created_at: "2026-03-17T10:00:00Z" },
    { transaction_type: "closing_stock", occurred_on: "2026-03-31", amount_kobo: "60000", created_at: "2026-03-31T10:00:00Z" },
    { transaction_type: "family_contribution", occurred_on: "2026-03-17", amount_kobo: "9000", created_at: "2026-03-17T11:00:00Z" },
    { transaction_type: "owner_withdrawal", occurred_on: "2026-03-18", amount_kobo: "3000", created_at: "2026-03-18T10:00:00Z" },
    { transaction_type: "account_transfer", occurred_on: "2026-03-19", amount_kobo: "2000", created_at: "2026-03-19T10:00:00Z" }
  ];

  const report = calculateProfitAndLoss(records, "2026-03-01", "2026-03-31");
  assert.equal(report.estimatedCogs, 75000n);
  assert.equal(report.grossProfit, 25000n);
  assert.equal(report.netProfit, 5000n);
  assert.equal(report.contributions, 9000n);
  assert.equal(report.withdrawals, 3000n);
  assert.equal(report.transfers, 2000n);
  assert.equal(report.isComplete, true);
});

test("marks reports incomplete when stock values are missing", () => {
  const report = calculateProfitAndLoss([
    { transaction_type: "daily_sales", occurred_on: "2026-03-20", amount_kobo: "10000", created_at: "2026-03-20T10:00:00Z" }
  ], "2026-03-01", "2026-03-31");
  assert.equal(report.estimatedCogs, null);
  assert.equal(report.netProfit, null);
  assert.equal(report.isComplete, false);
  assert.match(reportRowsForCsv(report)[4].value, /Incomplete/);
});

test("marks a valuation-only report incomplete when no sales totals were entered", () => {
  const report = calculateProfitAndLoss([
    { transaction_type: "opening_stock", occurred_on: "2026-03-01", amount_kobo: "1000", created_at: "2026-03-01T10:00:00Z" },
    { transaction_type: "closing_stock", occurred_on: "2026-03-31", amount_kobo: "1000", created_at: "2026-03-31T10:00:00Z" }
  ], "2026-03-01", "2026-03-31");
  assert.equal(report.salesRecordCount, 0);
  assert.equal(report.isComplete, false);
});

test("requires stock valuations on the report boundary dates", () => {
  const report = calculateProfitAndLoss([
    { transaction_type: "opening_stock", occurred_on: "2026-03-01", amount_kobo: "1000", created_at: "2026-03-01T10:00:00Z" },
    { transaction_type: "closing_stock", occurred_on: "2026-03-30", amount_kobo: "900", created_at: "2026-03-30T10:00:00Z" }
  ], "2026-03-02", "2026-03-31");
  assert.equal(report.isComplete, false);
});

test("account balances transfer money without changing the combined total", () => {
  const accounts = [
    { account_id: "cash" },
    { account_id: "bank" },
    { account_id: "savings" }
  ];
  const transactions = [
    { transaction_type: "opening_balance", account_id: "cash", amount_kobo: "10000", balance_direction: 1 },
    { transaction_type: "daily_sales", account_id: "cash", amount_kobo: "3000" },
    { transaction_type: "stock_purchase", account_id: "cash", amount_kobo: "2500" },
    { transaction_type: "account_transfer", account_id: "cash", transfer_to_account_id: "bank", amount_kobo: "4000" },
    { transaction_type: "family_contribution", account_id: "bank", amount_kobo: "1000" },
    { transaction_type: "owner_withdrawal", account_id: "bank", amount_kobo: "500" },
    { transaction_type: "opening_balance", account_id: "savings", amount_kobo: "2000", balance_direction: -1 }
  ];
  const balances = calculateAccountBalances(accounts, transactions);
  assert.equal(balances.get("cash"), 6500n);
  assert.equal(balances.get("bank"), 4500n);
  assert.equal(balances.get("savings"), -2000n);
  assert.equal([...balances.values()].reduce((sum, value) => sum + value, 0n), 9000n);
});

test("exports transaction amounts as exact decimal naira", () => {
  const rows = transactionRowsForCsv([{
    id: "record-id",
    occurred_on: "2026-03-20",
    transaction_type: "daily_sales",
    category: "Sales",
    amount_kobo: "10001",
    account_id: "cash",
    transfer_to_account_id: null,
    notes: "",
    created_by: "user-id",
    created_at: "2026-03-20T10:00:00Z",
    updated_at: "2026-03-20T10:00:00Z"
  }]);
  assert.equal(rows[0].amount_ngn, "100.01");
});
