// The app controller connects authentication, shared records, reports, and accessible screen state.
import { loadAccounts } from "./accounts.js";
import { calculateAccountBalances } from "./accounting.js";
import { BUSINESS_LOCALE } from "./config.js";
import { supabase, hasSupabaseConfig } from "./supabase.js";
import { formatKobo, parseNairaToKobo } from "./money.js";
import {
  TRANSACTION_TYPES,
  createRequestId,
  createTransaction,
  deleteTransaction,
  loadTransactions,
  transactionTypeLabel,
  updateTransaction
} from "./transactions.js";
import {
  calculateProfitAndLoss,
  reportRows,
  reportRowsForCsv,
  transactionRowsForCsv
} from "./reports.js";

const $ = (selector) => document.querySelector(selector);
const ui = {
  connectionStatus: $("#connection-status"),
  configurationPanel: $("#configuration-panel"),
  authPanel: $("#auth-panel"),
  authForm: $("#auth-form"),
  authTitle: $("#auth-title"),
  authSubmit: $("#auth-submit"),
  authModeButton: $("#auth-mode-button"),
  email: $("#email"),
  password: $("#password"),
  githubSignIn: $("#github-sign-in"),
  signOutButton: $("#sign-out-button"),
  userLabel: $("#user-label"),
  businessSetupPanel: $("#business-setup-panel"),
  businessSetupForm: $("#business-setup-form"),
  businessName: $("#business-name"),
  switchToJoin: $("#switch-to-join"),
  inviteJoinPanel: $("#invite-join-panel"),
  inviteJoinForm: $("#invite-join-form"),
  inviteToken: $("#invite-token"),
  switchToCreate: $("#switch-to-create"),
  application: $("#application"),
  businessTitle: $("#business-title"),
  todayLabel: $("#today-label"),
  refreshButton: $("#refresh-button"),
  lastUpdated: $("#last-updated"),
  notice: $("#notice"),
  transactionType: $("#transaction-type"),
  transactionAmount: $("#transaction-amount"),
  transactionDate: $("#transaction-date"),
  transactionCategory: $("#transaction-category"),
  transactionAccount: $("#transaction-account"),
  accountField: $("#account-field"),
  transferField: $("#transfer-field"),
  transferAccount: $("#transfer-account"),
  directionField: $("#direction-field"),
  balanceDirection: $("#balance-direction"),
  transactionNotes: $("#transaction-notes"),
  transactionForm: $("#transaction-form"),
  transactionList: $("#transaction-list"),
  recentTransactions: $("#recent-transactions"),
  transactionSearch: $("#transaction-search"),
  transactionFrom: $("#transaction-from"),
  transactionTo: $("#transaction-to"),
  reportForm: $("#report-form"),
  reportFrom: $("#report-from"),
  reportTo: $("#report-to"),
  reportCompleteness: $("#report-completeness"),
  reportOutput: $("#report-output"),
  exportTransactions: $("#export-transactions"),
  exportReport: $("#export-report"),
  dashboardAccounts: $("#dashboard-accounts"),
  accountList: $("#account-list"),
  todaySales: $("#today-sales"),
  todayExpenses: $("#today-expenses"),
  todayStock: $("#today-stock"),
  todayHousehold: $("#today-household"),
  monthProfit: $("#month-profit"),
  monthProfitStatus: $("#month-profit-status"),
  memberList: $("#member-list"),
  ownerAccessControls: $("#owner-access-controls"),
  createInvite: $("#create-invite"),
  inviteOutput: $("#invite-output"),
  inviteCode: $("#invite-code"),
  inviteExpiry: $("#invite-expiry"),
  copyInvite: $("#copy-invite"),
  auditHistory: $("#audit-history"),
  editDialog: $("#edit-dialog"),
  editForm: $("#edit-form"),
  editId: $("#edit-transaction-id"),
  editAmount: $("#edit-amount"),
  editCategory: $("#edit-category"),
  editDate: $("#edit-date"),
  editNotes: $("#edit-notes"),
  closeEdit: $("#close-edit"),
  cancelEdit: $("#cancel-edit")
};

