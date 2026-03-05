"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PageLoader } from "@/components/common/page-loader";
import { SectionCard } from "@/components/common/section-card";
import { useAuth } from "@/contexts/auth-context";
import { canManagePlans } from "@/lib/access-policy";
import {
  InvoicePaymentRequest,
  subscriptionService,
  SubscriptionCreateRequest,
} from "@/lib/api/services/subscription-service";
import { usersService } from "@/lib/api/services/users-service";
import { GST_DEFAULT_PERCENT } from "@/lib/constants";
import { formatCurrency } from "@/lib/formatters";
import { BillingInvoice, Plan, UserDirectoryItem } from "@/types/models";

export default function BillingPage() {
  const { token, user } = useAuth();
  const canManagePlanCatalog = canManagePlans(user);

  const [members, setMembers] = useState<UserDirectoryItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BillingInvoice | null>(null);

  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [gstPercent, setGstPercent] = useState(GST_DEFAULT_PERCENT);
  const [categoryCode, setCategoryCode] = useState("");
  const [productCode, setProductCode] = useState("");
  const [subscriptionId, setSubscriptionId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");

  const loadMembers = useCallback(async () => {
    if (!token) {
      return;
    }

    const memberList = await usersService.getUsersByRole(token, "MEMBER");
    setMembers(memberList);
    setSelectedMemberId((current) => current || memberList[0]?.id || "");
  }, [token]);

  const loadPlans = useCallback(async () => {
    if (!token || !categoryCode || !productCode) {
      return;
    }

    const variants = await subscriptionService.getCatalogVariants(token, categoryCode, productCode);
    setPlans(variants);
    setSelectedPlanId((current) => current || variants[0]?.id || "");

    if (variants[0]?.gstPercent) {
      setGstPercent(variants[0].gstPercent);
    }
  }, [token, categoryCode, productCode]);

  useEffect(() => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);

    void loadMembers()
      .catch((loadError) => {
        const message = loadError instanceof Error ? loadError.message : "Unable to load members";
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [token, loadMembers]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId],
  );

  useEffect(() => {
    if (selectedPlan?.gstPercent) {
      setGstPercent(selectedPlan.gstPercent);
    }
  }, [selectedPlan]);

  const billingPreview = useMemo(() => {
    const baseAmount = selectedPlan?.price || 0;
    const discount = Math.max(0, discountAmount);
    const taxableAmount = Math.max(0, baseAmount - discount);
    const gstAmount = (taxableAmount * Math.max(0, gstPercent)) / 100;
    const total = taxableAmount + gstAmount;

    return {
      baseAmount,
      discount,
      taxableAmount,
      gstAmount,
      total,
    };
  }, [selectedPlan?.price, discountAmount, gstPercent]);

  const handleCreateSubscription = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !selectedMemberId || !selectedPlanId) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const payload: SubscriptionCreateRequest = {
        variantId: selectedPlanId,
        discountAmount: billingPreview.discount,
        gstPercent,
      };

      const response = await subscriptionService.createMemberSubscription(token, selectedMemberId, payload);
      setResult(response);
      if (response.subscriptionId) {
        setSubscriptionId(response.subscriptionId);
      }
      if (response.invoiceId) {
        setInvoiceId(response.invoiceId);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to create subscription";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleActivate = async () => {
    if (!token || !subscriptionId) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await subscriptionService.activateSubscription(token, subscriptionId);
      setResult(response);
      if (response.invoiceId) {
        setInvoiceId(response.invoiceId);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to activate subscription";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePayInvoice = async () => {
    if (!token || !invoiceId) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const payload: InvoicePaymentRequest = {
        amount: billingPreview.total,
      };
      const response = await subscriptionService.payInvoice(token, invoiceId, payload);
      setResult(response);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unable to pay invoice";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <PageLoader label="Loading billing data..." />;
  }

  return (
    <div className="space-y-5">
      <SectionCard title="Quick Billing" subtitle="Subscription v2 flow: catalog -> create -> activate -> pay">
        <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          {canManagePlanCatalog
            ? "SUPER_ADMIN access: plan and catalog master controls are permitted."
            : "Plan/catalog master control is restricted to SUPER_ADMIN. Billing operations remain available."}
        </p>
        <form className="grid gap-4 lg:grid-cols-2" onSubmit={handleCreateSubscription}>
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Member
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={selectedMemberId}
                onChange={(event) => setSelectedMemberId(event.target.value)}
                required
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.mobile})
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Category code
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={categoryCode}
                  onChange={(event) => setCategoryCode(event.target.value)}
                  placeholder="e.g. MEMBERSHIP"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Product code
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={productCode}
                  onChange={(event) => setProductCode(event.target.value)}
                  placeholder="e.g. GYM"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void loadPlans()}
              disabled={!categoryCode || !productCode || isSubmitting}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:bg-slate-100"
            >
              Fetch Plans
            </button>

            <label className="block text-sm font-medium text-slate-700">
              Plan variant
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                required
              >
                <option value="" disabled>
                  Select plan variant
                </option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} - {formatCurrency(plan.price)} ({plan.durationMonths || 0} months)
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Discount amount
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                step={100}
                value={discountAmount}
                onChange={(event) => setDiscountAmount(Number(event.target.value || 0))}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              GST %
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                type="number"
                min={0}
                max={100}
                step={1}
                value={gstPercent}
                onChange={(event) => setGstPercent(Number(event.target.value || 0))}
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting || !selectedMemberId || !selectedPlanId}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
            >
              {isSubmitting ? "Processing..." : "Create Subscription"}
            </button>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-semibold text-slate-900">Billing Summary</h3>
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex justify-between">
                <span>Plan amount</span>
                <span>{formatCurrency(billingPreview.baseAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Discount</span>
                <span>-{formatCurrency(billingPreview.discount)}</span>
              </div>
              <div className="flex justify-between">
                <span>Taxable amount</span>
                <span>{formatCurrency(billingPreview.taxableAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>GST ({gstPercent}%)</span>
                <span>{formatCurrency(billingPreview.gstAmount)}</span>
              </div>
              <div className="mt-2 border-t border-slate-300 pt-2 text-base font-semibold text-slate-900">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span>{formatCurrency(billingPreview.total)}</span>
                </div>
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-700">
              Subscription ID
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={subscriptionId}
                onChange={(event) => setSubscriptionId(event.target.value)}
                placeholder="From create subscription response"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleActivate()}
              disabled={isSubmitting || !subscriptionId}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:bg-slate-100"
            >
              Activate Subscription
            </button>

            <label className="block text-sm font-medium text-slate-700">
              Invoice ID
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={invoiceId}
                onChange={(event) => setInvoiceId(event.target.value)}
                placeholder="From create/activate response"
              />
            </label>

            <button
              type="button"
              onClick={() => void handlePayInvoice()}
              disabled={isSubmitting || !invoiceId}
              className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:bg-emerald-300"
            >
              Pay Invoice
            </button>

            {result ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <p>
                  Subscription: <strong>{result.subscriptionId || "-"}</strong>
                </p>
                <p>
                  Invoice: <strong>{result.invoiceId || "-"}</strong>
                </p>
                <p>
                  Receipt: <strong>{result.receiptId || "-"}</strong>
                </p>
                <p>Total: {formatCurrency(result.total)}</p>
              </div>
            ) : null}
          </div>
        </form>

        {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      </SectionCard>

      <SectionCard title="Membership Packages" subtitle="Catalog variants currently available from backend">
        <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
          Package create/update endpoints are not available in the current backend contract. You can fetch and view
          packages here; create/edit will be enabled once backend APIs are provided.
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-2 py-2 font-semibold">Variant</th>
                <th className="px-2 py-2 font-semibold">Duration</th>
                <th className="px-2 py-2 font-semibold">Price</th>
                <th className="px-2 py-2 font-semibold">GST %</th>
                <th className="px-2 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-slate-500" colSpan={5}>
                    No packages loaded. Enter category/product code and click Fetch Plans.
                  </td>
                </tr>
              ) : (
                plans.map((plan) => (
                  <tr key={`package-${plan.id}`} className="border-b border-slate-100">
                    <td className="px-2 py-3 font-medium text-slate-900">{plan.name}</td>
                    <td className="px-2 py-3">{plan.durationMonths || 0} months</td>
                    <td className="px-2 py-3">{formatCurrency(plan.price)}</td>
                    <td className="px-2 py-3">{plan.gstPercent ?? GST_DEFAULT_PERCENT}</td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        disabled
                        className="cursor-not-allowed rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-400"
                      >
                        Edit (Pending API)
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
