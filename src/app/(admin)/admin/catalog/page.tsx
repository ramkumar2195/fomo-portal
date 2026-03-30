"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminPageFrame, SurfaceCard } from "@/components/admin/page-frame";
import { Badge } from "@/components/common/badge";
import { FormField } from "@/components/common/form-field";
import { Modal } from "@/components/common/modal";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { ApiError } from "@/lib/api/http-client";
import { canManagePlans } from "@/lib/access-policy";
import {
  CatalogProduct,
  CatalogVariant,
  CreateCatalogVariantPayload,
  subscriptionService,
  UpdateCatalogVariantPayload,
} from "@/lib/api/services/subscription-service";

type ModalMode = "create" | "edit" | null;

interface VariantFormState {
  productCode: string;
  trackChoice: string;
  variantCode: string;
  variantName: string;
  durationMonths: string;
  basePrice: string;
  includedFeatures: string;
  extraVisitPrice: string;
  validityDays: string;
  includedPtSessions: string;
  passBenefitDays: string;
  includedCredits: string;
  checkInLimit: string;
  bonusCreditsOnFullUsage: string;
  creditBased: boolean;
}

const EMPTY_FORM: VariantFormState = {
  productCode: "",
  trackChoice: "",
  variantCode: "",
  variantName: "",
  durationMonths: "1",
  basePrice: "0",
  includedFeatures: "",
  extraVisitPrice: "0",
  validityDays: "30",
  includedPtSessions: "0",
  passBenefitDays: "0",
  includedCredits: "0",
  checkInLimit: "0",
  bonusCreditsOnFullUsage: "0",
  creditBased: false,
};

const DURATION_OPTIONS = [
  { label: "1 Month", value: "1" },
  { label: "3 Months", value: "3" },
  { label: "6 Months", value: "6" },
  { label: "12 Months", value: "12" },
];

const TRACK_OPTIONS = [
  { label: "Yoga", value: "YOGA" },
  { label: "Zumba", value: "ZUMBA" },
];