const state = {
  user: null,
  business: null,
  role: null,
  accounts: [],
  transactions: [],
  members: [],
  report: null,
  realtimeChannel: null,
  authSubscription: null,
  pendingRequestId: null,
  authMode: "signin"
};

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstDateOfMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function showNotice(message, isError = false, persistent = false) {
  ui.notice.textContent = message;
  ui.notice.classList.toggle("error", isError);
  ui.notice.hidden = false;
  if (!persistent) {
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { ui.notice.hidden = true; }, 7000);
  }
}

function setBusy(form, busy) {
  form.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  form.setAttribute("aria-busy", String(busy));
}

function setConnectionStatus(message, isOffline = false) {
  ui.connectionStatus.textContent = message;
  ui.connectionStatus.classList.toggle("offline", isOffline);
}

function hidePanels() {
  ui.configurationPanel.hidden = true;
  ui.authPanel.hidden = true;
  ui.businessSetupPanel.hidden = true;
  ui.inviteJoinPanel.hidden = true;
  ui.application.hidden = true;
}

function setSignedOut() {
  hidePanels();
  ui.authPanel.hidden = false;
  ui.signOutButton.hidden = true;
  ui.userLabel.hidden = true;
  ui.application.hidden = true;
  state.user = null;
  state.business = null;
  state.role = null;
  state.accounts = [];
  state.transactions = [];
  state.members = [];
  state.pendingRequestId = null;
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  setConnectionStatus(navigator.onLine ? "Signed out" : "Offline", !navigator.onLine);
}

function setTransactionOptions() {
  ui.transactionType.replaceChildren();
  TRANSACTION_TYPES.forEach((type) => {
    const option = document.createElement("option");
    option.value = type.value;
    option.textContent = type.label;
    ui.transactionType.append(option);
  });
  updateTransactionFields();
}

function updateTransactionFields() {
  const type = TRANSACTION_TYPES.find((entry) => entry.value === ui.transactionType.value);
  if (!type) return;
  ui.accountField.hidden = !type.account;
  ui.transferField.hidden = !type.transfer;
  ui.directionField.hidden = !type.direction;
  if (!type.account) {
    ui.transactionCategory.value ||= type.label;
  }
}

function populateAccountOptions() {
  for (const select of [ui.transactionAccount, ui.transferAccount]) {
    select.replaceChildren();
    state.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.account_id;
      option.textContent = account.name;
      select.append(option);
    });
  }
  ui.transferAccount.disabled = state.accounts.length < 2;
}

function createSummaryCard(account) {
  const card = document.createElement("article");
  card.className = "account-card";
  const name = document.createElement("span");
  name.className = "summary-label";
  name.textContent = account.name;
  const balance = document.createElement("strong");
  const hasAccountActivity = state.transactions.some((record) => (
    record.account_id === account.account_id || record.transfer_to_account_id === account.account_id
  ));
  balance.textContent = hasAccountActivity ? formatKobo(account.balance_kobo) : "Not set";
  const label = document.createElement("span");
  label.className = "summary-caption";
  label.textContent = hasAccountActivity ? "Live balance from the ledger" : "Record an opening balance to start";
  card.append(name, balance, label);
  return card;
}

function renderAccounts() {
  ui.dashboardAccounts.replaceChildren();
  ui.accountList.replaceChildren();
  if (!state.accounts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No financial accounts were found. Ask the owner to check the database setup.";
    ui.accountList.append(empty);
    return;
  }
  state.accounts.forEach((account) => {
    ui.dashboardAccounts.append(createSummaryCard(account));
    ui.accountList.append(createSummaryCard(account));
  });
}

