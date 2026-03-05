"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/common/section-card";
import { PageLoader } from "@/components/common/page-loader";
import { useAuth } from "@/contexts/auth-context";
import { subscriptionService } from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { InvoiceSummary, UserDirectoryItem } from "@/types/models";

export default function AccountsPage() {
  const { token } = useAuth();

  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [receiptIdInput, setReceiptIdInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await usersService.getUsersByRole(token, "MEMBER");
      setMembers(list);
      setSelectedMemberId((current) => current || list[0]?.id || "");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load members";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadInvoices = useCallback(async () => {
    if (!token || !selectedMemberId) {
      return;
    }

    setError(null);
    try {
      const list = await subscriptionService.getInvoicesByMember(token, selectedMemberId);
      setInvoices(list);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unable to load invoices";
      setError(message);
    }
  }, [token, selectedMemberId]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadMembers();
  }, [token, loadMembers]);

  useEffect(() => {
    if (!selectedMemberId) {
      return;
    }

    void loadInvoices();
  }, [loadInvoices, selectedMemberId]);

  if (loading) {
    return <PageLoader label="Loading accounts dashboard..." />;
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <SectionCard
        title="Invoice Listing"
        subtitle="Invoices are available member-wise in current backend"
        actions={
          <button
            type="button"
            onClick={() => void loadInvoices()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Refresh
          </button>
        }
      >
        <label className="mb-3 block text-sm font-medium text-slate-700">
          Member
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedMemberId}
            onChange={(event) => setSelectedMemberId(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name} ({member.mobile})
              </option>
            ))}
          </select>
        </label>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2 font-semibold">Invoice #</th>
                <th className="px-2 py-2 font-semibold">Amount</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Issued at</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-slate-500" colSpan={4}>
                    No invoices found for this member
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-slate-100">
                    <td className="px-2 py-3 font-medium text-slate-900">{invoice.invoiceNumber}</td>
                    <td className="px-2 py-3">{formatCurrency(invoice.amount)}</td>
                    <td className="px-2 py-3">{invoice.status}</td>
                    <td className="px-2 py-3">{formatDateTime(invoice.issuedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Receipt Listing" subtitle="Backend currently supports receipt PDF by receiptId">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block flex-1 text-sm font-medium text-slate-700">
            Receipt ID
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={receiptIdInput}
              onChange={(event) => setReceiptIdInput(event.target.value)}
              placeholder="Enter receiptId"
            />
          </label>
          <a
            href={receiptIdInput ? subscriptionService.getReceiptPdfUrl(receiptIdInput) : "#"}
            target="_blank"
            rel="noreferrer"
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              receiptIdInput
                ? "bg-slate-900 text-white hover:bg-slate-700"
                : "cursor-not-allowed bg-slate-200 text-slate-500"
            }`}
          >
            Open Receipt PDF
          </a>
        </div>
      </SectionCard>

      <SectionCard title="Discount Logs">
        <p className="text-sm text-slate-500">
          No dedicated discount-log endpoint is available in current backend. This section is a placeholder.
        </p>
      </SectionCard>
    </div>
  );
}
