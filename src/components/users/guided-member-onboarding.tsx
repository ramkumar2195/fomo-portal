"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Layers3,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
} from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { ToastBanner } from "@/components/common/toast-banner";
import { useAuth } from "@/contexts/auth-context";
import { useBranch } from "@/contexts/branch-context";
import { hasCapability } from "@/lib/access-policy";
import { ApiError } from "@/lib/api/http-client";
import { BillingSettings, CatalogProduct, CatalogVariant, subscriptionService } from "@/lib/api/services/subscription-service";
import { formatInquiryCode, formatMemberCode } from "@/lib/inquiry-code";
import { RegisterUserRequest, usersService } from "@/lib/api/services/users-service";
import { resolveStaffId } from "@/lib/staff-id";
import { EmploymentType } from "@/types/auth";
import { InquiryRecord } from "@/types/inquiry";
import { UserDirectoryItem } from "@/types/models";

interface GuidedMemberOnboardingProps {
  sourceInquiryId: number;
}

interface MemberFormState {
  fullName: string;
  mobileNumber: string;
  password: string;
  email: string;
  alternateMobileNumber: string;
  dateOfBirth: string;
  gender: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  defaultBranchId: string;
}

interface SubscriptionFormState {
  productVariantId: string;
  addOnVariantId: string;
  startDate: string;
  sellingPrice: string;
  discountPercent: string;
  paymentMode: string;
  receivedAmount: string;
}

interface ComplementaryFieldState {
  enabled: boolean;
  count: string;
  recurrence: string;
}

interface ComplementaryState {
  steam: ComplementaryFieldState;
  iceBath: ComplementaryFieldState;
  nutritionCounseling: ComplementaryFieldState;
  physiotherapyCounseling: ComplementaryFieldState;
  passBenefit: {
    enabled: boolean;
    days: string;
  };
}

interface ToastState {
  kind: "success" | "error" | "info";
  message: string;
}

interface CompletedOnboardingState {
  memberId: number;
  memberSubscriptionId: number;
  invoiceId: number;
  invoiceNumber: string;
  invoiceStatus: string;
  receiptId?: number;
  receiptNumber?: string;
  paymentStatus: string;
  paymentMode: string;
  totalPaidAmount: number;
  balanceAmount: number;
}

type OnboardingStep = 1 | 2 | 3;
type PricingInputMode = "sellingPrice" | "discountPercent" | null;

const CREATE_MEMBER_CAPABILITIES = [
  "MEMBER_CREATE",
  "MEMBER_ONBOARDING",
  "USER_CREATE",
  "USERS_CREATE",
  "USER_MANAGE",
] as const;

const INQUIRY_CONVERT_CAPABILITIES = ["INQUIRY_CONVERT", "MEMBER_ONBOARDING", "INQUIRY_MANAGE"] as const;

const FLAGSHIP_PRODUCT_CODES = new Set([
  "FOMO_CORE",
  "FOMO_CORE_PLUS",
  "FOMO_CORE_RHYTHM",
  "FOMO_BLACK",
]);

const RECURRENCE_OPTIONS = [
  { label: "Full term", value: "FULL_TERM" },
  { label: "Monthly", value: "MONTHLY" },
  { label: "Quarterly", value: "QUARTERLY" },
  { label: "Half yearly", value: "HALF_YEARLY" },
] as const;

const PAYMENT_MODE_OPTIONS = [
  { label: "UPI", value: "UPI" },
  { label: "Card", value: "CARD" },
  { label: "Cash", value: "CASH" },
  { label: "Other", value: "OTHER" },
] as const;

function toOptionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatPaymentCollectionStatus(receivedAmount: number, balanceAmount: number): string {
  if (receivedAmount <= 0) {
    return "Pending";
  }
  if (balanceAmount > 0) {
    return "Pending";
  }
  return "Paid";
}

function formatInvoiceLifecycleStatus(invoiceStatus?: string, completed = false): string {
  if (!completed) {
    return "Will be issued on completion";
  }
  const normalized = String(invoiceStatus || "").toUpperCase();
  if (normalized === "PARTIALLY_PAID") {
    return "Partially Paid";
  }
  if (normalized === "PAID") {
    return "Paid";
  }
  if (normalized === "ISSUED") {
    return "Issued";
  }
  return normalized.replace(/_/g, " ") || "-";
}