function createTransactionRow(record, includeActions = false) {
  const row = document.createElement("article");
  row.className = "transaction-row";

  const detail = document.createElement("div");
  detail.className = "transaction-detail";
  const heading = document.createElement("strong");
  heading.textContent = record.category;
  const metadata = document.createElement("span");
  const account = state.accounts.find((entry) => entry.account_id === record.account_id);
  const transferTarget = state.accounts.find((entry) => entry.account_id === record.transfer_to_account_id);
  const creator = state.members.find((member) => member.user_id === record.created_by);
  let accountText = "";
  if (record.transaction_type === "account_transfer") {
    accountText = ` · ${account?.name || "Account"} → ${transferTarget?.name || "Account"}`;
  } else if (account) {
    accountText = ` · ${account.name}`;
  }
  const createdAt = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(record.created_at));
  metadata.textContent = `${record.occurred_on} · ${transactionTypeLabel(record.transaction_type)}${accountText} · Entered by ${creator?.email || record.created_by.slice(0, 8)} at ${createdAt}`;
  const note = document.createElement("span");
  note.className = "transaction-note";
  note.textContent = record.notes || "";
  detail.append(heading, metadata);
  if (record.notes) detail.append(note);

  const amount = document.createElement("strong");
  amount.className = "transaction-amount";
  amount.textContent = formatKobo(record.amount_kobo);
  row.append(detail, amount);

  if (includeActions && state.role === "owner") {
    const actions = document.createElement("div");
    actions.className = "transaction-actions";
    const edit = document.createElement("button");
    edit.className = "button button-quiet button-small";
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditDialog(record));
    const remove = document.createElement("button");
    remove.className = "button button-quiet button-small danger-button";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => removeRecord(record));
    actions.append(edit, remove);
    row.append(actions);
  }
  return row;
}

function renderTransactionList(records, target, emptyMessage) {
  target.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    target.append(empty);
    return;
  }
  records.forEach((record) => target.append(createTransactionRow(record, target === ui.transactionList)));
}

function filteredTransactions() {
  const search = ui.transactionSearch.value.trim().toLocaleLowerCase(BUSINESS_LOCALE);
  const from = ui.transactionFrom.value;
  const to = ui.transactionTo.value;
  return state.transactions.filter((record) => {
    const matchesText = !search
      || `${record.category} ${record.notes || ""} ${transactionTypeLabel(record.transaction_type)}`
        .toLocaleLowerCase(BUSINESS_LOCALE).includes(search);
    return matchesText
      && (!from || record.occurred_on >= from)
      && (!to || record.occurred_on <= to);
  });
}

function renderTransactionViews() {
  const filtered = filteredTransactions();
  renderTransactionList(filtered, ui.transactionList, "No transactions match these filters.");
  renderTransactionList(state.transactions.slice(0, 8), ui.recentTransactions, "No transactions yet. Add the first record in Transactions.");
}

function sumForDay(type, date) {
  return state.transactions.reduce((sum, record) => (
    record.transaction_type === type && record.occurred_on === date
      ? sum + BigInt(record.amount_kobo)
      : sum
  ), 0n);
}

function hasDayRecord(types, date) {
  const acceptedTypes = new Set(types);
  return state.transactions.some((record) => (
    acceptedTypes.has(record.transaction_type) && record.occurred_on === date
  ));
}

function renderDashboard() {
  const today = localDateString();
  const startOfMonth = firstDateOfMonth();
  const sales = sumForDay("daily_sales", today);
  const expenses = sumForDay("operating_expense", today);
  const stockPurchases = sumForDay("stock_purchase", today) + sumForDay("stock_restock", today);
  const householdUse = sumForDay("household_use", today);
  ui.todaySales.textContent = hasDayRecord(["daily_sales"], today) ? formatKobo(sales) : "No records";
  ui.todayExpenses.textContent = hasDayRecord(["operating_expense"], today) ? formatKobo(expenses) : "No records";
  ui.todayStock.textContent = hasDayRecord(["stock_purchase", "stock_restock"], today)
    ? formatKobo(stockPurchases)
    : "No records";
  ui.todayHousehold.textContent = hasDayRecord(["household_use"], today) ? formatKobo(householdUse) : "No records";

  state.report = calculateProfitAndLoss(state.transactions, startOfMonth, today);
  if (state.report.isComplete) {
    ui.monthProfit.textContent = formatKobo(state.report.netProfit);
    ui.monthProfitStatus.textContent = "Estimated from recorded stock valuations and transactions.";
  } else {
    ui.monthProfit.textContent = "Incomplete";
    ui.monthProfitStatus.textContent = "Add opening and closing stock valuations for a meaningful estimate.";
  }
  ui.lastUpdated.textContent = `Updated ${new Intl.DateTimeFormat(BUSINESS_LOCALE, {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date())}`;
  renderTransactionViews();
}

