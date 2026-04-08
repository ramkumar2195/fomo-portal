"use client";

import { CreditCard, Wallet } from "lucide-react";
import { ReactNode } from "react";

export interface BillingInfoRow {
  label: string;
  value: ReactNode;
  fullWidth?: boolean;
}

export interface BillingLineItem {
  label: string;
  subtitle?: string;
  baseAmount: string;
  sellingPrice: string;
  discount: string;
}

export interface BillingOption {
  value: string;
  label: string;
}

export interface BillingTaxRow {
  label: string;
  value: string;
}

interface BillingWorkflowTemplateProps {
  infoRows: BillingInfoRow[];
  lineItems: BillingLineItem[];
  totalLabel: string;
  totalBaseAmount?: string;
  totalSellingPrice: string;
  totalDiscount?: string;
  finalPayable: string;
  taxRows?: BillingTaxRow[];
  receivedAmount: string;
  onReceivedAmountChange: (value: string) => void;
  paymentMode: string;
  paymentModeOptions: BillingOption[];
  onPaymentModeChange: (value: string) => void;
  secondaryModeLabel?: string;
  secondaryModeValue?: string;
  secondaryModeOptions?: readonly BillingOption[];
  onSecondaryModeChange?: (value: string) => void;
  showBalanceDueDate?: boolean;
  balanceDueDate?: string;
  onBalanceDueDateChange?: (value: string) => void;
  receiptRows: BillingInfoRow[];
  disabled?: boolean;
  receivedAmountPlaceholder?: string;
  invoiceSummaryTitle?: string;
  commercialTitle?: string;
  paymentTitle?: string;
}

export function BillingWorkflowTemplate({
  infoRows,
  lineItems,
  totalLabel,
  totalBaseAmount,
  totalSellingPrice,
  totalDiscount,
  finalPayable,
  taxRows = [],
  receivedAmount,
  onReceivedAmountChange,
  paymentMode,
  paymentModeOptions,
  onPaymentModeChange,
  secondaryModeLabel,
  secondaryModeValue,
  secondaryModeOptions = [],
  onSecondaryModeChange,
  showBalanceDueDate,
  balanceDueDate,
  onBalanceDueDateChange,
  receiptRows,
  disabled = false,
  receivedAmountPlaceholder = "Enter collected amount",
  invoiceSummaryTitle = "Invoice Summary",
  commercialTitle = "Commercial Breakdown",
  paymentTitle = "Payment Collection",
}: BillingWorkflowTemplateProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_380px]">
      <div className="space-y-5">
        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
          <div className="mb-4 flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-[#ffb4b1]" />
            <div>
              <h4 className="text-sm font-semibold text-white">{invoiceSummaryTitle}</h4>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
            <dl className="grid gap-x-8 gap-y-3 text-sm text-slate-300 sm:grid-cols-2">
              {infoRows.map((row) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between gap-4 ${row.fullWidth ? "sm:col-span-2" : ""}`}
                >
                  <dt className="text-slate-400">{row.label}</dt>
                  <dd className="text-right font-medium text-white">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
          <div className="mb-4 flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-[#ffb4b1]" />
            <div>
              <h4 className="text-sm font-semibold text-white">{commercialTitle}</h4>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f141d]">
            <table className="min-w-full table-fixed divide-y divide-white/10 text-sm text-slate-300">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="w-[48%] px-4 py-3 text-left font-semibold">Description</th>
                  <th className="w-[17%] px-4 py-3 text-right font-semibold">Plan Price</th>
                  <th className="w-[18%] px-4 py-3 text-right font-semibold">Selling Price</th>
                  <th className="w-[17%] px-4 py-3 text-right font-semibold">Discount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {lineItems.map((item) => (
                  <tr key={`${item.label}-${item.subtitle || ""}`} className="bg-[#101722]">
                    <td className="px-4 py-3 text-white">
                      {item.label}
                      {item.subtitle ? <div className="mt-1 text-xs text-slate-400">{item.subtitle}</div> : null}
                    </td>
                    <td className="px-4 py-3 text-right">{item.baseAmount}</td>
                    <td className="px-4 py-3 text-right">{item.sellingPrice}</td>
                    <td className="px-4 py-3 text-right">{item.discount}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="divide-y divide-white/10 bg-black/10">
                <tr>
                  <td className="px-4 py-3 font-semibold text-white">{totalLabel}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">{totalBaseAmount || ""}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">{totalSellingPrice}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">{totalDiscount || ""}</td>
                </tr>
                {taxRows.map((row) => (
                  <tr key={row.label}>
                    <td className="px-4 py-3">{row.label}</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">{row.value}</td>
                    <td className="px-4 py-3" />
                  </tr>
                ))}
                <tr className="text-base">
                  <td className="px-4 py-3 font-semibold text-white">Total Payable</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right font-semibold text-white">{finalPayable}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
        <div className="mb-4 flex items-center gap-3">
          <Wallet className="h-5 w-5 text-[#ffb4b1]" />
          <div>
            <h4 className="text-sm font-semibold text-white">{paymentTitle}</h4>
          </div>
        </div>

        <div className="space-y-4">
          <label className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Received Amount</span>
            <input
              className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
              value={receivedAmount}
              onChange={(event) => onReceivedAmountChange(event.target.value)}
              placeholder={receivedAmountPlaceholder}
              disabled={disabled}
              inputMode="numeric"
            />
          </label>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Payment Mode</span>
            <div className="grid grid-cols-3 gap-2">
              {paymentModeOptions.map((option) => {
                const selected = paymentMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPaymentModeChange(option.value)}
                    className={`rounded-2xl border px-4 py-4 text-sm font-semibold uppercase tracking-[0.18em] transition ${
                      selected
                        ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                        : "border-white/10 bg-[#0f141d] text-slate-300 hover:border-white/20"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            {secondaryModeOptions.length > 0 && secondaryModeLabel && onSecondaryModeChange ? (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{secondaryModeLabel}</span>
                <div className="grid grid-cols-2 gap-2">
                  {secondaryModeOptions.map((option) => {
                    const selected = secondaryModeValue === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSecondaryModeChange(option.value)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                          selected
                            ? "border-[#c42924]/70 bg-[#c42924]/15 text-white"
                            : "border-white/10 bg-[#0f141d] text-slate-300 hover:border-white/20"
                        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          {showBalanceDueDate && onBalanceDueDateChange ? (
            <label className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Balance Due Date</span>
              <input
                type="date"
                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                value={balanceDueDate || ""}
                onChange={(event) => onBalanceDueDateChange(event.target.value)}
                disabled={disabled}
              />
            </label>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Receipt Preview</p>
            <dl className="mt-3 space-y-2 text-sm text-slate-300">
              {receiptRows.map((row) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between gap-3 ${row.fullWidth ? "border-t border-white/10 pt-2 text-base font-semibold text-white" : ""}`}
                >
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
