import type {
  CancellationPreview,
  CheckoutSession,
  CheckoutSummary,
  CheckoutSummaryLine,
  IPlan,
  IPreview,
  ISubscription,
  InvoicePaymentState,
  PaymentState,
  PlanChangePreview,
  PricingPlanCard,
  UserInvoice
} from '@/shared.types'

const CHECKOUT_SESSION_KEY = 'gebarbilling.checkout.session'

const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

function getCurrencyFormatter(currency: string) {
  const key = currency || 'USD'
  const cached = currencyFormatterCache.get(key)
  if (cached) {
    return cached
  }

  const formatter = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: key,
    maximumFractionDigits: 2
  })
  currencyFormatterCache.set(key, formatter)
  return formatter
}

export function formatMoney(amount: number, currency: string) {
  try {
    return getCurrencyFormatter(currency).format(amount / 100)
  } catch (_err) {
    return `${currency} ${(amount / 100).toFixed(2)}`
  }
}

export function formatCadence(plan: Pick<IPlan, 'intervalCount' | 'intervalUnit' | 'trialDurationTime'>) {
  const interval = plan.intervalCount > 1 ? `${plan.intervalCount} ${plan.intervalUnit}s` : plan.intervalUnit
  return `Billed every ${interval}`
}

export function getFallbackPlans(): PricingPlanCard[] {
  return []
}

export function productsToPricingCards(
  products: { productId: number; productName: string; description?: string }[],
  plans: IPlan[]
): PricingPlanCard[] {
  return plans.map((plan) => {
    const product = products.find((item) => item.productId === plan.productId)
    return planToPricingCard(plan, product?.productName ?? '')
  })
}

export function planToPricingCard(plan: IPlan, productName: string): PricingPlanCard {
  return {
    id: plan.id,
    productId: plan.productId,
    productName,
    name: plan.planName,
    description: plan.description,
    amount: plan.amount,
    currency: plan.currency,
    intervalCount: plan.intervalCount,
    intervalUnit: plan.intervalUnit,
    trialDays: Math.max(0, Math.floor(plan.trialDurationTime / 86400)),
    features: []
  }
}

export function createCheckoutSessionFromPlan(plan: IPlan, productName: string): CheckoutSession {
  return {
    id: `${plan.id}-${Date.now()}`,
    planId: plan.id,
    productId: plan.productId,
    planName: plan.planName,
    productName,
    currency: plan.currency,
    amount: plan.amount,
    cadenceLabel: formatCadence(plan),
    trialDays: Math.max(0, Math.floor(plan.trialDurationTime / 86400))
  }
}

export function storeCheckoutSession(session: CheckoutSession) {
  localStorage.setItem(CHECKOUT_SESSION_KEY, JSON.stringify(session))
}

export function readCheckoutSession(): CheckoutSession | null {
  const raw = localStorage.getItem(CHECKOUT_SESSION_KEY)
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as CheckoutSession
  } catch (_err) {
    return null
  }
}

export function previewToSummary(preview: IPreview | null, session: CheckoutSession): CheckoutSummary {
  const subtotal = preview?.subscriptionAmount ?? session.amount
  const discount = preview?.discountAmount ?? 0
  const tax = preview?.taxAmount ?? 0
  const totalDueNow = preview?.totalAmount ?? subtotal - discount + tax
  const nextBillingAmount = preview?.nextPeriodInvoice?.totalAmount ?? subtotal

  const lines: CheckoutSummaryLine[] = [
    { label: 'Subtotal', value: subtotal, currency: session.currency },
    { label: 'Discount', value: discount, currency: session.currency, tone: 'positive' },
    { label: 'Tax', value: tax, currency: session.currency, tone: 'muted' },
    { label: 'Due now', value: totalDueNow, currency: session.currency }
  ]

  return {
    currency: session.currency,
    subtotal,
    discount,
    tax,
    totalDueNow,
    nextBillingAmount,
    nextBillingDate: preview?.nextPeriodInvoice ? new Date(preview.nextPeriodInvoice.periodEnd * 1000).toLocaleDateString() : undefined,
    cadenceLabel: session.cadenceLabel,
    trialLabel: session.trialDays > 0 ? `${session.trialDays} day trial` : undefined,
    lines
  }
}

export function buildPaymentState(status: PaymentState['status'], session: CheckoutSession | null): PaymentState {
  if (status === 'success') {
    return {
      status,
      title: 'Payment successful',
      description: 'Your payment has been confirmed and your billing cycle has started.',
      actionLabel: 'Go to billing',
      actionHref: '/billing'
    }
  }

  if (status === 'failure') {
    return {
      status,
      title: 'Payment failed',
      description: 'The payment could not be completed. You can retry with the same checkout session.'
    }
  }

  return {
    status: 'pending',
    title: session ? `Checkout for ${session.planName}` : 'Checkout pending',
    description: 'We are waiting for payment confirmation and will update this page automatically.'
  }
}

export function buildPlanChangePreview(currentSubscription: ISubscription, selectedPlan: IPlan): PlanChangePreview {
  return {
    currentPlanName: currentSubscription.plan.planName,
    nextPlanName: selectedPlan.planName,
    currency: selectedPlan.currency,
    currentAmount: currentSubscription.amount,
    nextAmount: selectedPlan.amount,
    proratedAmount: Math.max(0, selectedPlan.amount - currentSubscription.amount),
    effectiveDate: new Date(currentSubscription.currentPeriodEnd * 1000).toLocaleDateString()
  }
}

export function buildCancellationPreview(subscription: ISubscription): CancellationPreview {
  return {
    subscriptionId: subscription.subscriptionId,
    planName: subscription.plan.planName,
    accessEndsAt: new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString(),
    endDate: new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()
  }
}

export function invoiceToState(invoice: UserInvoice): InvoicePaymentState {
  const status = invoice.status === 3 ? 'paid' : invoice.status === 4 || invoice.status === 5 ? 'overdue' : 'due'

  return {
    invoiceId: invoice.invoiceId,
    amountDue: invoice.totalAmount,
    currency: invoice.currency,
    status,
    dueDate: invoice.periodEnd ? new Date(invoice.periodEnd * 1000).toLocaleDateString() : undefined,
    issueDate: new Date(invoice.createTime * 1000).toLocaleDateString()
  }
}