function setCurrentView(viewName) {
  const validViews = ["overview", "transactions", "reports", "accounts"];
  const view = validViews.includes(viewName) ? viewName : "overview";
  document.querySelectorAll(".app-view").forEach((section) => {
    section.hidden = section.id !== `view-${view}`;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    const selected = link.dataset.view === view;
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (view === "reports") calculateAndRenderReport();
}

function handleNavigation() {
  setCurrentView(window.location.hash.slice(1));
}

async function loadBusinessData() {
  if (!state.business) return;
  setConnectionStatus("Syncing…");
  try {
    const [accounts, transactions] = await Promise.all([
      loadAccounts(state.business.id),
      loadTransactions(state.business.id)
    ]);
    const calculatedBalances = calculateAccountBalances(accounts, transactions);
    const mismatch = accounts.find((account) => (
      calculatedBalances.get(account.account_id) !== BigInt(account.balance_kobo)
    ));
    if (mismatch) {
      throw new Error(`Account balance check failed for ${mismatch.name}. The database total and ledger entries disagree; contact the owner before recording more transactions.`);
    }
    state.accounts = accounts;
    state.transactions = transactions;
    populateAccountOptions();
    renderAccounts();
    renderDashboard();
    if (window.location.hash === "#reports") calculateAndRenderReport();
    setConnectionStatus("Synced");
  } catch (error) {
    setConnectionStatus(navigator.onLine ? "Sync error" : "Offline", true);
    showNotice(`Could not load the latest business records. Nothing was changed. ${error.message}`, true, true);
    throw error;
  }
}

async function loadMembers() {
  const { data, error } = await supabase
    .from("business_members")
    .select("user_id, email, role, created_at")
    .eq("business_id", state.business.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  state.members = data || [];
  ui.memberList.replaceChildren();
  if (!state.members.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No family members are connected yet.";
    ui.memberList.append(empty);
  } else {
    state.members.forEach((member) => {
      const row = document.createElement("div");
      row.className = "member-row";
      const label = document.createElement("span");
      label.textContent = `${member.email || member.user_id} · ${member.role}`;
      row.append(label);
      if (state.role === "owner" && member.role === "member") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "button button-quiet button-small danger-button";
        remove.textContent = "Remove access";
        remove.addEventListener("click", () => removeMember(member));
        row.append(remove);
      }
      ui.memberList.append(row);
    });
  }
  ui.ownerAccessControls.hidden = state.role !== "owner";
}

async function loadAuditHistory() {
  ui.auditHistory.replaceChildren();
  if (state.role !== "owner") return;
  const { data, error } = await supabase.rpc("list_business_audit", {
    p_business_id: state.business.id
  });
  if (error) throw error;
  const heading = document.createElement("h3");
  heading.textContent = "Recent audit history";
  ui.auditHistory.append(heading);
  if (!data?.length) {
    const empty = document.createElement("p");
    empty.className = "small-muted";
    empty.textContent = "No changes have been recorded yet.";
    ui.auditHistory.append(empty);
    return;
  }
  data.forEach((entry) => {
    const row = document.createElement("p");
    row.className = "audit-row";
    row.textContent = `${entry.action} · transaction ${entry.transaction_id} · ${entry.actor_id} · ${new Date(entry.occurred_at).toLocaleString(BUSINESS_LOCALE)}`;
    ui.auditHistory.append(row);
  });
}

async function loadSignedInWorkspace() {
  if (!state.user) return;
  ui.userLabel.hidden = false;
  ui.userLabel.textContent = state.user.email || "Signed in";
  ui.signOutButton.hidden = false;

  const { data: membership, error } = await supabase
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", state.user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  if (!membership) {
    hidePanels();
    ui.businessSetupPanel.hidden = false;
    ui.inviteJoinPanel.hidden = true;
    return;
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("id", membership.business_id)
    .single();
  if (businessError) throw businessError;

  state.business = business;
  state.role = membership.role;
  ui.businessTitle.textContent = business.name;
  ui.todayLabel.textContent = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long"
  }).format(new Date()).toUpperCase();
  hidePanels();
  ui.application.hidden = false;
  ui.ownerAccessControls.hidden = state.role !== "owner";
  await Promise.all([loadBusinessData(), loadMembers(), loadAuditHistory()]);
  renderTransactionViews();
  setCurrentView(window.location.hash.slice(1));
  subscribeToBusinessUpdates();
}