function resolveMemberId(createdUser: UserDirectoryItem): number | null {
  const directId = Number(String(createdUser.id || "").trim());
  if (!Number.isNaN(directId) && Number.isFinite(directId)) {
    return directId;
  }

  const idDigits = String(createdUser.id || "").replace(/[^0-9]/g, "");
  if (idDigits.length > 0) {
    const parsed = Number(idDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  const mobileDigits = String(createdUser.mobile || "").replace(/[^0-9]/g, "");
  if (mobileDigits.length > 0) {
    const parsed = Number(mobileDigits);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeNumericString(value: string): string {
  return value.replace(/[^0-9.]/g, "");
}

function formatDecimalInput(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}

function normalizeBranchId(value?: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === "default" || trimmed.toLowerCase() === "null") {
    return "";
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function featurePillLabel(feature: string): string {
  return feature
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function splitFeatures(features: string): string[] {
  return features
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);
}

function isFlagshipVariant(variant: CatalogVariant | undefined): boolean {
  return Boolean(variant && FLAGSHIP_PRODUCT_CODES.has(variant.productCode));
}

function initialComplementaryState(): ComplementaryState {
  return {
    steam: { enabled: false, count: "1", recurrence: "MONTHLY" },
    iceBath: { enabled: false, count: "1", recurrence: "QUARTERLY" },
    nutritionCounseling: { enabled: false, count: "1", recurrence: "FULL_TERM" },
    physiotherapyCounseling: { enabled: false, count: "1", recurrence: "FULL_TERM" },
    passBenefit: { enabled: false, days: "0" },
  };
}

function defaultBillingSettings(): BillingSettings {
  const year = new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  return {
    gstPercentage: 5,
    invoicePrefix: "INV",
    nextInvoiceNumber: 1,
    invoiceSequenceYear: year,
    receiptPrefix: "RCPT",
    nextReceiptNumber: 1,
    receiptSequenceYear: year,
  };
}

function productFamilyLabel(categoryCode?: string): string {
  if (!categoryCode) {
    return "Membership";
  }

  const normalized = categoryCode.toUpperCase();
  if (normalized === "GROUP_CLASS") {
    return "Group Classes";
  }
  if (normalized === "PT") {
    return "Personal Training";
  }
  if (normalized === "FLAGSHIP") {
    return "Flagship";
  }
  if (normalized === "CREDIT_PACK") {
    return "Credits";
  }
  return featurePillLabel(normalized);
}

function statusBadgeClass(active: boolean): string {
  return active
    ? "border-[#c42924]/40 bg-[#c42924]/12 text-[#ffd7d6]"
    : "border-white/10 bg-white/[0.04] text-slate-300";
}

function initials(value: string): string {
  return value
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

export function GuidedMemberOnboarding({ sourceInquiryId }: GuidedMemberOnboardingProps) {
  const router = useRouter();
  const { token, user, accessMetadata } = useAuth();
  const { effectiveBranchId, selectedBranchId } = useBranch();

  const canCreateMember = hasCapability(user, accessMetadata, CREATE_MEMBER_CAPABILITIES, true);
  const canConvertInquiry = hasCapability(user, accessMetadata, INQUIRY_CONVERT_CAPABILITIES, true);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [inquiry, setInquiry] = useState<InquiryRecord | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [variants, setVariants] = useState<CatalogVariant[]>([]);
  const [branchCoaches, setBranchCoaches] = useState<UserDirectoryItem[]>([]);
  const [branchMembers, setBranchMembers] = useState<UserDirectoryItem[]>([]);
  const [assignedTrainer, setAssignedTrainer] = useState<UserDirectoryItem | null>(null);
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(defaultBillingSettings);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(1);
  const [pricingInputMode, setPricingInputMode] = useState<PricingInputMode>(null);
  const [completedOnboarding, setCompletedOnboarding] = useState<CompletedOnboardingState | null>(null);
  const [primaryCategoryFilter, setPrimaryCategoryFilter] = useState("");
  const [primaryProductFilter, setPrimaryProductFilter] = useState("");
  const [addOnCategoryFilter, setAddOnCategoryFilter] = useState("");
  const [addOnProductFilter, setAddOnProductFilter] = useState("");

  const [memberForm, setMemberForm] = useState<MemberFormState>({
    fullName: "",
    mobileNumber: "",
    password: "",
    email: "",
    alternateMobileNumber: "",
    dateOfBirth: "",
    gender: "",
    address: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    defaultBranchId: normalizeBranchId(selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId)),
  });

  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionFormState>({
    productVariantId: "",
    addOnVariantId: "",
    startDate: new Date().toISOString().slice(0, 10),
    sellingPrice: "",
    discountPercent: "",
    paymentMode: "UPI",
    receivedAmount: "",
  });

  const [complementaries, setComplementaries] = useState<ComplementaryState>(initialComplementaryState);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inquiryResult, productsResult, variantsResult, billingSettingsResult] = await Promise.allSettled([
          subscriptionService.getInquiryById(token, sourceInquiryId),
          subscriptionService.getCatalogProducts(token),
          subscriptionService.getCatalogVariants(token),
          subscriptionService.getBillingSettings(token),
        ]);

        if (!active) {
          return;
        }

        if (inquiryResult.status === "fulfilled") {
          const inquiryResponse = inquiryResult.value;
          setInquiry(inquiryResponse);
          setMemberForm((current) => ({
            ...current,
            fullName: inquiryResponse.fullName || "",
            mobileNumber: (inquiryResponse.mobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            password: (inquiryResponse.mobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            email: "",
            alternateMobileNumber: (inquiryResponse.alternateMobileNumber || "").replace(/[^0-9]/g, "").slice(0, 10),
            dateOfBirth: inquiryResponse.dateOfBirth || "",
            gender: inquiryResponse.gender || "",
            address: inquiryResponse.address || "",
            emergencyContactName: inquiryResponse.emergencyContactName || "",
            emergencyContactPhone: (inquiryResponse.emergencyContactPhone || "").replace(/[^0-9]/g, "").slice(0, 10),
            emergencyContactRelation: inquiryResponse.emergencyContactRelation || "",
            defaultBranchId:
              current.defaultBranchId ||
              normalizeBranchId(selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId)),
          }));
        } else {
          throw inquiryResult.reason;
        }

        setProducts(productsResult.status === "fulfilled" ? productsResult.value : []);
        setVariants(variantsResult.status === "fulfilled" ? variantsResult.value : []);
        setBillingSettings(
          billingSettingsResult.status === "fulfilled"
            ? billingSettingsResult.value
            : defaultBillingSettings(),
        );
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof ApiError ? loadError.message : "Unable to load inquiry onboarding data.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [effectiveBranchId, selectedBranchId, sourceInquiryId, token, user?.defaultBranchId]);

  useEffect(() => {
    const resolvedBranchId = normalizeBranchId(
      selectedBranchId && selectedBranchId !== "default" ? selectedBranchId : (effectiveBranchId ?? user?.defaultBranchId),
    );
    if (!resolvedBranchId) {
      return;
    }

    setMemberForm((current) => (current.defaultBranchId === resolvedBranchId ? current : { ...current, defaultBranchId: resolvedBranchId }));
  }, [effectiveBranchId, selectedBranchId, user?.defaultBranchId]);

  const primaryVariants = useMemo(
    () =>
      variants
        .filter((variant) => variant.categoryCode !== "PT" && variant.categoryCode !== "CREDIT_PACK")
        .sort((left, right) => left.productCode.localeCompare(right.productCode) || left.durationMonths - right.durationMonths || left.variantName.localeCompare(right.variantName)),
    [variants],
  );

  const addOnVariants = useMemo(
    () =>
      variants
        .filter((variant) => variant.categoryCode === "PT")
        .sort((left, right) => left.variantName.localeCompare(right.variantName)),
    [variants],
  );

  const primaryCategoryOptions = useMemo(
    () =>
      Array.from(new Set(primaryVariants.map((variant) => variant.categoryCode)))
        .filter(Boolean)
        .sort(),
    [primaryVariants],
  );

  const filteredPrimaryProducts = useMemo(
    () =>
      products
        .filter((product) => product.categoryCode === primaryCategoryFilter)
        .filter((product) => primaryVariants.some((variant) => variant.productCode === product.productCode))
        .sort((left, right) => left.productName.localeCompare(right.productName)),
    [primaryCategoryFilter, primaryVariants, products],
  );

  const filteredPrimaryVariants = useMemo(
    () =>
      primaryVariants.filter((variant) => {
        if (primaryCategoryFilter && variant.categoryCode !== primaryCategoryFilter) {
          return false;
        }
        if (primaryProductFilter && variant.productCode !== primaryProductFilter) {
          return false;
        }
        return true;
      }),
    [primaryCategoryFilter, primaryProductFilter, primaryVariants],
  );

  const addOnCategoryOptions = useMemo(
    () =>
      Array.from(new Set(addOnVariants.map((variant) => variant.categoryCode)))
        .filter(Boolean)
        .sort(),
    [addOnVariants],
  );

  const filteredAddOnProducts = useMemo(
    () =>
      products
        .filter((product) => product.categoryCode === addOnCategoryFilter)
        .filter((product) => addOnVariants.some((variant) => variant.productCode === product.productCode))
        .sort((left, right) => left.productName.localeCompare(right.productName)),
    [addOnCategoryFilter, addOnVariants, products],
  );

  const filteredAddOnVariants = useMemo(
    () =>
      addOnVariants.filter((variant) => {
        if (addOnCategoryFilter && variant.categoryCode !== addOnCategoryFilter) {
          return false;
        }
        if (addOnProductFilter && variant.productCode !== addOnProductFilter) {
          return false;
        }
        return true;
      }),
    [addOnCategoryFilter, addOnProductFilter, addOnVariants],
  );

  const selectedPrimaryVariant = useMemo(
    () => primaryVariants.find((variant) => variant.variantId === subscriptionForm.productVariantId),
    [primaryVariants, subscriptionForm.productVariantId],
  );

  const selectedPrimaryProduct = useMemo(
    () => products.find((product) => product.productCode === selectedPrimaryVariant?.productCode),
    [products, selectedPrimaryVariant?.productCode],
  );

  const selectedAddOnVariants = useMemo(
    () => addOnVariants.filter((variant) => variant.variantId === subscriptionForm.addOnVariantId),
    [addOnVariants, subscriptionForm.addOnVariantId],
  );

  useEffect(() => {
    if (selectedPrimaryVariant) {
      if (primaryCategoryFilter !== selectedPrimaryVariant.categoryCode) {
        setPrimaryCategoryFilter(selectedPrimaryVariant.categoryCode);
      }
      if (primaryProductFilter !== selectedPrimaryVariant.productCode) {
        setPrimaryProductFilter(selectedPrimaryVariant.productCode);
      }
      return;
    }

    if (!primaryCategoryFilter && primaryCategoryOptions.length > 0) {
      setPrimaryCategoryFilter(primaryCategoryOptions[0]);
    }
  }, [primaryCategoryFilter, primaryCategoryOptions, primaryProductFilter, selectedPrimaryVariant]);

  useEffect(() => {
    if (!primaryCategoryFilter) {
      if (primaryProductFilter) {
        setPrimaryProductFilter("");
      }
      return;
    }

    const firstProduct = filteredPrimaryProducts[0]?.productCode || "";
    if (!primaryProductFilter || !filteredPrimaryProducts.some((product) => product.productCode === primaryProductFilter)) {
      setPrimaryProductFilter(firstProduct);
    }
  }, [filteredPrimaryProducts, primaryCategoryFilter, primaryProductFilter]);

  useEffect(() => {
    const selectedVariantStillVisible = filteredPrimaryVariants.some(
      (variant) => variant.variantId === subscriptionForm.productVariantId,
    );
    if (!selectedVariantStillVisible && subscriptionForm.productVariantId) {
      setSubscriptionForm((current) => ({
        ...current,
        productVariantId: "",
        sellingPrice: "",
        discountPercent: "",
      }));
      setPricingInputMode(null);
    }
  }, [filteredPrimaryVariants, subscriptionForm.productVariantId]);

  useEffect(() => {
    if (subscriptionForm.addOnVariantId) {
      const selectedAddOn = addOnVariants.find((variant) => variant.variantId === subscriptionForm.addOnVariantId);
      if (selectedAddOn) {
        if (addOnCategoryFilter !== selectedAddOn.categoryCode) {
          setAddOnCategoryFilter(selectedAddOn.categoryCode);
        }
        if (addOnProductFilter !== selectedAddOn.productCode) {
          setAddOnProductFilter(selectedAddOn.productCode);
        }
        return;
      }
    }

    if (!addOnCategoryFilter && addOnCategoryOptions.length > 0) {
      setAddOnCategoryFilter(addOnCategoryOptions[0]);
    }
  }, [addOnCategoryFilter, addOnCategoryOptions, addOnProductFilter, addOnVariants, subscriptionForm.addOnVariantId]);

  useEffect(() => {
    if (!addOnCategoryFilter) {
      if (addOnProductFilter) {
        setAddOnProductFilter("");
      }
      return;
    }

    const firstProduct = filteredAddOnProducts[0]?.productCode || "";
    if (!addOnProductFilter || !filteredAddOnProducts.some((product) => product.productCode === addOnProductFilter)) {
      setAddOnProductFilter(firstProduct);
    }
  }, [addOnCategoryFilter, addOnProductFilter, filteredAddOnProducts]);

  useEffect(() => {
    const selectedVariantStillVisible = filteredAddOnVariants.some(
      (variant) => variant.variantId === subscriptionForm.addOnVariantId,
    );
    if (!selectedVariantStillVisible && subscriptionForm.addOnVariantId) {
      setSubscriptionForm((current) => ({ ...current, addOnVariantId: "" }));
    }
  }, [filteredAddOnVariants, subscriptionForm.addOnVariantId]);

  const baseCatalogAmount = useMemo(
    () =>
      [
        selectedPrimaryVariant?.basePrice || 0,
        ...selectedAddOnVariants.map((variant) => variant.basePrice || 0),
      ].reduce((sum, amount) => sum + amount, 0),
    [selectedAddOnVariants, selectedPrimaryVariant?.basePrice],
  );

  useEffect(() => {
    if (pricingInputMode === "discountPercent") {
      const percentValue = toNumber(subscriptionForm.discountPercent);
      if (percentValue === undefined || baseCatalogAmount <= 0) {
        if (subscriptionForm.sellingPrice !== "") {
          setSubscriptionForm((current) => ({ ...current, sellingPrice: "" }));
        }
        return;
      }

      const normalizedPercent = Math.min(100, Math.max(0, percentValue));
      const nextSellingPrice = formatDecimalInput(baseCatalogAmount * (1 - normalizedPercent / 100));
      const nextDiscountPercent = formatDecimalInput(normalizedPercent);
      if (subscriptionForm.sellingPrice !== nextSellingPrice || subscriptionForm.discountPercent !== nextDiscountPercent) {
        setSubscriptionForm((current) => ({
          ...current,
          sellingPrice: nextSellingPrice,
          discountPercent: nextDiscountPercent,
        }));
      }
      return;
    }

    if (pricingInputMode === "sellingPrice") {
      const sellingPriceValue = toNumber(subscriptionForm.sellingPrice);
      if (sellingPriceValue === undefined || baseCatalogAmount <= 0) {
        if (subscriptionForm.discountPercent !== "") {
          setSubscriptionForm((current) => ({ ...current, discountPercent: "" }));
        }
        return;
      }

      const normalizedSellingPrice = Math.min(baseCatalogAmount, Math.max(0, sellingPriceValue));
      const discountPercent =
        baseCatalogAmount <= 0 ? 0 : ((baseCatalogAmount - normalizedSellingPrice) / baseCatalogAmount) * 100;
      const nextSellingPrice = formatDecimalInput(normalizedSellingPrice);
      const nextDiscountPercent = formatDecimalInput(discountPercent);
      if (subscriptionForm.sellingPrice !== nextSellingPrice || subscriptionForm.discountPercent !== nextDiscountPercent) {
        setSubscriptionForm((current) => ({
          ...current,
          sellingPrice: nextSellingPrice,
          discountPercent: nextDiscountPercent,
        }));
      }
    }
  }, [baseCatalogAmount, pricingInputMode, subscriptionForm.discountPercent, subscriptionForm.sellingPrice]);

  const pricingPreview = useMemo(() => {
    const baseAmount = baseCatalogAmount;
    const discountPercentInput = toNumber(subscriptionForm.discountPercent);
    const sellingPriceInput = toNumber(subscriptionForm.sellingPrice);
    const resolvedDiscountPercent =
      discountPercentInput === undefined
        ? undefined
        : Math.min(100, Math.max(0, Number(discountPercentInput.toFixed(2))));
    const netSaleAmount =
      resolvedDiscountPercent !== undefined
        ? Number((baseAmount * (1 - resolvedDiscountPercent / 100)).toFixed(2))
        : sellingPriceInput === undefined
          ? baseAmount
          : Math.min(baseAmount, Math.max(0, Number(sellingPriceInput.toFixed(2))));
    const discountAmount = Math.max(0, Number((baseAmount - netSaleAmount).toFixed(2)));
    const effectiveDiscountPercent =
      baseAmount > 0 ? Number(((discountAmount / baseAmount) * 100).toFixed(2)) : 0;
    const gstAmount = Number(((netSaleAmount * (billingSettings.gstPercentage || 0)) / 100).toFixed(2));
    const totalPayable = Number((netSaleAmount + gstAmount).toFixed(2));
    const receivedAmount = Math.max(0, Math.min(totalPayable, toNumber(subscriptionForm.receivedAmount) || 0));
    const balanceAmount = Number((totalPayable - receivedAmount).toFixed(2));

    let paymentStatus = "UNPAID";
    if (receivedAmount > 0 && balanceAmount > 0) {
      paymentStatus = "PARTIALLY_PAID";
    } else if (receivedAmount > 0 && balanceAmount === 0) {
      paymentStatus = "PAID";
    }

    const startDate = subscriptionForm.startDate || new Date().toISOString().slice(0, 10);
    const endDate = selectedPrimaryVariant
      ? new Date(new Date(`${startDate}T00:00:00`).getTime() + selectedPrimaryVariant.validityDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : "";

    return {
      baseAmount,
      sellingPrice: netSaleAmount,
      discountPercent: effectiveDiscountPercent,
      discountAmount,
      netSaleAmount,
      gstPercentage: billingSettings.gstPercentage || 0,
      gstAmount,
      totalPayable,
      receivedAmount,
      balanceAmount,
      paymentStatus,
      startDate,
      endDate,
    };
  }, [baseCatalogAmount, billingSettings.gstPercentage, subscriptionForm.discountPercent, subscriptionForm.receivedAmount, subscriptionForm.sellingPrice, subscriptionForm.startDate, selectedPrimaryVariant]);

  useEffect(() => {
    if (!token || !memberForm.defaultBranchId) {
      setBranchCoaches([]);
      setBranchMembers([]);
      return;
    }

    let active = true;
    (async () => {
      try {
        const [coaches, members] = await Promise.all([
          usersService.searchUsers(token, {
            role: "COACH",
            active: true,
            employmentType: "INTERNAL",
            defaultBranchId: memberForm.defaultBranchId,
          }),
          usersService.searchUsers(token, {
            role: "MEMBER",
            defaultBranchId: memberForm.defaultBranchId,
          }),
        ]);

        if (!active) {
          return;
        }

        setBranchCoaches(
          coaches
            .filter((coach) => coach.active !== false)
            .sort((left, right) => left.name.localeCompare(right.name)),
        );
        setBranchMembers(members);
      } catch {
        if (!active) {
          return;
        }
        setBranchCoaches([]);
        setBranchMembers([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [memberForm.defaultBranchId, token]);

  useEffect(() => {
    if (!isFlagshipVariant(selectedPrimaryVariant)) {
      setAssignedTrainer(null);
      return;
    }

    if (branchCoaches.length === 0) {
      setAssignedTrainer(null);
      return;
    }

    const assignmentCount = new Map<string, number>();
    branchMembers.forEach((member) => {
      if (!member.defaultTrainerStaffId) {
        return;
      }
      assignmentCount.set(member.defaultTrainerStaffId, (assignmentCount.get(member.defaultTrainerStaffId) || 0) + 1);
    });

    const nextTrainer = branchCoaches
      .slice()
      .sort((left, right) => {
        const leftCount = assignmentCount.get(left.id) || 0;
        const rightCount = assignmentCount.get(right.id) || 0;
        if (leftCount !== rightCount) {
          return leftCount - rightCount;
        }
        return left.name.localeCompare(right.name);
      })[0];

    setAssignedTrainer(nextTrainer || null);
  }, [branchCoaches, branchMembers, selectedPrimaryVariant]);

  const customEntitlements = useMemo(() => {
    const items: Array<Record<string, unknown>> = [];

    if (complementaries.steam.enabled) {
      items.push({
        feature: "STEAM_ACCESS",
        includedCount: Number(complementaries.steam.count || 0),
        recurrence: complementaries.steam.recurrence,
      });
    }
    if (complementaries.iceBath.enabled) {
      items.push({
        feature: "ICE_BATH_ACCESS",
        includedCount: Number(complementaries.iceBath.count || 0),
        recurrence: complementaries.iceBath.recurrence,
      });
    }
    if (complementaries.nutritionCounseling.enabled) {
      items.push({
        feature: "NUTRITION_COUNSELING",
        includedCount: Number(complementaries.nutritionCounseling.count || 0),
        recurrence: complementaries.nutritionCounseling.recurrence,
      });
    }
    if (complementaries.physiotherapyCounseling.enabled) {
      items.push({
        feature: "PHYSIOTHERAPY_COUNSELING",
        includedCount: Number(complementaries.physiotherapyCounseling.count || 0),
        recurrence: complementaries.physiotherapyCounseling.recurrence,
      });
    }
    if (complementaries.passBenefit.enabled) {
      items.push({
        feature: "PASS_BENEFIT",
        includedCount: Number(complementaries.passBenefit.days || 0),
        recurrence: "FULL_TERM",
      });
    }

    return items.filter((item) => Number(item.includedCount || 0) > 0);
  }, [complementaries]);

  const stepItems = useMemo(
    () => [
      { step: 1 as OnboardingStep, label: "Member Info" },
      { step: 2 as OnboardingStep, label: "Subscription" },
      { step: 3 as OnboardingStep, label: "Payment & Billing" },
    ],
    [],
  );

  const validateStep = (step: OnboardingStep): boolean => {
    if (step === 1) {
      if (!memberForm.fullName.trim()) {
        setToast({ kind: "error", message: "Member full name is required." });
        return false;
      }
      if (memberForm.mobileNumber.trim().length !== 10) {
        setToast({ kind: "error", message: "Enter a valid 10-digit mobile number." });
        return false;
      }
      if (!memberForm.password.trim()) {
        setToast({ kind: "error", message: "A login password is required." });
        return false;
      }
    }

    if (step === 2) {
      if (!selectedPrimaryVariant) {
        setToast({ kind: "error", message: "Select a primary subscription variant." });
        return false;
      }
      if (!subscriptionForm.startDate) {
        setToast({ kind: "error", message: "Subscription start date is required." });
        return false;
      }
    }

    if (step === 3) {
      const receivedAmount = toNumber(subscriptionForm.receivedAmount);
      const allowedMax = Number(pricingPreview.totalPayable.toFixed(2));
      if (receivedAmount === undefined || receivedAmount <= 0) {
        setToast({ kind: "error", message: "Received amount is required to complete onboarding." });
        return false;
      }
      if (receivedAmount - allowedMax > 0.009) {
        setToast({ kind: "error", message: "Received amount cannot exceed the total payable amount." });
        return false;
      }
      if (!subscriptionForm.paymentMode) {
        setToast({ kind: "error", message: "Payment mode is required." });
        return false;
      }
    }

    return true;
  };

  const moveToStep = (step: OnboardingStep) => {
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onNextStep = () => {
    if (!validateStep(currentStep)) {
      return;
    }

    if (currentStep < 3) {
      moveToStep((currentStep + 1) as OnboardingStep);
    }
  };

  const onPreviousStep = () => {
    if (currentStep > 1) {
      moveToStep((currentStep - 1) as OnboardingStep);
    }
  };

  const findRecoverableMember = async (): Promise<UserDirectoryItem | null> => {
    if (!token) {
      return null;
    }

    const matches = await usersService.searchUsers(token, {
      role: "MEMBER",
      query: memberForm.mobileNumber.trim(),
      ...(memberForm.defaultBranchId ? { defaultBranchId: memberForm.defaultBranchId } : {}),
    });

    const exactMobileMatches = matches.filter(
      (item) => item.mobile === memberForm.mobileNumber.trim(),
    );

    return (
      exactMobileMatches.find((item) => item.sourceInquiryId === String(sourceInquiryId)) ||
      exactMobileMatches.find((item) => item.name.trim().toLowerCase() === memberForm.fullName.trim().toLowerCase()) ||
      exactMobileMatches[0] ||
      null
    );
  };

  const completeOnboarding = async () => {
    if (completedOnboarding) {
      return;
    }

    if (!validateStep(3)) {
      return;
    }

    if (!token || !canCreateMember || !canConvertInquiry) {
      setToast({ kind: "error", message: "You do not have permission to complete inquiry onboarding." });
      return;
    }

    if (!selectedPrimaryVariant) {
      setToast({ kind: "error", message: "Select a primary subscription variant." });
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const billedByStaffId = resolveStaffId(user);
      let memberRecord = await findRecoverableMember();
      const resumedExistingMember = Boolean(memberRecord);

      const registerPayload: RegisterUserRequest = {
        fullName: memberForm.fullName.trim(),
        mobileNumber: memberForm.mobileNumber.trim(),
        password: memberForm.password,
        role: "MEMBER",
        email: toOptionalString(memberForm.email),
        sourceInquiryId,
        defaultBranchId: toOptionalString(memberForm.defaultBranchId),
        employmentType: "INTERNAL" as EmploymentType,
        designation: "MEMBER",
        dataScope: "ASSIGNED_ONLY",
        active: true,
        alternateMobileNumber: toOptionalString(memberForm.alternateMobileNumber),
        dateOfBirth: toOptionalString(memberForm.dateOfBirth),
        gender: toOptionalString(memberForm.gender),
        address: toOptionalString(memberForm.address),
        emergencyContactName: toOptionalString(memberForm.emergencyContactName),
        emergencyContactPhone: toOptionalString(memberForm.emergencyContactPhone),
        emergencyContactRelation: toOptionalString(memberForm.emergencyContactRelation),
        defaultTrainerStaffId: isFlagshipVariant(selectedPrimaryVariant) && assignedTrainer ? assignedTrainer.id : undefined,
      };

      if (!memberRecord) {
        memberRecord = await usersService.registerUser(token, registerPayload);
      }

      const memberId = resolveMemberId(memberRecord);
      if (memberId === null) {
        throw new Error("Member created but numeric member ID is missing.");
      }

      const [existingInvoices, existingSubscriptions] = await Promise.all([
        subscriptionService.getInvoicesByMember(token, String(memberId)),
        subscriptionService.getSubscriptionRegister(token, { memberId: String(memberId) }),
      ]);

      if ((existingInvoices.length > 0 || existingSubscriptions.length > 0) && resumedExistingMember) {
        throw new Error(
          "A partial onboarding already exists for this member. Open the member profile or billing register to continue from the existing record.",
        );
      }

      const subscriptionResponse = await subscriptionService.createMemberSubscription(token, String(memberId), {
        productVariantId: Number(selectedPrimaryVariant.variantId),
        startDate: subscriptionForm.startDate,
        inquiryId: sourceInquiryId,
        addOnVariantIds: subscriptionForm.addOnVariantId ? [Number(subscriptionForm.addOnVariantId)] : undefined,
        discountPercent: pricingPreview.discountPercent > 0 ? pricingPreview.discountPercent : undefined,
        discountedByStaffId: billedByStaffId ?? undefined,
        billedByStaffId: billedByStaffId ?? undefined,
        customEntitlements: customEntitlements.length > 0 ? customEntitlements : undefined,
      });

      const invoiceId = Number(subscriptionResponse.invoiceId);
      const memberSubscriptionId = Number(subscriptionResponse.memberSubscriptionId);
      const invoiceTotal = Number(subscriptionResponse.invoiceTotal);

      if (!Number.isFinite(invoiceId) || !Number.isFinite(memberSubscriptionId) || !Number.isFinite(invoiceTotal)) {
        throw new Error("Subscription created but invoice details are incomplete.");
      }

      let paymentReceipt: Awaited<ReturnType<typeof subscriptionService.recordPayment>> | null = null;
      if (pricingPreview.receivedAmount > 0) {
        paymentReceipt = await subscriptionService.recordPayment(token, invoiceId, {
          memberId,
          amount: pricingPreview.receivedAmount,
          paymentMode: subscriptionForm.paymentMode,
          inquiryId: sourceInquiryId,
        });

        await subscriptionService.activateMembership(token, memberSubscriptionId);
      }

      await subscriptionService.convertInquiry(token, String(sourceInquiryId), { memberId });

      setCompletedOnboarding({
        memberId,
        memberSubscriptionId,
        invoiceId,
        invoiceNumber: subscriptionResponse.invoiceNumber,
        invoiceStatus: paymentReceipt?.paymentStatus || subscriptionResponse.invoiceStatus,
        receiptId: paymentReceipt?.receiptId,
        receiptNumber: paymentReceipt?.receiptNumber,
        paymentStatus: paymentReceipt?.paymentStatus || subscriptionResponse.invoiceStatus,
        paymentMode: paymentReceipt?.paymentMode || subscriptionForm.paymentMode,
        totalPaidAmount: paymentReceipt?.totalPaidAmount || subscriptionResponse.totalPaidAmount || 0,
        balanceAmount: paymentReceipt?.balanceAmount ?? subscriptionResponse.balanceAmount ?? invoiceTotal,
      });

      setToast({
        kind: "success",
        message:
          pricingPreview.receivedAmount > 0
            ? resumedExistingMember
              ? "Recovered the existing member record, invoiced it, and recorded payment."
              : "Member created, invoiced, and payment recorded."
            : resumedExistingMember
              ? "Recovered the existing member record and generated the invoice. No payment received yet, so access remains pending."
              : "Member created and invoiced. No payment received yet, so access remains pending.",
      });
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.message.toLowerCase().includes("mobile number already exists")) {
        try {
          const memberRecord = await findRecoverableMember();
          if (memberRecord) {
            setError(
              `A member record already exists for this enquiry (${memberRecord.name}). Please retry once more to resume the onboarding from that member record.`,
            );
            setToast({
              kind: "info",
              message: "We found an existing member record from the earlier attempt. Retry once to continue from that saved member.",
            });
            return;
          }
        } catch {
          // fall through to the generic message below if the recovery lookup fails
        }
      }
      const message = submitError instanceof ApiError ? submitError.message : submitError instanceof Error ? submitError.message : "Unable to complete guided onboarding.";
      setError(message);
      setToast({ kind: "error", message });
    } finally {
      setSubmitting(false);
    }
  };

  const generatedInvoiceNumber = completedOnboarding?.invoiceNumber || "Generated on completion";
  const generatedReceiptNumber =
    completedOnboarding?.receiptNumber || (completedOnboarding ? "No receipt generated" : "Generated after payment");
  const enquiryCodeLabel = inquiry
    ? formatInquiryCode(inquiry.inquiryId, { branchCode: inquiry.branchCode, createdAt: inquiry.createdAt || inquiry.inquiryAt })
    : "Pending";
  const memberCodePreview = inquiry
    ? formatMemberCode(inquiry.inquiryId, { branchCode: inquiry.branchCode, createdAt: inquiry.createdAt || inquiry.inquiryAt })
    : "Generated after conversion";
  const selectedFamilyLabel = productFamilyLabel(selectedPrimaryVariant?.categoryCode || selectedPrimaryProduct?.categoryCode);
  const trainerAssistLabel = !selectedPrimaryVariant
    ? "Pick a plan to evaluate trainer assignment."
    : !isFlagshipVariant(selectedPrimaryVariant)
      ? "Trainer assignment is not required for this plan family."
      : assignedTrainer
        ? `Auto-assigned to ${assignedTrainer.name}`
        : "No active internal coach available for this branch.";

  return (
    <div className="space-y-5">
      {toast ? <ToastBanner kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}

      <SectionCard
        title="Guided Member Onboarding"
        subtitle="Convert the enquiry into a fully billed member in one guided flow."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/portal/inquiries"
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
            >
              Back to Inquiries
            </Link>
          </div>
        }
      >
        {!canCreateMember || !canConvertInquiry ? (
          <p className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Your designation does not have permission to complete this onboarding flow.
          </p>
        ) : loading ? (
          <p className="text-sm text-slate-300">Loading inquiry and catalog details...</p>
        ) : (
          <div className="space-y-6">
            <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(196,36,41,0.18),rgba(15,18,25,0.92))] p-6">
              <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-[#c42924]/30 bg-[#c42924]/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ffd6d4]">
                      Enquiry Conversion
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-300">
                      {selectedFamilyLabel}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold text-white">
                      {inquiry ? `${inquiry.fullName || "Prospect"} to member onboarding` : "Member onboarding"}
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm text-slate-300">
                      We are carrying the enquiry into membership, package billing, and payment capture in one guided path.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "Enquiry Code", value: enquiryCodeLabel, icon: <Layers3 className="h-4 w-4" /> },
                      { label: "Future Member Code", value: memberCodePreview, icon: <UserRound className="h-4 w-4" /> },
                      { label: "Branch", value: memberForm.defaultBranchId ? `Branch #${memberForm.defaultBranchId}` : "Current branch", icon: <ShieldCheck className="h-4 w-4" /> },
                      { label: "Primary Contact", value: inquiry?.mobileNumber || memberForm.mobileNumber || "-", icon: <Phone className="h-4 w-4" /> },
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center gap-2 text-[#ffd6d4]">{item.icon}</div>
                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[480px]">
                  {stepItems.map((item) => {
                    const active = currentStep === item.step;
                    const completed = currentStep > item.step;
                    return (
                      <div
                        key={item.step}
                        className={`rounded-2xl border p-4 transition ${active ? "border-[#c42924]/50 bg-[#1c1114]" : completed ? "border-emerald-400/20 bg-emerald-400/10" : "border-white/10 bg-white/[0.04]"}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${active ? "border-[#c42924]/50 bg-[#c42924]/15 text-[#ffd6d4]" : completed ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>
                            {completed ? <CheckCircle2 className="h-4 w-4" /> : item.step}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusBadgeClass(active)}`}>
                            {completed ? "Done" : active ? "Current" : "Pending"}
                          </span>
                        </div>
                        <p className="mt-4 text-sm font-semibold text-white">{item.label}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {item.step === 1
                            ? "Member identity and contact essentials."
                            : item.step === 2
                              ? "Choose plan family, pricing, and benefits."
                              : "Collect payment and complete the conversion."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
              <div className="space-y-6">
                {currentStep === 1 ? (
                  <SectionCard title="Step 1 · Member Info" subtitle="Turn the enquiry into a complete member profile before we touch subscription or billing.">
                    <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
                      <div className="rounded-[24px] border border-white/10 bg-[#161d28] p-5">
                        <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#25161a_0%,#151a24_100%)] text-3xl font-bold text-white">
                          {initials(memberForm.fullName || inquiry?.fullName || "M")}
                        </div>
                        <div className="mt-4 text-center">
                          <p className="text-sm font-semibold text-white">{memberForm.fullName || "Member preview"}</p>
                          <p className="mt-1 text-xs text-slate-400">Photo can be added from the member profile after onboarding.</p>
                        </div>
                        <div className="mt-5 space-y-3 rounded-2xl border border-white/8 bg-black/10 p-4">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Source</p>
                            <p className="mt-1 text-sm text-white">{inquiry?.promotionSource || "Walk-in"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Assigned To</p>
                            <p className="mt-1 text-sm text-white">
                              {inquiry?.assignedToStaffId
                                ? `Staff #${inquiry.assignedToStaffId}`
                                : inquiry?.clientRepStaffId
                                  ? `Staff #${inquiry.clientRepStaffId}`
                                  : user?.name || "-"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Enquiry Date</p>
                            <p className="mt-1 text-sm text-white">{inquiry?.inquiryAt || new Date().toISOString().slice(0, 10)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <UserRound className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Personal Identity</h4>
                              <p className="text-xs text-slate-400">Core member details carried from the enquiry.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Full Name</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.fullName}
                                onChange={(event) => setMemberForm((current) => ({ ...current, fullName: event.target.value }))}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Date of Birth</span>
                              <input
                                type="date"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.dateOfBirth}
                                onChange={(event) => setMemberForm((current) => ({ ...current, dateOfBirth: event.target.value }))}
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Gender</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.gender}
                                onChange={(event) => setMemberForm((current) => ({ ...current, gender: event.target.value }))}
                                placeholder="Optional"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Member Code</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-slate-300 outline-none"
                                value={memberCodePreview}
                                disabled
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <Phone className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Contact & Access</h4>
                              <p className="text-xs text-slate-400">Primary login credentials and communication details.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Mobile Number</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.mobileNumber}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    mobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                    password: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                                minLength={10}
                                maxLength={10}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Password</span>
                              <input
                                type="password"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={memberForm.password}
                                onChange={(event) => setMemberForm((current) => ({ ...current, password: event.target.value }))}
                                required
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Email</span>
                              <input
                                type="email"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.email}
                                onChange={(event) => setMemberForm((current) => ({ ...current, email: event.target.value }))}
                                placeholder="Optional"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Alternate Mobile</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.alternateMobileNumber}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    alternateMobileNumber: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                                placeholder="Optional"
                              />
                            </label>
                            <label className="space-y-2 md:col-span-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Address</span>
                              <textarea
                                className="min-h-[104px] w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.address}
                                onChange={(event) => setMemberForm((current) => ({ ...current, address: event.target.value }))}
                                placeholder="Home address or locality"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <ShieldCheck className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Emergency Contact</h4>
                              <p className="text-xs text-slate-400">Who we should reach in case of an urgent issue.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Contact Name</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactName}
                                onChange={(event) => setMemberForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Phone</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactPhone}
                                onChange={(event) =>
                                  setMemberForm((current) => ({
                                    ...current,
                                    emergencyContactPhone: event.target.value.replace(/[^0-9]/g, "").slice(0, 10),
                                  }))
                                }
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Relation</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={memberForm.emergencyContactRelation}
                                onChange={(event) => setMemberForm((current) => ({ ...current, emergencyContactRelation: event.target.value }))}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {currentStep === 2 ? (
                  <div className="space-y-6">
                    <SectionCard title="Step 2 · Subscription Details" subtitle="Pick the membership package, tune the commercials, and review the bundled benefits.">
                      <div className="space-y-6">
                        <div>
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-white">Choose Primary Plan</h4>
                              <p className="text-xs text-slate-400">Guide the operator through category, product, and then variant so the catalog stays easy to scan.</p>
                            </div>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Start Date</span>
                              <input
                                type="date"
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={subscriptionForm.startDate}
                                onChange={(event) => setSubscriptionForm((current) => ({ ...current, startDate: event.target.value }))}
                                required
                              />
                            </label>
                          </div>
                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="grid gap-4 lg:grid-cols-3">
                              <label className="space-y-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Product Category</span>
                                <select
                                  className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                  value={primaryCategoryFilter}
                                  onChange={(event) => {
                                    setPrimaryCategoryFilter(event.target.value);
                                    setPrimaryProductFilter("");
                                    setPricingInputMode(null);
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: "",
                                      sellingPrice: "",
                                      discountPercent: "",
                                    }));
                                  }}
                                >
                                  {primaryCategoryOptions.map((categoryCode) => (
                                    <option key={categoryCode} value={categoryCode}>
                                      {productFamilyLabel(categoryCode)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Product</span>
                                <select
                                  className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                  value={primaryProductFilter}
                                  onChange={(event) => {
                                    setPrimaryProductFilter(event.target.value);
                                    setPricingInputMode(null);
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: "",
                                      sellingPrice: "",
                                      discountPercent: "",
                                    }));
                                  }}
                                >
                                  {filteredPrimaryProducts.map((product) => (
                                    <option key={product.productCode} value={product.productCode}>
                                      {product.productName}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Selection</p>
                                <p className="mt-2 text-sm font-semibold text-white">
                                  {selectedPrimaryProduct?.productName || "Choose a product"}
                                </p>
                                <p className="mt-1 text-xs text-slate-400">
                                  {selectedPrimaryVariant
                                    ? `${selectedPrimaryVariant.variantName} · ${selectedPrimaryVariant.validityDays} days validity`
                                    : "Pick a variant below to load pricing and benefits."}
                                </p>
                              </div>
                            </div>

                            <div className="mt-5 grid gap-4 lg:grid-cols-2">
                              {filteredPrimaryVariants.length === 0 ? (
                                <div className="rounded-[24px] border border-dashed border-white/12 bg-[#101722] p-5 text-sm text-slate-400 lg:col-span-2">
                                  No variants are configured for this product yet.
                                </div>
                              ) : null}
                              {filteredPrimaryVariants.map((variant) => {
                              const active = subscriptionForm.productVariantId === variant.variantId;
                              const variantProduct = products.find((product) => product.productCode === variant.productCode);
                              const features = splitFeatures(variant.includedFeatures).slice(0, 4);
                              return (
                                <button
                                  key={variant.variantId}
                                  type="button"
                                  onClick={() => {
                                    setPricingInputMode(null);
                                    setPrimaryCategoryFilter(variant.categoryCode);
                                    setPrimaryProductFilter(variant.productCode);
                                    setSubscriptionForm((current) => ({
                                      ...current,
                                      productVariantId: variant.variantId,
                                      sellingPrice: "",
                                      discountPercent: "",
                                    }));
                                  }}
                                  className={`rounded-[24px] border p-5 text-left transition ${active ? "border-[#c42924]/50 bg-[#1b1114] shadow-[0_20px_60px_rgba(196,36,41,0.12)]" : "border-white/10 bg-[#151b26] hover:border-white/20 hover:bg-[#18202c]"}`}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                                        {productFamilyLabel(variant.categoryCode)}
                                      </p>
                                      <h5 className="mt-2 text-lg font-semibold text-white">{variant.variantName}</h5>
                                      <p className="mt-1 text-sm text-slate-400">{variantProduct?.productName || variant.productCode}</p>
                                    </div>
                                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusBadgeClass(active)}`}>
                                      {active ? "Selected" : `${variant.durationMonths}M`}
                                    </span>
                                  </div>
                                  <div className="mt-5 flex items-end justify-between gap-3">
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Base Price</p>
                                      <p className="mt-1 text-2xl font-semibold text-white">{formatCurrency(variant.basePrice)}</p>
                                    </div>
                                    <div className="text-right text-xs text-slate-400">
                                      <p>{variant.validityDays} days validity</p>
                                      <p>{variant.passBenefitDays} pass benefit days</p>
                                    </div>
                                  </div>
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {features.map((feature) => (
                                      <span key={feature} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                                        {featurePillLabel(feature)}
                                      </span>
                                    ))}
                                  </div>
                                </button>
                              );
                            })}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <Sparkles className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Pricing & Commercials</h4>
                              <p className="text-xs text-slate-400">Selling price and discount percent stay in sync automatically.</p>
                            </div>
                          </div>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Selling Price</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={subscriptionForm.sellingPrice}
                                onChange={(event) => {
                                  setPricingInputMode("sellingPrice");
                                  setSubscriptionForm((current) => ({
                                    ...current,
                                    sellingPrice: sanitizeNumericString(event.target.value),
                                  }));
                                }}
                                placeholder="Leave blank to use plan amount"
                              />
                            </label>
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Discount Percent</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={subscriptionForm.discountPercent}
                                onChange={(event) => {
                                  setPricingInputMode("discountPercent");
                                  setSubscriptionForm((current) => ({
                                    ...current,
                                    discountPercent: sanitizeNumericString(event.target.value),
                                  }));
                                }}
                                placeholder="Leave blank for no discount"
                              />
                            </label>
                          </div>

                          {addOnVariants.length > 0 ? (
                            <div className="mt-5">
                              <div className="grid gap-4 lg:grid-cols-3">
                                <label className="space-y-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Add-on Category</span>
                                  <select
                                    className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                    value={addOnCategoryFilter}
                                    onChange={(event) => {
                                      setAddOnCategoryFilter(event.target.value);
                                      setAddOnProductFilter("");
                                      setSubscriptionForm((current) => ({ ...current, addOnVariantId: "" }));
                                    }}
                                  >
                                    {addOnCategoryOptions.map((categoryCode) => (
                                      <option key={categoryCode} value={categoryCode}>
                                        {productFamilyLabel(categoryCode)}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="space-y-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Add-on Product</span>
                                  <select
                                    className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                    value={addOnProductFilter}
                                    onChange={(event) => {
                                      setAddOnProductFilter(event.target.value);
                                      setSubscriptionForm((current) => ({ ...current, addOnVariantId: "" }));
                                    }}
                                  >
                                    {filteredAddOnProducts.map((product) => (
                                      <option key={product.productCode} value={product.productCode}>
                                        {product.productName}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Add-on Summary</p>
                                  <p className="mt-2 text-sm font-semibold text-white">
                                    {selectedAddOnVariants[0]?.variantName || "No add-on selected"}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {selectedAddOnVariants[0]
                                      ? `${selectedAddOnVariants[0].includedPtSessions} PT sessions · ${formatCurrency(selectedAddOnVariants[0].basePrice)}`
                                      : "Choose a PT add-on only when the member actually needs one."}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() => setSubscriptionForm((current) => ({ ...current, addOnVariantId: "" }))}
                                  className={`rounded-2xl border p-4 text-left transition ${subscriptionForm.addOnVariantId === "" ? "border-[#c42924]/50 bg-[#1b1114]" : "border-white/10 bg-[#111821] hover:border-white/20"}`}
                                >
                                  <p className="text-sm font-semibold text-white">No PT Add-on</p>
                                  <p className="mt-1 text-xs text-slate-400">Keep this member on the primary package only.</p>
                                </button>
                                {filteredAddOnVariants.map((variant) => {
                                  const active = subscriptionForm.addOnVariantId === variant.variantId;
                                  return (
                                    <button
                                      key={variant.variantId}
                                      type="button"
                                      onClick={() => {
                                        setAddOnCategoryFilter(variant.categoryCode);
                                        setAddOnProductFilter(variant.productCode);
                                        setSubscriptionForm((current) => ({ ...current, addOnVariantId: variant.variantId }));
                                      }}
                                      className={`rounded-2xl border p-4 text-left transition ${active ? "border-[#c42924]/50 bg-[#1b1114]" : "border-white/10 bg-[#111821] hover:border-white/20"}`}
                                    >
                                      <p className="text-sm font-semibold text-white">{variant.variantName}</p>
                                      <p className="mt-1 text-xs text-slate-400">{formatCurrency(variant.basePrice)} · {variant.includedPtSessions} PT sessions</p>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="mb-4 flex items-center gap-3">
                              <Layers3 className="h-5 w-5 text-[#ffb4b1]" />
                              <div>
                                <h4 className="text-sm font-semibold text-white">Complementary Benefits</h4>
                                <p className="text-xs text-slate-400">Bundle additional benefits that should travel with this subscription.</p>
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              {([
                                ["steam", "Steam Access"],
                                ["iceBath", "Ice Bath Access"],
                                ["nutritionCounseling", "Nutrition Counseling"],
                                ["physiotherapyCounseling", "Physiotherapy Counseling"],
                              ] as const).map(([key, label]) => {
                                const item = complementaries[key];
                                return (
                                  <div key={key} className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                                    <label className="flex items-center gap-3 text-sm font-semibold text-white">
                                      <input
                                        type="checkbox"
                                        checked={item.enabled}
                                        onChange={(event) =>
                                          setComplementaries((current) => ({
                                            ...current,
                                            [key]: { ...current[key], enabled: event.target.checked },
                                          }))
                                        }
                                      />
                                      {label}
                                    </label>
                                    {item.enabled ? (
                                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        <input
                                          className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                          value={item.count}
                                          onChange={(event) =>
                                            setComplementaries((current) => ({
                                              ...current,
                                              [key]: { ...current[key], count: event.target.value.replace(/[^0-9]/g, "") },
                                            }))
                                          }
                                          placeholder="Count"
                                        />
                                        <select
                                          className="rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                          value={item.recurrence}
                                          onChange={(event) =>
                                            setComplementaries((current) => ({
                                              ...current,
                                              [key]: { ...current[key], recurrence: event.target.value },
                                            }))
                                          }
                                        >
                                          {RECURRENCE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                              <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                                <label className="flex items-center gap-3 text-sm font-semibold text-white">
                                  <input
                                    type="checkbox"
                                    checked={complementaries.passBenefit.enabled}
                                    onChange={(event) =>
                                      setComplementaries((current) => ({
                                        ...current,
                                        passBenefit: { ...current.passBenefit, enabled: event.target.checked },
                                      }))
                                    }
                                  />
                                  Pass Benefit
                                </label>
                                {complementaries.passBenefit.enabled ? (
                                  <div className="mt-3">
                                    <input
                                      className="w-full rounded-2xl border border-white/10 bg-[#111925] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                      value={complementaries.passBenefit.days}
                                      onChange={(event) =>
                                        setComplementaries((current) => ({
                                          ...current,
                                          passBenefit: { ...current.passBenefit, days: event.target.value.replace(/[^0-9]/g, "") },
                                        }))
                                      }
                                      placeholder="Benefit days"
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                            <div className="mb-4 flex items-center gap-3">
                              <ShieldCheck className="h-5 w-5 text-[#ffb4b1]" />
                              <div>
                                <h4 className="text-sm font-semibold text-white">Trainer Assignment</h4>
                                <p className="text-xs text-slate-400">Auto-assignment is now limited to flagship subscriptions only.</p>
                              </div>
                            </div>
                            {!selectedPrimaryVariant ? (
                              <p className="rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-4 text-sm text-slate-300">
                                Choose a primary plan to evaluate trainer assignment.
                              </p>
                            ) : !isFlagshipVariant(selectedPrimaryVariant) ? (
                              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                                <p className="text-sm font-semibold text-cyan-100">Trainer not required</p>
                                <p className="mt-2 text-sm text-cyan-50/80">
                                  {selectedFamilyLabel} plans do not need a default trainer assignment at onboarding.
                                </p>
                              </div>
                            ) : !assignedTrainer ? (
                              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                                <p className="text-sm font-semibold text-amber-100">Coach assignment pending</p>
                                <p className="mt-2 text-sm text-amber-50/80">No active internal coach is currently available in this branch.</p>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                                <p className="text-sm font-semibold text-emerald-100">{assignedTrainer.name}</p>
                                <p className="mt-1 text-sm text-emerald-50/80">{assignedTrainer.designation || "COACH"} · {assignedTrainer.mobile}</p>
                                <p className="mt-3 text-xs text-emerald-100/70">
                                  Assigned automatically from the lightest active coach allocation in the selected branch.
                                </p>
                              </div>
                            )}

                            <div className="mt-5 rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Assignment rule</p>
                              <p className="mt-2 text-sm text-slate-300">{trainerAssistLabel}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  </div>
                ) : null}

                {currentStep === 3 ? (
                  <SectionCard title="Step 3 · Payment, Invoice, and Receipt" subtitle="Collect payment with a clear invoice-style checkout before completing the conversion.">
                    <div className="space-y-5">
                      {completedOnboarding ? (
                        <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                          <p className="font-semibold">Onboarding completed</p>
                          <p className="mt-2">
                            Invoice <span className="font-semibold">{completedOnboarding.invoiceNumber}</span>
                            {completedOnboarding.receiptNumber ? (
                              <>
                                {" "}and receipt <span className="font-semibold">{completedOnboarding.receiptNumber}</span>
                              </>
                            ) : (
                              " created without a receipt because no payment was collected."
                            )}
                          </p>
                        </div>
                      ) : null}

                      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <CreditCard className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Invoice Summary</h4>
                              <p className="text-xs text-slate-400">Review the package pricing, GST, and total payable before we issue the invoice.</p>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Billing Context</p>
                              <dl className="mt-3 space-y-2 text-sm text-slate-300">
                                <div className="flex items-center justify-between gap-3"><dt>Invoice Number</dt><dd className="font-semibold text-white">{generatedInvoiceNumber}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Invoice Date</dt><dd>{new Date().toLocaleDateString("en-IN")}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Start Date</dt><dd>{pricingPreview.startDate || "-"}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>End Date</dt><dd>{pricingPreview.endDate || "-"}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Bill Rep</dt><dd>{user?.name || "-"}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Invoice Status</dt><dd>{formatInvoiceLifecycleStatus(completedOnboarding?.invoiceStatus, Boolean(completedOnboarding))}</dd></div>
                              </dl>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Commercial Breakdown</p>
                              <dl className="mt-3 space-y-2 text-sm text-slate-300">
                                <div className="flex items-center justify-between gap-3"><dt>Plan Price</dt><dd>{formatCurrency(pricingPreview.baseAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Selling Price</dt><dd>{formatCurrency(pricingPreview.sellingPrice)}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Discount Percent</dt><dd>{pricingPreview.discountPercent.toFixed(2)}%</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Discount Amount</dt><dd>{formatCurrency(pricingPreview.discountAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Net Sale Amount</dt><dd>{formatCurrency(pricingPreview.netSaleAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>GST @ {pricingPreview.gstPercentage}%</dt><dd>{formatCurrency(pricingPreview.gstAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-base font-semibold text-white"><dt>Total Payable</dt><dd>{formatCurrency(pricingPreview.totalPayable)}</dd></div>
                              </dl>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5">
                          <div className="mb-4 flex items-center gap-3">
                            <Wallet className="h-5 w-5 text-[#ffb4b1]" />
                            <div>
                              <h4 className="text-sm font-semibold text-white">Payment Collection</h4>
                              <p className="text-xs text-slate-400">Capture the amount now. Partial payment keeps the subscription active while the balance stays pending.</p>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Received Amount</span>
                              <input
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#c42924]/60"
                                value={subscriptionForm.receivedAmount}
                                onChange={(event) =>
                                  setSubscriptionForm((current) => ({
                                    ...current,
                                    receivedAmount: event.target.value.replace(/[^0-9.]/g, ""),
                                  }))
                                }
                                placeholder="Enter collected amount"
                                disabled={Boolean(completedOnboarding)}
                              />
                            </label>

                            <label className="space-y-2">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Payment Mode</span>
                              <select
                                className="w-full rounded-2xl border border-white/10 bg-[#0f141d] px-4 py-3 text-sm text-white outline-none transition focus:border-[#c42924]/60"
                                value={subscriptionForm.paymentMode}
                                onChange={(event) => setSubscriptionForm((current) => ({ ...current, paymentMode: event.target.value }))}
                                disabled={Boolean(completedOnboarding)}
                              >
                                {PAYMENT_MODE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <div className="rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Receipt Preview</p>
                              <dl className="mt-3 space-y-2 text-sm text-slate-300">
                                <div className="flex items-center justify-between gap-3"><dt>Receipt Number</dt><dd>{generatedReceiptNumber}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Receipt Date</dt><dd>{completedOnboarding ? new Date().toLocaleDateString("en-IN") : "Generated after payment"}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Payment Method</dt><dd>{completedOnboarding?.paymentMode || subscriptionForm.paymentMode || "-"}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Payment Status</dt><dd>{completedOnboarding ? formatPaymentCollectionStatus(completedOnboarding.totalPaidAmount, completedOnboarding.balanceAmount) : formatPaymentCollectionStatus(pricingPreview.receivedAmount, pricingPreview.balanceAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3"><dt>Total Paid</dt><dd>{formatCurrency(completedOnboarding?.totalPaidAmount || pricingPreview.receivedAmount)}</dd></div>
                                <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2 text-base font-semibold text-white"><dt>Balance Due</dt><dd>{formatCurrency(completedOnboarding?.balanceAmount ?? pricingPreview.balanceAmount)}</dd></div>
                              </dl>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[24px] border border-white/8 bg-[#161d28] p-5 text-sm text-slate-300">
                        <p className="font-semibold text-white">What happens on completion</p>
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {[
                            "Create the member profile",
                            "Create the subscription and issue the invoice",
                            "Record the received amount and generate the receipt",
                            "Activate the membership when payment is collected",
                            "Convert the enquiry into a member relationship",
                            "Open the member profile for final verification",
                          ].map((item) => (
                            <div key={item} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-[#0f141d] p-4">
                              <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-[#ffb4b1]" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}
              </div>

              <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
                <div className="rounded-[28px] border border-white/10 bg-[#141a25] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#c42924]/30 bg-[#c42924]/10 text-[#ffd6d4]">
                      <UserRound className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{memberForm.fullName || inquiry?.fullName || "Member preview"}</p>
                      <p className="text-xs text-slate-400">{memberForm.mobileNumber || inquiry?.mobileNumber || "Awaiting primary contact"}</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    <div className="rounded-2xl border border-white/8 bg-[#0f141d] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Current Step</p>
                      <p className="mt-2 text-lg font-semibold text-white">{stepItems.find((item) => item.step === currentStep)?.label}</p>
                      <p className="mt-2 text-sm text-slate-400">
                        {currentStep === 1
                          ? "Clean up member identity, contact, and emergency details."
                          : currentStep === 2
                            ? "Choose the plan, apply pricing, and confirm benefits."
                            : "Review the invoice, collect payment, and complete onboarding."}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      {[
                        { label: "Selected Plan", value: selectedPrimaryVariant?.variantName || "Not chosen" },
                        { label: "Plan Family", value: selectedFamilyLabel },
                        { label: "Default Trainer", value: selectedPrimaryVariant ? (isFlagshipVariant(selectedPrimaryVariant) ? assignedTrainer?.name || "Pending coach" : "Not required") : "Pending plan" },
                        { label: "Payment Status", value: formatPaymentCollectionStatus(pricingPreview.receivedAmount, pricingPreview.balanceAmount) },
                      ].map((item) => (
                        <div key={item.label} className="rounded-2xl border border-white/8 bg-[#0f141d] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                          <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#0f141d] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Financial Snapshot</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                        <div>
                          <p className="text-xs text-slate-400">Plan + Add-ons</p>
                          <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(pricingPreview.baseAmount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Total Payable</p>
                          <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(pricingPreview.totalPayable)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Collected Now</p>
                          <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(pricingPreview.receivedAmount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Balance Pending</p>
                          <p className="mt-1 text-lg font-semibold text-white">{formatCurrency(pricingPreview.balanceAmount)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-[#0f141d] p-4">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-[#ffb4b1]" />
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Milestones</p>
                      </div>
                      <div className="mt-4 space-y-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between gap-3">
                          <span>Subscription starts</span>
                          <span className="font-semibold text-white">{pricingPreview.startDate || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Subscription ends</span>
                          <span className="font-semibold text-white">{pricingPreview.endDate || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Invoice will be</span>
                          <span className="font-semibold text-white">{generatedInvoiceNumber}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={onPreviousStep}
                  disabled={Boolean(completedOnboarding)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                >
                  Back
                </button>
              ) : null}
              {completedOnboarding ? (
                <>
                  <button
                    type="button"
                    onClick={() => router.push(`/admin/members/${completedOnboarding.memberId}`)}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.08]"
                  >
                    Open Member Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/portal/billing")}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    Open Billing Register
                  </button>
                </>
              ) : currentStep < 3 ? (
                <button
                  type="button"
                  onClick={onNextStep}
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeOnboarding}
                  disabled={submitting}
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:bg-slate-400"
                >
                  {submitting ? "Completing Onboarding..." : "Complete Onboarding"}
                </button>
              )}
            </div>
          </div>
        )}

        {error ? <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
      </SectionCard>
    </div>
  );
}
