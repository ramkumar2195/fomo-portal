"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/common/modal";
import { subscriptionService, CatalogVariant } from "@/lib/api/services/subscription-service";

type AddGroupClassModalProps = {
  open: boolean;
  onClose: () => void;
  token: string;
  memberId: string;
  memberName?: string;
  branchCode?: string;
  operatorId?: number;
  onSuccess: () => void | Promise<void>;
};

const PAYMENT_MODES = ["UPI", "CASH", "CARD", "NET_BANKING"] as const;

function round(n: number): number {
  return Math.round(n);
}
/** GST gross (base + 5% on top), single round at the total — matches backend M-1. */
function grossFromBase(base: number): number {
  return base + round(base * 0.05);
}
/** Taxable T such that T + round(0.05*T) === gross. */
function taxableFromGross(gross: number): number {
  const approx = Math.round(gross / 1.05);
  for (let d = -2; d <= 2; d++) {
    const t = approx + d;
    if (t + round(t * 0.05) === gross) return t;
  }
  return approx;
}
function inr(n: number): string {
  return `₹${round(n).toLocaleString("en-IN")}`;
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddGroupClassModal({
  open,
  onClose,
  token,
  memberId,
  memberName,
  branchCode,
  operatorId,
  onSuccess,
}: AddGroupClassModalProps) {
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [variantId, setVariantId] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [received, setReceived] = useState("");
  const [paymentMode, setPaymentMode] = useState<(typeof PAYMENT_MODES)[number]>("UPI");
  const [discountReason, setDiscountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ invoiceNumber: string; total: number } | null>(null);

  // load GROUP_CLASS variants on open
  useEffect(() => {
    if (!open) return;
    setVariants([]);
    setVariantId("");
    setStartDate(todayIso());
    setReceived("");
    setPaymentMode("UPI");
    setDiscountReason("");
    setError(null);
    setDone(null);
    setLoadingVariants(true);
    subscriptionService
      .getCatalogVariants(token, { categoryCode: "GROUP_CLASS" })
      .then((rows) => setVariants(rows.filter((v) => (v.categoryCode || "").toUpperCase() === "GROUP_CLASS")))
      .catch(() => setError("Couldn't load group classes."))
      .finally(() => setLoadingVariants(false));
  }, [open, token]);

  const selected = useMemo(() => variants.find((v) => v.variantId === variantId) || null, [variants, variantId]);
  const base = selected ? Number(selected.basePrice) : 0;
  const catalogGross = selected ? grossFromBase(base) : 0;

  // default the received amount to the catalog gross when a variant is picked
  useEffect(() => {
    if (selected) setReceived(String(catalogGross));
  }, [selected, catalogGross]);

  const receivedNum = Math.max(0, Number(received) || 0);
  const taxable = receivedNum > 0 ? taxableFromGross(receivedNum) : 0;
  const gst = receivedNum > 0 ? receivedNum - taxable : 0;
  const discountAmount = Math.max(0, base - taxable);
  const isDiscounted = discountAmount > 0;

  const canSubmit =
    !!selected && !!startDate && receivedNum > 0 && (!isDiscounted || discountReason.trim().length > 0) && !busy;

  const submit = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const created = await subscriptionService.createMemberSubscription(token, memberId, {
        productVariantId: Number(selected.variantId),
        startDate,
        branchCode: branchCode || undefined,
        discountAmount: discountAmount > 0 ? discountAmount : undefined,
        discountReason: discountAmount > 0 ? discountReason.trim() : undefined,
        discountedByStaffId: operatorId && operatorId > 0 ? operatorId : undefined,
        billedByStaffId: operatorId && operatorId > 0 ? operatorId : undefined,
      });
      const invoiceId = Number(created.invoiceId || 0);
      const subId = Number(created.memberSubscriptionId || 0);
      const total = Number(created.invoiceTotal || receivedNum);
      if (!invoiceId || !subId) throw new Error("Subscription created without valid invoice/subscription references.");

      await subscriptionService.recordPayment(token, invoiceId, {
        memberId: Number(memberId),
        amount: total,
        paymentMode,
      });
      await subscriptionService.activateMembership(token, subId);

      setDone({ invoiceNumber: String(created.invoiceNumber || ""), total });
      await onSuccess();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/DISCOUNT_APPROVAL_REQUIRED/i.test(msg)) {
        setError("This discount exceeds your limit and needs admin approval. Reduce the discount or have an admin add it.");
      } else {
        setError(msg || "Failed to add the group class.");
      }
    } finally {
      setBusy(false);
    }
  }, [selected, token, memberId, startDate, branchCode, discountAmount, discountReason, operatorId, receivedNum, paymentMode, onSuccess]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Group Class"
      size="lg"
      footer={
        done ? (
          <button type="button" onClick={onClose} className="rounded-xl bg-[#c42924] px-5 py-2 text-sm font-semibold text-white">
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="rounded-xl bg-[#c42924] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Adding…" : `Add & collect ${receivedNum > 0 ? inr(receivedNum) : ""}`}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3 py-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-400">✓</div>
          <div className="text-lg font-semibold text-white">Group class added</div>
          <div className="text-sm text-slate-400">
            {selected?.variantName} for {memberName || "this member"} — invoice {done.invoiceNumber} · {inr(done.total)} paid via {paymentMode}.
          </div>
          <div className="text-xs text-slate-500">It is an additional membership; the member&apos;s primary plan is unchanged.</div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Adds a group class as an <span className="text-slate-200">additional, concurrent</span> subscription. The member&apos;s
            primary membership (e.g. Core) stays the headline plan.
          </p>

          {/* Variant */}
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Group class</span>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <option value="">{loadingVariants ? "Loading…" : "Select a group class"}</option>
              {variants
                .slice()
                .sort((a, b) => a.variantName.localeCompare(b.variantName))
                .map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.variantName} — {inr(grossFromBase(Number(v.basePrice)))}
                  </option>
                ))}
            </select>
          </label>

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Start date</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Payment mode</span>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as (typeof PAYMENT_MODES)[number])}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>{m.replace("_", " ")}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Amount received (incl. GST)</span>
                <input
                  type="number"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                />
                <span className="mt-1 block text-[11px] text-slate-500">Catalog price {inr(catalogGross)}. Enter the gross collected; any shortfall is recorded as a discount.</span>
              </label>

              {isDiscounted && (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-400">Discount reason (required)</span>
                  <input
                    type="text"
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="e.g. festive offer"
                    className="w-full rounded-xl border border-amber-500/40 bg-slate-900 px-3 py-2 text-sm text-white"
                  />
                </label>
              )}

              {/* Summary */}
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
                <div className="flex justify-between text-slate-400"><span>Taxable</span><span className="text-slate-200">{inr(taxable)}</span></div>
                <div className="flex justify-between text-slate-400"><span>GST (CGST {inr(Math.floor(gst / 2))} + SGST {inr(gst - Math.floor(gst / 2))})</span><span className="text-slate-200">{inr(gst)}</span></div>
                {isDiscounted && <div className="flex justify-between text-amber-400"><span>Discount</span><span>− {inr(discountAmount)}</span></div>}
                <div className="mt-1 flex justify-between border-t border-white/10 pt-2 font-semibold text-white"><span>Total</span><span>{inr(receivedNum)}</span></div>
              </div>
            </>
          )}

          {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}
        </div>
      )}
    </Modal>
  );
}