function subscribeToBusinessUpdates() {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = supabase
    .channel(`business-ledger-${state.business.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "business_transactions",
      filter: `business_id=eq.${state.business.id}`
    }, () => {
      loadBusinessData().catch(() => {
        // loadBusinessData already reports the network/database error to the user.
      });
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setConnectionStatus("Live sync");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setConnectionStatus("Live sync unavailable", true);
      }
    });
}

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  state.user = data.session?.user || null;
  if (state.user) await loadSignedInWorkspace();
  else setSignedOut();
}

function populateReportDefaults() {
  const today = localDateString();
  ui.reportFrom.value = firstDateOfMonth();
  ui.reportTo.value = today;
  ui.transactionFrom.value = firstDateOfMonth();
  ui.transactionTo.value = today;
  ui.transactionDate.value = today;
}

function renderTransactionTypeSelection() {
  const currentType = TRANSACTION_TYPES.find((item) => item.value === ui.transactionType.value);
  const type = currentType || TRANSACTION_TYPES[0];
  if (type.transfer && ui.transferAccount.value === ui.transactionAccount.value && state.accounts.length > 1) {
    ui.transferAccount.value = state.accounts.find((account) => account.account_id !== ui.transactionAccount.value)?.account_id || "";
  }
}

function buildRecordFromForm() {
  const type = TRANSACTION_TYPES.find((entry) => entry.value === ui.transactionType.value);
  if (!type) throw new Error("Choose a transaction type.");
  const date = ui.transactionDate.value;
  if (!date || date > localDateString()) throw new Error("Choose a valid date that is not in the future.");
  const category = ui.transactionCategory.value.trim();
  if (!category || category.length > 80) throw new Error("Enter a category of 1 to 80 characters.");
  const accountId = type.account ? ui.transactionAccount.value : null;
  const targetId = type.transfer ? ui.transferAccount.value : null;
  if (type.account && !accountId) throw new Error("Choose the account used for this transaction.");
  if (type.transfer && (!targetId || targetId === accountId)) {
    throw new Error("Choose two different accounts for the transfer.");
  }
  return {
    transaction_type: type.value,
    occurred_on: date,
    amount_kobo: parseNairaToKobo(ui.transactionAmount.value),
    category,
    account_id: accountId,
    transfer_to_account_id: targetId,
    balance_direction: type.direction ? Number(ui.balanceDirection.value) : 1,
    notes: ui.transactionNotes.value.trim() || null
  };
}

function resetTransactionForm() {
  ui.transactionForm.reset();
  ui.transactionDate.value = localDateString();
  ui.transactionType.value = "daily_sales";
  state.pendingRequestId = null;
  updateTransactionFields();
  renderTransactionTypeSelection();
}

function csvEscape(value, protectFormula = true) {
  let text = String(value ?? "");
  // Spreadsheet programs may execute formula-like exported text; force those cells to text.
  if (protectFormula && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  if (!rows.length) {
    showNotice("There are no records to export.", true);
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map((header) => csvEscape(header)).join(","),
    ...rows.map((row) => headers.map((header) => (
      csvEscape(row[header], !["amount_ngn", "value"].includes(header))
    )).join(","))
  ].join("\r\n");
  const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function calculateAndRenderReport() {
  const startDate = ui.reportFrom.value;
  const endDate = ui.reportTo.value;
  if (!startDate || !endDate || startDate > endDate) {
    ui.reportCompleteness.textContent = "Choose a valid date range. The start must not be after the end.";
    ui.reportCompleteness.className = "report-status status-incomplete";
    ui.reportOutput.replaceChildren();
    state.report = null;
    return;
  }
  state.report = calculateProfitAndLoss(state.transactions, startDate, endDate);
  renderReport(state.report);
}

function renderReport(report) {
  ui.reportOutput.replaceChildren();
  const table = document.createElement("table");
  table.className = "report-table";
  const body = document.createElement("tbody");
  reportRows(report).forEach(([label, amount]) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("th");
    nameCell.scope = "row";
    nameCell.textContent = label;
    const valueCell = document.createElement("td");
    valueCell.textContent = amount === null
      ? "Not recorded"
      : typeof amount === "bigint" ? formatKobo(amount) : String(amount);
    if (label.toLowerCase().includes("profit")) valueCell.className = "report-profit";
    row.append(nameCell, valueCell);
    body.append(row);
  });
  table.append(body);
  ui.reportOutput.append(table);

  const messages = [];
  if (report.openingStock === null) messages.push(`No opening stock valuation on or before ${report.startDate}.`);
  if (report.closingStock === null) messages.push(`No closing stock valuation on or before ${report.endDate}.`);
  if (report.openingStock !== null && report.openingStockDate !== report.startDate) {
    messages.push(`Opening stock valuation is dated ${report.openingStockDate}, not the report start date.`);
  }
  if (report.closingStock !== null && report.closingStockDate !== report.endDate) {
    messages.push(`Closing stock valuation is dated ${report.closingStockDate}, not the report end date.`);
  }
  if (report.salesRecordCount === 0) messages.push("No daily sales totals were recorded in this date range.");
  if (report.estimatedCogs !== null && report.estimatedCogs < 0n) {
    messages.push("Stock valuations and movements produce negative estimated cost of goods sold; review the entries.");
  }
  if (messages.length) {
    ui.reportCompleteness.textContent = `INCOMPLETE ESTIMATE — ${messages.join(" ")}`;
    ui.reportCompleteness.className = "report-status status-incomplete";
  } else {
    ui.reportCompleteness.textContent = "Estimate complete using the latest available opening and closing valuations for this range. Confirm valuation dates and amounts.";
    ui.reportCompleteness.className = "report-status status-complete";
  }
}

function openEditDialog(record) {
  ui.editId.value = record.id;
  ui.editAmount.value = `${BigInt(record.amount_kobo) / 100n}.${String(BigInt(record.amount_kobo) % 100n).padStart(2, "0")}`;
  ui.editCategory.value = record.category;
  ui.editDate.value = record.occurred_on;
  ui.editNotes.value = record.notes || "";
  ui.editDialog.showModal();
}

async function removeRecord(record) {
  if (!window.confirm(`Permanently delete "${record.category}"? The change will be kept in the audit history.`)) return;
  try {
    await deleteTransaction(record.id);
  } catch (error) {
    showNotice(`Delete failed. The record was not reported as deleted. ${error.message}`, true, true);
    return;
  }
  try {
    await Promise.all([loadBusinessData(), loadAuditHistory()]);
    showNotice("Transaction deleted and the change recorded in the audit history.");
  } catch (error) {
    showNotice(`Transaction was deleted, but the latest ledger or audit history could not be refreshed. ${error.message}`, true, true);
  }
}

async function removeMember(member) {
  if (!window.confirm(`Remove business access for ${member.email || "this family member"}?`)) return;
  try {
    const { error } = await supabase.rpc("remove_business_member", {
      p_business_id: state.business.id,
      p_user_id: member.user_id
    });
    if (error) throw error;
    await loadMembers();
    showNotice("Family access removed.");
  } catch (error) {
    showNotice(`Could not remove access. ${error.message}`, true);
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  ui.authTitle.textContent = signup ? "Create your owner account" : "Sign in to the business books";
  ui.authSubmit.textContent = signup ? "Create account" : "Sign in";
  ui.authModeButton.textContent = signup ? "I already have an account" : "Create first account";
  ui.password.autocomplete = signup ? "new-password" : "current-password";
}

ui.authModeButton.addEventListener("click", () => {
  setAuthMode(state.authMode === "signin" ? "signup" : "signin");
});

ui.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(ui.authForm, true);
  try {
    const credentials = { email: ui.email.value.trim(), password: ui.password.value };
    const response = state.authMode === "signup"
      ? await supabase.auth.signUp(credentials)
      : await supabase.auth.signInWithPassword(credentials);
    if (response.error) throw response.error;
    if (state.authMode === "signup" && !response.data.session) {
      showNotice("Account created. Confirm your email, then sign in to create the business workspace.");
    } else {
      state.user = response.data.user;
      await loadSignedInWorkspace();
      showNotice(state.authMode === "signup" ? "Account created." : "Welcome back.");
    }
  } catch (error) {
    showNotice(`Sign-in failed. ${error.message}`, true);
  } finally {
    setBusy(ui.authForm, false);
  }
});

ui.githubSignIn.addEventListener("click", async () => {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.href.split("#")[0] }
    });
    if (error) throw error;
  } catch (error) {
    showNotice(`GitHub sign-in could not start. Configure GitHub OAuth in Supabase first. ${error.message}`, true, true);
  }
});

ui.signOutButton.addEventListener("click", async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSignedOut();
    showNotice("You have signed out.");
  } catch (error) {
    showNotice(`Could not sign out. ${error.message}`, true);
  }
});

ui.businessSetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(ui.businessSetupForm, true);
  try {
    const { data, error } = await supabase.rpc("create_business", {
      p_name: ui.businessName.value.trim()
    });
    if (error) throw error;
    const { data: business, error: businessError } = await supabase
      .from("businesses").select("id, name").eq("id", data).single();
    if (businessError) throw businessError;
    state.business = business;
    state.role = "owner";
    await loadSignedInWorkspace();
    showNotice("Business workspace created. Add your opening balances and stock valuation to begin.");
  } catch (error) {
    showNotice(`Could not create the business. ${error.message}`, true, true);
  } finally {
    setBusy(ui.businessSetupForm, false);
  }
});

ui.switchToJoin.addEventListener("click", () => {
  ui.businessSetupPanel.hidden = true;
  ui.inviteJoinPanel.hidden = false;
});
ui.switchToCreate.addEventListener("click", () => {
  ui.inviteJoinPanel.hidden = true;
  ui.businessSetupPanel.hidden = false;
});

ui.inviteJoinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(ui.inviteJoinForm, true);
  try {
    const { data, error } = await supabase.rpc("join_business_with_invite", {
      p_token: ui.inviteToken.value.trim()
    });
    if (error) throw error;
    ui.inviteToken.value = "";
    const { data: business, error: businessError } = await supabase
      .from("businesses").select("id, name").eq("id", data).single();
    if (businessError) throw businessError;
    state.business = business;
    state.role = "member";
    await loadSignedInWorkspace();
    showNotice("You joined the HomeBasket Stores workspace.");
  } catch (error) {
    showNotice(`Could not join the business. ${error.message}`, true);
  } finally {
    setBusy(ui.inviteJoinForm, false);
  }
});

ui.transactionType.addEventListener("change", () => {
  updateTransactionFields();
  renderTransactionTypeSelection();
});

ui.transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.business) return showNotice("Sign in to the business before adding a record.", true);
  setBusy(ui.transactionForm, true);
  try {
    const record = buildRecordFromForm();
    if (!state.pendingRequestId) state.pendingRequestId = createRequestId();
    await createTransaction(state.business.id, state.pendingRequestId, record);
    resetTransactionForm();
  } catch (error) {
    // Keep the request ID after a network error so retrying cannot duplicate a committed entry.
    showNotice(`Transaction was not confirmed as saved. Check your connection and retry; the same request ID will be reused. ${error.message}`, true, true);
    setBusy(ui.transactionForm, false);
    return;
  }
  try {
    await loadBusinessData();
    showNotice("Transaction saved and synchronized.");
  } catch (error) {
    showNotice(`Transaction was saved, but the latest ledger could not be refreshed. Use Refresh books when online. ${error.message}`, true, true);
  } finally {
    setBusy(ui.transactionForm, false);
  }
});

ui.refreshButton.addEventListener("click", () => {
  loadBusinessData().then(() => showNotice("Business records refreshed."))
    .catch(() => {});
});

ui.transactionSearch.addEventListener("input", renderTransactionViews);
ui.transactionFrom.addEventListener("change", renderTransactionViews);
ui.transactionTo.addEventListener("change", renderTransactionViews);

ui.reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (ui.reportFrom.value > ui.reportTo.value) {
    showNotice("Report start date must be on or before the end date.", true);
    return;
  }
  calculateAndRenderReport();
});
ui.reportFrom.addEventListener("change", calculateAndRenderReport);
ui.reportTo.addEventListener("change", calculateAndRenderReport);

ui.exportTransactions.addEventListener("click", () => {
  downloadCsv(`homebasket-transactions-${localDateString()}.csv`, transactionRowsForCsv(filteredTransactions()));
});
ui.exportReport.addEventListener("click", () => {
  if (!state.report) return showNotice("Calculate a valid report before exporting.", true);
  downloadCsv(`homebasket-report-${state.report.startDate}-to-${state.report.endDate}.csv`, reportRowsForCsv(state.report));
});

ui.createInvite.addEventListener("click", async () => {
  ui.createInvite.disabled = true;
  try {
    const { data, error } = await supabase.rpc("create_business_invite", {
      p_business_id: state.business.id
    });
    if (error) throw error;
    ui.inviteCode.textContent = data;
    ui.inviteExpiry.textContent = "Expires in seven days. The code can be used by more than one person until expiry.";
    ui.inviteOutput.hidden = false;
    showNotice("Invite created. Share the code privately with family members.");
  } catch (error) {
    showNotice(`Could not create an invite. ${error.message}`, true);
  } finally {
    ui.createInvite.disabled = false;
  }
});

ui.copyInvite.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.inviteCode.textContent);
    showNotice("Invite code copied.");
  } catch (error) {
    showNotice(`Clipboard access is unavailable. Select and copy the code manually. ${error.message}`, true);
  }
});

ui.editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const original = state.transactions.find((record) => record.id === ui.editId.value);
  if (!original) return showNotice("This transaction is no longer loaded. Refresh and try again.", true);
  setBusy(ui.editForm, true);
  try {
    const amountKobo = parseNairaToKobo(ui.editAmount.value);
    const date = ui.editDate.value;
    if (!date || date > localDateString()) throw new Error("Choose a date that is not in the future.");
    const category = ui.editCategory.value.trim();
    if (!category || category.length > 80) throw new Error("Category must be between 1 and 80 characters.");
    await updateTransaction(original.id, {
      transaction_type: original.transaction_type,
      occurred_on: date,
      amount_kobo: amountKobo,
      category,
      account_id: original.account_id,
      transfer_to_account_id: original.transfer_to_account_id,
      balance_direction: original.balance_direction,
      notes: ui.editNotes.value.trim() || null
    });
    ui.editDialog.close();
  } catch (error) {
    showNotice(`Correction was not saved. ${error.message}`, true, true);
    setBusy(ui.editForm, false);
    return;
  }
  try {
    await Promise.all([loadBusinessData(), loadAuditHistory()]);
    showNotice("Correction saved and recorded in the audit history.");
  } catch (error) {
    showNotice(`Correction was saved, but the latest ledger or audit history could not be refreshed. ${error.message}`, true, true);
  } finally {
    setBusy(ui.editForm, false);
  }
});
ui.closeEdit.addEventListener("click", () => ui.editDialog.close());
ui.cancelEdit.addEventListener("click", () => ui.editDialog.close());
ui.editDialog.addEventListener("click", (event) => {
  if (event.target === ui.editDialog) ui.editDialog.close();
});

document.querySelectorAll(".nav-link, [data-open-view]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const view = link.dataset.view || link.dataset.openView;
    window.location.hash = view;
    setCurrentView(view);
  });
  document.querySelectorAll("[data-quick-type]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = "transactions";
      setCurrentView("transactions");
      ui.transactionType.value = button.dataset.quickType;
      updateTransactionFields();
      renderTransactionTypeSelection();
      ui.transactionAmount.focus();
    });
  });
});
window.addEventListener("hashchange", handleNavigation);

window.addEventListener("offline", () => {
  setConnectionStatus("Offline", true);
  showNotice("Internet connection lost. New records will not be reported as saved until Supabase confirms them.", true, true);
});
window.addEventListener("online", () => {
  setConnectionStatus("Reconnecting…");
  if (state.business) loadBusinessData().catch(() => {});
});

ui.todayLabel.textContent = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long"
}).format(new Date()).toUpperCase();
populateReportDefaults();
setTransactionOptions();

if (!hasSupabaseConfig) {
  setConnectionStatus("Configuration required", true);
  ui.configurationPanel.hidden = false;
} else {
  setAuthMode("signin");
  setConnectionStatus("Connecting…");
  state.authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      try {
        state.user = session?.user || null;
        if (state.user) await loadSignedInWorkspace();
        else setSignedOut();
      } catch (error) {
        showNotice(`Could not load your workspace. ${error.message}`, true, true);
      }
    }, 0);
  }).data.subscription;
  restoreSession().catch((error) => {
    setConnectionStatus("Connection error", true);
    showNotice(`Could not connect to Supabase. Check js/config.js and your network. ${error.message}`, true, true);
  });
}
