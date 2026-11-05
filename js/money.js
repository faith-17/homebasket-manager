// Monetary helpers keep business calculations in integer kobo and format only at display time.
import { BUSINESS_CURRENCY, BUSINESS_LOCALE } from "./config.js";

export function parseNairaToKobo(value) {
  const cleaned = String(value).trim();
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new Error("Enter a non-negative amount with up to two decimal places, for example 1250.50.");
  }
  const naira = BigInt(match[1]);
  const kobo = BigInt((match[2] || "").padEnd(2, "0") || "0");
  const amount = naira * 100n + kobo;
  if (amount <= 0n) throw new Error("The amount must be greater than zero.");
  if (amount > 9007199254740991n) throw new Error("That amount is above the supported limit.");
  return amount.toString();
}

// Format signed integer kobo without converting the actual money value to a JS float.
export function formatKobo(value) {
  const kobo = BigInt(String(value || "0"));
  const negative = kobo < 0n;
  const absolute = negative ? -kobo : kobo;
  const naira = absolute / 100n;
  const fractionalKobo = String(absolute % 100n).padStart(2, "0");
  const symbol = BUSINESS_CURRENCY === "NGN"
    ? "₦"
    : new Intl.NumberFormat(BUSINESS_LOCALE, {
      style: "currency",
      currency: BUSINESS_CURRENCY
    }).formatToParts(0).find((part) => part.type === "currency")?.value || BUSINESS_CURRENCY;
  const formattedNaira = new Intl.NumberFormat(BUSINESS_LOCALE, {
    maximumFractionDigits: 0
  }).format(naira);
  const sign = negative ? "-" : "";
  return `${sign}${symbol}${formattedNaira}.${fractionalKobo}`;
}