const SELECTABLE_TRACK_PRODUCT_CODES = new Set(["FOMO_MOVE", "FOMO_CORE_RHYTHM"]);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function titleFromCode(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultValidityDays(months: string): string {
  switch (months) {
    case "1":
      return "30";
    case "3":
      return "90";
    case "6":
      return "180";
    case "12":
      return "360";
    default:
      return "30";
  }
}

function toNumberString(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

function inferTrackChoice(variant: CatalogVariant): string {
  const featureSet = new Set(featureTokens(variant.includedFeatures));
  if (featureSet.has("YOGA_ACCESS") && !featureSet.has("ZUMBA_ACCESS")) {
    return "YOGA";
  }
  if (featureSet.has("ZUMBA_ACCESS") && !featureSet.has("YOGA_ACCESS")) {
    return "ZUMBA";
  }
  return "";
}

function variantToForm(variant: CatalogVariant): VariantFormState {
  return {
    productCode: variant.productCode,
    trackChoice: inferTrackChoice(variant),
    variantCode: variant.variantCode,
    variantName: variant.variantName,
    durationMonths: toNumberString(variant.durationMonths),
    basePrice: toNumberString(variant.basePrice),
    includedFeatures: variant.includedFeatures,
    extraVisitPrice: toNumberString(variant.extraVisitPrice),
    validityDays: toNumberString(variant.validityDays),
    includedPtSessions: toNumberString(variant.includedPtSessions),
    passBenefitDays: toNumberString(variant.passBenefitDays),
    includedCredits: toNumberString(variant.includedCredits),
    checkInLimit: toNumberString(variant.checkInLimit),
    bonusCreditsOnFullUsage: toNumberString(variant.bonusCreditsOnFullUsage),
    creditBased: variant.creditBased,
  };
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface CatalogFormProfile {
  isSelectableTrack: boolean;
  showExtraVisitPrice: boolean;
  showCheckInLimit: boolean;
  showIncludedPtSessions: boolean;
  showPassBenefitDays: boolean;
  showIncludedCredits: boolean;
  showBonusCredits: boolean;
  showCreditBased: boolean;
}

function getFormProfile(productCode: string): CatalogFormProfile {
  const isFlex = productCode.startsWith("FLEX_");
  const isPt = productCode.startsWith("PT_LEVEL_") || productCode.startsWith("COUPLE_PT_LEVEL_") || productCode === "GYM_PT_TRANSFORMATION";
  const isCreditPack = productCode.startsWith("CREDIT_");
  return {
    isSelectableTrack: SELECTABLE_TRACK_PRODUCT_CODES.has(productCode),
    showExtraVisitPrice: isFlex,
    showCheckInLimit: isFlex,
    showIncludedPtSessions: isPt,
    showPassBenefitDays: productCode === "FOMO_CORE_PLUS",
    showIncludedCredits: isCreditPack,
    showBonusCredits: isFlex,
    showCreditBased: isFlex || isCreditPack,
  };
}

function autoFeaturesForSelection(productCode: string, trackChoice: string): string {
  if (productCode === "FOMO_MOVE") {
    return trackChoice === "YOGA" ? "YOGA_ACCESS,GROUP_CLASS_ACCESS" : "ZUMBA_ACCESS,GROUP_CLASS_ACCESS";
  }
  if (productCode === "FOMO_CORE_RHYTHM") {
    return trackChoice === "YOGA"
      ? "GYM_ACCESS,YOGA_ACCESS,GROUP_CLASS_ACCESS"
      : "GYM_ACCESS,ZUMBA_ACCESS,GROUP_CLASS_ACCESS";
  }
  return "";
}

function autoVariantName(productName: string, durationMonths: string, trackChoice: string): string {
  const trackLabel = TRACK_OPTIONS.find((option) => option.value === trackChoice)?.label;
  if (!trackLabel) {
    return "";
  }
  return `${productName} - ${trackLabel} - ${durationMonths}M`;
}

function autoVariantCode(productCode: string, durationMonths: string, trackChoice: string): string {
  if (!trackChoice) {
    return "";
  }
  return normalizeCode(`${productCode}_${trackChoice}_${durationMonths}M`);
}

function defaultPassBenefitDays(productCode: string, durationMonths: string): string {
  if (productCode !== "FOMO_CORE_PLUS") {
    return "0";
  }

  switch (durationMonths) {
    case "1":
      return "7";
    case "3":
      return "14";
    case "6":
      return "21";
    case "12":
      return "28";
    default:
      return "0";
  }
}

function buildPayload(form: VariantFormState, profile: CatalogFormProfile): CreateCatalogVariantPayload {
  const includedFeatures = profile.isSelectableTrack
    ? autoFeaturesForSelection(form.productCode, form.trackChoice)
    : form.includedFeatures.trim();

  return {
    productCode: form.productCode,
    variantCode: normalizeCode(form.variantCode),
    variantName: form.variantName.trim(),
    durationMonths: Number(form.durationMonths),
    basePrice: Number(form.basePrice),
    includedFeatures,
    extraVisitPrice: profile.showExtraVisitPrice ? Number(form.extraVisitPrice) : 0,
    validityDays: Number(form.validityDays),
    includedPtSessions: profile.showIncludedPtSessions ? Number(form.includedPtSessions) : 0,
    passBenefitDays: profile.showPassBenefitDays ? Number(form.passBenefitDays) : 0,
    includedCredits: profile.showIncludedCredits ? Number(form.includedCredits) : 0,
    checkInLimit: profile.showCheckInLimit ? Number(form.checkInLimit) : 0,
    bonusCreditsOnFullUsage: profile.showBonusCredits ? Number(form.bonusCreditsOnFullUsage) : 0,
    creditBased: profile.showCreditBased ? form.creditBased : false,
  };
}

function featureTokens(features: string): string[] {
  return features
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function CatalogPage() {
  const { token, user } = useAuth();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [productFilter, setProductFilter] = useState("ALL");
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedVariant, setSelectedVariant] = useState<CatalogVariant | null>(null);
  const [form, setForm] = useState<VariantFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);

  const loadCatalog = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [productsResponse, variantsResponse] = await Promise.all([
        subscriptionService.getCatalogProducts(token),
        subscriptionService.getCatalogVariants(token),
      ]);
      setProducts(productsResponse);
      setVariants(variantsResponse);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : "Unable to load catalog.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const categoryOptions = useMemo(() => {
    const categories = Array.from(new Set(products.map((product) => product.categoryCode))).sort();
    return [{ label: "All Categories", value: "ALL" }, ...categories.map((code) => ({ label: titleFromCode(code), value: code }))];
  }, [products]);

  const productOptions = useMemo(() => {
    const scopedProducts = products.filter((product) => categoryFilter === "ALL" || product.categoryCode === categoryFilter);
    return [{ label: "All Product Families", value: "ALL" }, ...scopedProducts.map((product) => ({ label: product.productName, value: product.productCode }))];
  }, [categoryFilter, products]);

  const filteredVariants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return variants.filter((variant) => {
      if (categoryFilter !== "ALL" && variant.categoryCode !== categoryFilter) {
        return false;
      }
      if (productFilter !== "ALL" && variant.productCode !== productFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const product = products.find((item) => item.productCode === variant.productCode);
      return [
        variant.variantName,
        variant.variantCode,
        variant.productCode,
        product?.productName,
        variant.includedFeatures,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [categoryFilter, productFilter, products, search, variants]);

  const productFamilyGroups = useMemo(() => {
    const scopedProducts = products
      .filter((product) => categoryFilter === "ALL" || product.categoryCode === categoryFilter)
      .map((product) => ({
        ...product,
        variantCount: variants.filter((variant) => variant.productCode === product.productCode).length,
      }))
      .sort((left, right) => left.productName.localeCompare(right.productName));

    return Array.from(new Set(scopedProducts.map((product) => product.categoryCode)))
      .sort()
      .map((categoryCode) => ({
        categoryCode,
        products: scopedProducts.filter((product) => product.categoryCode === categoryCode),
      }))
      .filter((group) => group.products.length > 0);
  }, [categoryFilter, products, variants]);

  const catalogStats = useMemo(
    () => ({
      categories: new Set(products.map((product) => product.categoryCode)).size,
      products: products.length,
      variants: variants.length,
    }),
    [products, variants],
  );

  const resetForm = useCallback((nextProductCode?: string) => {
    setSelectedVariant(null);
    setForm({
      ...EMPTY_FORM,
      productCode: nextProductCode || (productFilter !== "ALL" ? productFilter : ""),
    });
  }, [productFilter]);

  const openCreate = () => {
    resetForm();
    setModalMode("create");
  };

  const openEdit = (variant: CatalogVariant) => {
    setSelectedVariant(variant);
    setForm(variantToForm(variant));
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedVariant(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!token) {
      return;
    }
    const profile = getFormProfile(form.productCode);
    if (profile.isSelectableTrack && !form.trackChoice) {
      setToast({ kind: "error", message: "Choose Yoga or Zumba for this product family." });
      return;
    }

    setSubmitting(true);
    try {
      if (modalMode === "create") {
        const created = await subscriptionService.createCatalogVariant(token, buildPayload(form, profile));
        setVariants((current) => [created, ...current]);
        setToast({ kind: "success", message: "Catalog variant created." });
      } else if (modalMode === "edit" && selectedVariant) {
        const payload: UpdateCatalogVariantPayload = buildPayload(form, profile);
        const updated = await subscriptionService.updateCatalogVariant(token, selectedVariant.variantId, payload);
        setVariants((current) => current.map((item) => (item.variantId === updated.variantId ? updated : item)));
        setToast({ kind: "success", message: "Catalog variant updated." });
      }
      closeModal();
    } catch (submitError) {
      setToast({
        kind: "error",
        message: submitError instanceof ApiError ? submitError.message : "Unable to save catalog variant.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (variant: CatalogVariant) => {
    if (!token) {
      return;
    }
    if (!window.confirm(`Deactivate ${variant.variantName}?`)) {
      return;
    }

    try {
      await subscriptionService.deactivateCatalogVariant(token, variant.variantId);
      setVariants((current) => current.filter((item) => item.variantId !== variant.variantId));
      setToast({ kind: "success", message: "Catalog variant deactivated." });
    } catch (deactivateError) {
      setToast({
        kind: "error",
        message: deactivateError instanceof ApiError ? deactivateError.message : "Unable to deactivate variant.",
      });
    }
  };

  const selectedProduct = useMemo(
    () => products.find((product) => product.productCode === form.productCode),
    [form.productCode, products],
  );

  const formProfile = useMemo(() => getFormProfile(form.productCode), [form.productCode]);

  useEffect(() => {
    if (!selectedProduct || !formProfile.isSelectableTrack || !form.trackChoice) {
      return;
    }

    const nextFeatures = autoFeaturesForSelection(form.productCode, form.trackChoice);
    const nextVariantName = autoVariantName(selectedProduct.productName, form.durationMonths, form.trackChoice);
    const nextVariantCode = autoVariantCode(form.productCode, form.durationMonths, form.trackChoice);

    setForm((current) => {
      if (
        current.includedFeatures === nextFeatures &&
        current.variantName === nextVariantName &&
        current.variantCode === nextVariantCode
      ) {
        return current;
      }

      return {
        ...current,
        includedFeatures: nextFeatures,
        variantName: nextVariantName,
        variantCode: nextVariantCode,
      };
    });
  }, [form.durationMonths, form.productCode, form.trackChoice, formProfile.isSelectableTrack, selectedProduct]);

  useEffect(() => {
    if (!formProfile.showPassBenefitDays) {
      setForm((current) => (current.passBenefitDays === "0" ? current : { ...current, passBenefitDays: "0" }));
      return;
    }

    if (form.productCode === "FOMO_CORE_PLUS") {
      const nextValue = defaultPassBenefitDays(form.productCode, form.durationMonths);
      setForm((current) => (current.passBenefitDays === nextValue ? current : { ...current, passBenefitDays: nextValue }));
    }
  }, [form.durationMonths, form.productCode, formProfile.showPassBenefitDays]);

  if (!user || !canManagePlans(user)) {
    return (
      <AdminPageFrame title="Packages & Plans" description="Manage the live package catalog and sellable plan variants">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Only super-admin can manage the membership catalog.
        </div>
      </AdminPageFrame>
    );
  }

  return (
    <>
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <AdminPageFrame
        title="Packages & Plans"
        description="View and manage the live package catalog, product families, and exact sellable variants."
        searchPlaceholder="Search by product, variant code, or features..."
        searchValue={search}
        onSearchChange={setSearch}
        filters={[
          { id: "category", label: "Category", options: categoryOptions },
          { id: "product", label: "Product Family", options: productOptions },
        ]}
        filterValues={{
          category: categoryFilter,
          product: productFilter,
        }}
        onFilterChange={(filterId, value) => {
          if (filterId === "category") {
            setCategoryFilter(value);
            setProductFilter("ALL");
            return;
          }
          if (filterId === "product") {
            setProductFilter(value);
          }
        }}
        action={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22]"
          >
            <Plus className="h-4 w-4" />
            Add Variant
          </button>
        }
      >
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Categories</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{catalogStats.categories}</p>
            <p className="mt-1 text-sm text-slate-500">Active package families available in the system.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Products</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{catalogStats.products}</p>
            <p className="mt-1 text-sm text-slate-500">Sellable package lines across flagship, PT, flex, and classes.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Variants</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{catalogStats.variants}</p>
            <p className="mt-1 text-sm text-slate-500">Duration- and entitlement-specific plans ready for billing.</p>
          </div>
        </div>

        <SurfaceCard title="Product Families">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Save the client&apos;s actual choice as the variant itself. Example: create `Core Rhythm Yoga - 3M` and `Core Rhythm Zumba - 3M` as separate sellable plans instead of one shared `Yoga or Zumba` variant.
            </div>

            {productFilter !== "ALL" ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-slate-700">
                <span className="font-semibold">Showing:</span>
                <Badge variant="neutral" size="sm">{products.find((product) => product.productCode === productFilter)?.productName || productFilter}</Badge>
                <button
                  type="button"
                  onClick={() => setProductFilter("ALL")}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Clear family filter
                </button>
              </div>
            ) : null}

            <div className="space-y-3">
              {productFamilyGroups.map((group) => (
                <div key={group.categoryCode} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {titleFromCode(group.categoryCode)}
                    </p>
                    <Badge variant="neutral" size="sm">
                      {group.products.length} families
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.products.map((product) => (
                      <button
                        key={product.productId}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(product.categoryCode);
                          setProductFilter(product.productCode);
                        }}
                        className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                          productFilter === product.productCode
                            ? "border-[#C42429] bg-rose-50 text-[#8f1b1f]"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <span className="font-semibold">{product.productName}</span>
                        <span className="ml-2 text-xs text-slate-500">{product.variantCount} variants</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Variants">
          {loading ? <div className="text-sm text-slate-500">Loading catalog...</div> : null}

          {!loading && filteredVariants.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No variants found for the current filters.
            </div>
          ) : null}

          {!loading && filteredVariants.length > 0 ? (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Variant</th>
                    <th className="px-4 py-3 text-left">Family</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-left">Entitlements</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredVariants
                    .sort((left, right) => left.productCode.localeCompare(right.productCode) || left.durationMonths - right.durationMonths || left.variantName.localeCompare(right.variantName))
                    .map((variant) => {
                      const product = products.find((item) => item.productCode === variant.productCode);
                      return (
                        <tr key={variant.variantId} className="align-top">
                          <td className="px-4 py-4">
                            <div className="font-semibold text-slate-800">{variant.variantName}</div>
                            <div className="mt-1 text-xs text-slate-500">{variant.variantCode}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Badge variant={variant.creditBased ? "info" : "neutral"} size="sm">
                                {variant.durationMonths}M / {variant.validityDays} days
                              </Badge>
                              {variant.creditBased ? (
                                <Badge variant="info" size="sm">
                                  Credit based
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="font-medium text-slate-700">{product?.productName || variant.productCode}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{titleFromCode(variant.categoryCode)}</div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="font-semibold text-slate-800">{formatCurrency(variant.basePrice)}</div>
                            {variant.extraVisitPrice > 0 ? (
                              <div className="mt-1 text-xs text-slate-500">Extra visit {formatCurrency(variant.extraVisitPrice)}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-4">
                            <div className="max-w-xl space-y-2">
                              <div className="flex flex-wrap gap-1.5">
                                {featureTokens(variant.includedFeatures).length > 0 ? (
                                  featureTokens(variant.includedFeatures).map((feature) => (
                                    <Badge key={feature} variant="neutral" size="sm">
                                      {feature}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-xs text-slate-400">No fixed feature bundle</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                                {variant.includedPtSessions > 0 ? (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1">PT {variant.includedPtSessions}</span>
                                ) : null}
                                {variant.passBenefitDays > 0 ? (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1">PAUSE benefit {variant.passBenefitDays} days</span>
                                ) : null}
                                {variant.includedCredits > 0 ? (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1">Credits {variant.includedCredits}</span>
                                ) : null}
                                {variant.checkInLimit > 0 ? (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1">Check-ins {variant.checkInLimit}</span>
                                ) : null}
                                {variant.bonusCreditsOnFullUsage > 0 ? (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1">Bonus {variant.bonusCreditsOnFullUsage}</span>
                                ) : null}
                                {variant.includedPtSessions === 0 &&
                                variant.passBenefitDays === 0 &&
                                variant.includedCredits === 0 &&
                                variant.checkInLimit === 0 &&
                                variant.bonusCreditsOnFullUsage === 0 ? (
                                  <span className="text-slate-400">No extra limits or bundled usage.</span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(variant)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeactivate(variant)}
                                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Deactivate
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : null}
        </SurfaceCard>
      </AdminPageFrame>

      <Modal
        open={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Create Catalog Variant" : "Edit Catalog Variant"}
        size="xl"
        footer={
          <>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-[#C42429] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ab1e22] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {modalMode === "create" ? "Create Variant" : "Save Changes"}
            </button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Product Family" required>
            <select
              value={form.productCode}
              onChange={(event) => {
                const nextProductCode = event.target.value;
                const nextProfile = getFormProfile(nextProductCode);
                setForm((current) => ({
                  ...current,
                  productCode: nextProductCode,
                  trackChoice: nextProfile.isSelectableTrack ? "" : current.trackChoice,
                  extraVisitPrice: nextProfile.showExtraVisitPrice ? current.extraVisitPrice : "0",
                  checkInLimit: nextProfile.showCheckInLimit ? current.checkInLimit : "0",
                  includedPtSessions: nextProfile.showIncludedPtSessions ? current.includedPtSessions : "0",
                  passBenefitDays: nextProfile.showPassBenefitDays ? defaultPassBenefitDays(nextProductCode, current.durationMonths) : "0",
                  includedCredits: nextProfile.showIncludedCredits ? current.includedCredits : "0",
                  bonusCreditsOnFullUsage: nextProfile.showBonusCredits ? current.bonusCreditsOnFullUsage : "0",
                  creditBased: nextProfile.showCreditBased ? current.creditBased : false,
                }));
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Choose a product</option>
              {products
                .slice()
                .sort((left, right) => left.productName.localeCompare(right.productName))
                .map((product) => (
                  <option key={product.productId} value={product.productCode}>
                    {product.productName} ({titleFromCode(product.categoryCode)})
                  </option>
                ))}
            </select>
          </FormField>

          <FormField label="Duration" required>
            <div className="flex gap-2">
              <select
                value={form.durationMonths}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    durationMonths: event.target.value,
                    validityDays: current.validityDays === EMPTY_FORM.validityDays || !current.validityDays ? defaultValidityDays(event.target.value) : current.validityDays,
                  }))
                }
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, validityDays: defaultValidityDays(current.durationMonths) }))}
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Autofill days
              </button>
            </div>
          </FormField>

          {formProfile.isSelectableTrack ? (
            <FormField label="Track Selection" required>
              <select
                value={form.trackChoice}
                onChange={(event) => setForm((current) => ({ ...current, trackChoice: event.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Choose Yoga or Zumba</option>
                {TRACK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          ) : null}

          <FormField label="Variant Name" required>
            <input
              value={form.variantName}
              onChange={(event) => setForm((current) => ({ ...current, variantName: event.target.value }))}
              className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-sm ${formProfile.isSelectableTrack ? "bg-slate-50 text-slate-500" : ""}`}
              placeholder="FOMO Move Yoga - 1M"
              readOnly={formProfile.isSelectableTrack}
            />
          </FormField>

          <FormField label="Variant Code" required>
            <input
              value={form.variantCode}
              onChange={(event) => setForm((current) => ({ ...current, variantCode: normalizeCode(event.target.value) }))}
              className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-sm uppercase ${formProfile.isSelectableTrack ? "bg-slate-50 text-slate-500" : ""}`}
              placeholder="MOVE_YOGA_1M"
              readOnly={formProfile.isSelectableTrack}
            />
          </FormField>

          <FormField label="Base Price" required>
            <input
              value={form.basePrice}
              onChange={(event) => setForm((current) => ({ ...current, basePrice: event.target.value.replace(/[^0-9.]/g, "") }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>

          {formProfile.showExtraVisitPrice ? (
            <FormField label="Extra Visit Price">
              <input
                value={form.extraVisitPrice}
                onChange={(event) => setForm((current) => ({ ...current, extraVisitPrice: event.target.value.replace(/[^0-9.]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          <FormField label="Validity Days" required>
            <input
              value={form.validityDays}
              onChange={(event) => setForm((current) => ({ ...current, validityDays: event.target.value.replace(/[^0-9]/g, "") }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </FormField>

          {formProfile.showCheckInLimit ? (
            <FormField label="Check-in Limit">
              <input
                value={form.checkInLimit}
                onChange={(event) => setForm((current) => ({ ...current, checkInLimit: event.target.value.replace(/[^0-9]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          {formProfile.showIncludedPtSessions ? (
            <FormField label="Included PT Sessions">
              <input
                value={form.includedPtSessions}
                onChange={(event) => setForm((current) => ({ ...current, includedPtSessions: event.target.value.replace(/[^0-9]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          {formProfile.showPassBenefitDays ? (
            <FormField label="PAUSE Benefit Days">
              <input
                value={form.passBenefitDays}
                onChange={(event) => setForm((current) => ({ ...current, passBenefitDays: event.target.value.replace(/[^0-9]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          {formProfile.showIncludedCredits ? (
            <FormField label="Included Credits">
              <input
                value={form.includedCredits}
                onChange={(event) => setForm((current) => ({ ...current, includedCredits: event.target.value.replace(/[^0-9]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          {formProfile.showBonusCredits ? (
            <FormField label="Bonus Credits On Full Usage">
              <input
                value={form.bonusCreditsOnFullUsage}
                onChange={(event) => setForm((current) => ({ ...current, bonusCreditsOnFullUsage: event.target.value.replace(/[^0-9]/g, "") }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </FormField>
          ) : null}

          <FormField label="Features / Entitlements">
            <textarea
              value={form.includedFeatures}
              onChange={(event) => setForm((current) => ({ ...current, includedFeatures: event.target.value }))}
              className={`min-h-[112px] w-full rounded-lg border border-gray-200 px-3 py-2 text-sm ${formProfile.isSelectableTrack ? "bg-slate-50 text-slate-500" : ""}`}
              placeholder="GYM_ACCESS,YOGA_ACCESS or GYM_ACCESS,ZUMBA_ACCESS"
              readOnly={formProfile.isSelectableTrack}
            />
          </FormField>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-800">Selected Product</p>
            <p className="text-sm text-slate-600">{selectedProduct?.productName || "Choose a product family to continue."}</p>
            <div className="text-xs text-slate-500">
              Category: {selectedProduct ? titleFromCode(selectedProduct.categoryCode) : "-"}
            </div>
            <p className="text-xs text-slate-500">
              Store member-specific choice as the exact variant. Example: `Move Yoga - 1M` and `Move Zumba - 1M` should be two separate variants.
            </p>
            {formProfile.showCreditBased ? (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.creditBased}
                    onChange={(event) => setForm((current) => ({ ...current, creditBased: event.target.checked }))}
                  />
                  Credit-based variant
                </label>
                <p className="text-xs text-slate-500">
                  Use this for wallet packages and usage-led plans like Flex, where credits or check-ins define access.
                </p>
              </>
            ) : null}
          </div>
        </div>
      </Modal>
    </>
  );
}
