import {
  addPaymentMethodReq,
  cancelSubReq,
  changeGlobalPaymentMethodReq,
  checkPaymentReq,
  createPreviewReq,
  createSubscriptionReq,
  createUpdatePreviewReq,
  exchangeSessionForToken,
  getCountryList,
  getInvoiceDetailReq,
  getInvoiceListReq,
  getPaymentMethodListReq,
  getPlanList,
  getProductListReq,
  getSublistReq,
  removePaymentMethodReq,
  terminateOrResumeSubReq,
  updateSubscriptionReq
} from '@/requests'
import {
  CancellationPreview,
  Country,
  CheckoutSession,
  IPlan,
  IPreview,
  ISubscription,
  PaymentState,
  PricingPlanCard,
  UserInvoice
} from '@/shared.types'
import { useAppConfigStore, useProfileStore } from '@/stores'
import {
  CreditCardOutlined,
  DownloadOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SwapOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Grid,
  Input,
  List,
  Popconfirm,
  Row,
  Select,
  Segmented,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PublicBillingLayout from '../layouts/PublicBillingLayout'
import {
  BillingSection,
  OrderSummaryCard,
  PlanCard,
  StatePanel,
  StickyMobileBar,
  TrustBanner
} from '../customer-billing/primitives'
import {
  buildCancellationPreview,
  buildPaymentState,
  buildPlanChangePreview,
  createCheckoutSessionFromPlan,
  formatCadence,
  getFallbackPlans,
  invoiceToState,
  previewToSummary,
  productsToPricingCards,
  readCheckoutSession,
  storeCheckoutSession
} from '../customer-billing/utils'
import { downloadInvoice, getProfileReq } from '@/requests'
import { showAmount } from '@/helpers'
import { withEnvBasePath } from '@/utils/path'

const { Paragraph, Text, Title } = Typography
const { useBreakpoint } = Grid

type PaymentMethod = {
  id: string
  type: string
  data: {
    brand: string
    country: string
    expYear: number
    expMonth: number
    last4?: string
  }
}

const getStripeGatewayId = () =>
  useAppConfigStore.getState().gateway.find((gateway) => gateway.gatewayName === 'stripe')
    ?.gatewayId

const hasUserToken = () =>
  Boolean(
    localStorage.getItem('token') ||
      new URLSearchParams(window.location.search).get('session')
  )

export function PricingPage() {
  const [loading, setLoading] = useState(false)
  const [plans, setPlans] = useState<PricingPlanCard[]>(getFallbackPlans())
  const [hasLivePlans, setHasLivePlans] = useState(false)
  const [billingMode, setBillingMode] = useState<'monthly' | 'yearly'>('monthly')
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      if (!hasUserToken()) {
        setHasLivePlans(false)
        return
      }

      setLoading(true)
      const [[productRes, productErr], [planRes, planErr]] = await Promise.all([
        getProductListReq(),
        getPlanList({ type: [1] })
      ])
      setLoading(false)
      if (productErr || planErr) {
        setHasLivePlans(false)
      } else {
        const cards = productsToPricingCards(productRes.products ?? [], planRes ?? [])
        setPlans(cards)
        setHasLivePlans((cards?.length ?? 0) > 0)
      }
    }

    // run loader
    load()
  }, [])

  const onSelect = (plan: PricingPlanCard) => {
    if (!hasUserToken()) {
      navigate(withEnvBasePath('/login'), {
        state: {
          msg: 'Sign in to view live plans and continue checkout.',
          redirectTo: withEnvBasePath('/pricing')
        }
      })
      return
    }

    if (!hasLivePlans) {
      message.error('Plans are not available yet. Please refresh and try again.')
      return
    }

    const session = createCheckoutSessionFromPlan(
      {
        id: plan.id,
        productId: plan.productId,
        planName: plan.name,
        description: plan.description,
        type: 1,
        currency: plan.currency as IPlan['currency'],
        intervalCount: plan.intervalCount,
        intervalUnit: plan.intervalUnit,
        amount: plan.amount,
        status: 2,
        cancelAtTrialEnd: 0,
        trialAmount: 0,
        trialDemand: '',
        trialDurationTime: plan.trialDays * 86400
      },
      plan.productName
    )
    storeCheckoutSession(session)
    navigate(withEnvBasePath('/checkout'))
  }

  const visiblePlans = plans

  return (
    <PublicBillingLayout>
      <div className="billing-page-shell">
        <BillingSection
          eyebrow="Hosted pricing"
          title="Pick the plan that matches your billing needs"
          caption="Clear plan comparison, mobile-friendly plan selection, and a straight path into hosted checkout."
          extra={
            <Segmented
              options={[
                { label: 'Monthly', value: 'monthly' },
                { label: 'Yearly', value: 'yearly' }
              ]}
              value={billingMode}
              onChange={(value) => setBillingMode(value as 'monthly' | 'yearly')}
            />
          }
        >
          <TrustBanner />
          <div className="pricing-grid">
            {loading ? (
              <div className="billing-empty-state">
                <Spin indicator={<LoadingOutlined spin />} />
              </div>
            ) : (
              visiblePlans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} ctaLabel="Continue to checkout" onSelect={onSelect} />
              ))
            )}
          </div>
        </BillingSection>
      </div>
    </PublicBillingLayout>
  )
}

export function CheckoutPage() {
  const profile = useProfileStore()
  const appConfig = useAppConfigStore()
  const screens = useBreakpoint()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [session, setSession] = useState<CheckoutSession | null>(readCheckoutSession())
  const [preview, setPreview] = useState<IPreview | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [countryList, setCountryList] = useState<{ label: string; value: string }[]>([])
  const [form] = Form.useForm()

  useEffect(() => {
    const load = async () => {
      // CRITICAL: For hosted checkout, exchange session for token FIRST, before ANY API calls
      const sessionParam = new URLSearchParams(window.location.search).get('session')
      if (sessionParam && !localStorage.getItem('token')) {
        try {
          await exchangeSessionForToken()
        } catch (_err) {
          message.error('Failed to authenticate. Please try again.')
          return
        }
      }

      // After token exchange, check if we have any auth at all
      if (!localStorage.getItem('token') && !sessionParam) {
        return
      }

      // Handle hosted checkout: if planId in URL and no session in state, fetch all plans and find the one matching
      let currentSession = readCheckoutSession()
      if (!currentSession && searchParams.get('planId')) {
        const planId = Number(searchParams.get('planId'))
        const [planList, planErr] = await getPlanList({ type: [1] })
        if (!planErr && planList) {
          const plan = planList.find((p: IPlan) => p.id === planId)
          if (plan) {
            const [products, productsErr] = await getProductListReq()
            if (!productsErr && products) {
              const product = products.find((p: { productId: number; productName: string }) => p.productId === plan.productId)
              const newSession = createCheckoutSessionFromPlan(plan, product?.productName ?? '')
              setSession(newSession)
              storeCheckoutSession(newSession)
              currentSession = newSession
            }
          }
        }
      }

      const [countries] = await getCountryList()
      if (countries) {
        setCountryList(
          countries.map((country: Country) => ({
            label: country.countryName,
            value: country.countryCode
          }))
        )
      }

    }

    // run loader
    load()

    form.setFieldsValue({
      email: profile.email || session?.customerEmail,
      companyName: profile.companyName || session?.companyName,
      billingCountryCode: profile.countryCode || session?.billingCountryCode,
      vatNumber: profile.vATNumber || session?.vatNumber,
      discountCode: session?.discountCode
    })
  }, [form, navigate, profile.companyName, profile.countryCode, profile.email, profile.vATNumber, session, searchParams])

  const gatewayId =
    session?.gatewayId ??
    appConfig.gateway.find((gateway) => gateway.gatewayName === 'stripe')?.gatewayId ??
    appConfig.gateway[0]?.gatewayId

  const refreshPreview = async () => {
    if (!session || !profile.id || !gatewayId) {
      return
    }

    const [nextPreview, err] = await createPreviewReq({
      planId: session.planId,
      addons: [],
      vatNumber: form.getFieldValue('vatNumber') ?? '',
      vatCountryCode: form.getFieldValue('billingCountryCode') ?? profile.countryCode,
      gatewayId,
      gatewayPaymentType: session.gatewayPaymentType,
      refreshCb: refreshPreview,
      discountCode: form.getFieldValue('discountCode') ?? ''
    })

    if (err) {
      message.error(err.message)
      return
    }

    setPreview(nextPreview)
  }

  useEffect(() => {
    if (profile.id && session) {
      refreshPreview()
    }
  }, [profile.id, session?.id])

  if (!session) {
    return (
      <PublicBillingLayout>
        <div className="billing-page-shell">
          <div className="billing-empty-state">
            <Spin indicator={<LoadingOutlined spin />} />
            <p>Loading checkout...</p>
          </div>
        </div>
      </PublicBillingLayout>
    )
  }

  const summary = previewToSummary(preview, session)

  const onCheckout = async () => {
    const values = await form.validateFields()
    const nextSession = {
      ...session,
      customerEmail: values.email,
      companyName: values.companyName,
      billingCountryCode: values.billingCountryCode,
      vatNumber: values.vatNumber,
      discountCode: values.discountCode,
      gatewayId
    }
    setSession(nextSession)
    storeCheckoutSession(nextSession)

    if (!profile.id) {
      navigate(withEnvBasePath('/login'), {
        state: {
          msg: 'Sign in to complete your purchase.',
          redirectTo: withEnvBasePath('/checkout')
        }
      })
      return
    }

    if (!gatewayId) {
      message.error('No payment method is configured for checkout.')
      return
    }

    setSubmitting(true)
    const [res, err] = await createSubscriptionReq({
      planId: session.planId,
      addons: [],
      confirmTotalAmount: preview?.totalAmount ?? session.amount,
      confirmCurrency: preview?.currency ?? session.currency,
      vatCountryCode: values.billingCountryCode ?? profile.countryCode,
      vatNumber: values.vatNumber ?? '',
      gatewayId,
      gatewayPaymentType: session.gatewayPaymentType,
      discountCode: values.discountCode ?? '',
      returnUrl: `${window.location.origin}${withEnvBasePath('/checkout/pending')}`
    })
    setSubmitting(false)

    if (err) {
      message.error(err.message)
      navigate(withEnvBasePath('/checkout/failure'))
      return
    }

    if (res?.subscription?.subscriptionId) {
      sessionStorage.setItem('gebarbilling.checkout.subscriptionId', res.subscription.subscriptionId)
    }

    if (res?.link) {
      window.open(res.link, '_blank')
    }
    navigate(
      `${withEnvBasePath('/checkout/pending')}?subId=${encodeURIComponent(
        res?.subscription?.subscriptionId ?? ''
      )}`
    )
  }

  return (
    <PublicBillingLayout>
      <div className="billing-page-shell">
        <div className="billing-two-column">
          <div className="billing-main-column">
            <BillingSection
              eyebrow="Hosted checkout"
              title={`Checkout for ${session.planName}`}
              caption="Enter account and billing details, apply promo codes, and review exactly what will be charged today."
            >
              <TrustBanner />
              {!profile.id ? (
                <Alert
                  type="warning"
                  showIcon
                  message="You can review your pricing now. Sign in is required just before payment confirmation."
                />
              ) : null}
              <Form layout="vertical" form={form} className="billing-form-stack">
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12}>
                    <Form.Item
                      label="Email"
                      name="email"
                      rules={[{ required: true, message: 'Email is required.' }]}
                    >
                      <Input placeholder="billing@company.com" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Company name" name="companyName">
                      <Input placeholder="Acme, Inc." />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      label="Billing country"
                      name="billingCountryCode"
                      rules={[{ required: true, message: 'Billing country is required.' }]}
                    >
                      <Select options={countryList} showSearch optionFilterProp="label" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="VAT / Tax ID" name="vatNumber">
                      <Input placeholder="Optional" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Promo code" name="discountCode">
                      <Input
                        placeholder="Enter code"
                        suffix={
                          <Button type="link" onClick={refreshPreview}>
                            Apply
                          </Button>
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Payment method">
                      <Select
                        value={gatewayId}
                        options={appConfig.gateway.map((gateway) => ({
                          label: gateway.displayName,
                          value: gateway.gatewayId
                        }))}
                        onChange={(value) => {
                          const nextSession = { ...session, gatewayId: value }
                          setSession(nextSession)
                          storeCheckoutSession(nextSession)
                        }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <div className="billing-inline-actions">
                  <Button icon={<ReloadOutlined />} onClick={refreshPreview} disabled={!profile.id}>
                    Refresh totals
                  </Button>
                  <Text type="secondary">
                    Taxes, discounts, and renewal timing stay visible in the summary while you edit.
                  </Text>
                </div>
              </Form>
            </BillingSection>
          </div>
          <aside className="billing-side-column">
            <div className="billing-sticky-panel">
              <OrderSummaryCard summary={summary} />
              <Card className="billing-summary-card">
                <Space direction="vertical" size={12}>
                  <Text className="billing-summary-label">What happens next</Text>
                  <div className="billing-next-step">
                    <span>Billing starts</span>
                    <strong>{session.trialDays > 0 ? `After ${session.trialDays} days` : 'Today'}</strong>
                  </div>
                  <div className="billing-next-step">
                    <span>Renewal</span>
                    <strong>{summary.nextBillingDate ?? 'Shown after confirmation'}</strong>
                  </div>
                  <Button type="primary" size="large" block loading={submitting} onClick={onCheckout}>
                    {profile.id ? 'Confirm purchase' : 'Continue to secure payment'}
                  </Button>
                </Space>
              </Card>
            </div>
          </aside>
        </div>
        {!screens.md ? (
          <>
            <OrderSummaryCard summary={summary} mobile />
            <StickyMobileBar
              amount={summary.totalDueNow}
              currency={summary.currency}
              cta={profile.id ? 'Confirm purchase' : 'Continue'}
              onClick={onCheckout}
              disabled={submitting}
            />
          </>
        ) : null}
      </div>
    </PublicBillingLayout>
  )
}

export function CheckoutPendingPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [session] = useState(readCheckoutSession())
  const subId =
    searchParams.get('subId') ?? sessionStorage.getItem('gebarbilling.checkout.subscriptionId') ?? ''

  useEffect(() => {
    if (!subId) {
      return
    }

    const check = async () => {
      const [res, err] = await checkPaymentReq(subId)
      if (err) {
        return
      }

      const payStatus = res?.payStatus
      if (payStatus === 2) {
        navigate(withEnvBasePath('/checkout/success'))
      } else if (payStatus === 4 || payStatus === 5) {
        navigate(withEnvBasePath('/checkout/failure'))
      }
    }

    check()
    const interval = window.setInterval(check, 3000)
    return () => window.clearInterval(interval)
  }, [navigate, subId])

  const state = buildPaymentState('pending', session)

  return (
    <PublicBillingLayout>
      <div className="billing-page-shell billing-state-page">
        <StatePanel state={state}>
          {session ? <OrderSummaryCard summary={previewToSummary(null, session)} /> : null}
        </StatePanel>
      </div>
    </PublicBillingLayout>
  )
}

export function CheckoutStatePage({ status }: { status: PaymentState['status'] }) {
  const [session] = useState(readCheckoutSession())
  const state = buildPaymentState(status, session)

  return (
    <PublicBillingLayout>
      <div className="billing-page-shell billing-state-page">
        <StatePanel state={state}>
          {session ? <OrderSummaryCard summary={previewToSummary(null, session)} /> : null}
        </StatePanel>
      </div>
    </PublicBillingLayout>
  )
}

export function InvoicePayPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const invoiceId = window.location.pathname.split('/').pop() ?? searchParams.get('invoiceId') ?? ''
  const [loading, setLoading] = useState(false)
  const [invoice, setInvoice] = useState<UserInvoice | null>(null)
  const [paying, setPaying] = useState(false)

  useEffect(() => {
    const load = async () => {
      if (!invoiceId) {
        return
      }
      if (!hasUserToken()) {
        navigate(withEnvBasePath('/login'), {
          state: {
            redirectTo: withEnvBasePath(`/invoice/pay/${invoiceId}`)
          }
        })
        return
      }
      setLoading(true)
      const [nextInvoice, err] = await getInvoiceDetailReq(invoiceId, load)
      setLoading(false)
      if (err) {
        return
      }
      setInvoice(nextInvoice)
    }

    load()
  }, [invoiceId, navigate])

  const state = invoice ? invoiceToState(invoice) : null

  return (
    <PublicBillingLayout>
      <div className="billing-page-shell">
        <BillingSection
          eyebrow="Invoice payment"
          title={invoice ? invoice.invoiceName : `Invoice ${invoiceId}`}
          caption="Document-first invoice payment with clear amount due, dates, tax visibility, and payment handling."
        >
          {loading ? (
            <div className="billing-empty-state">
              <Spin indicator={<LoadingOutlined spin />} />
            </div>
          ) : !invoice || !state ? (
            <Empty description="We could not load that invoice. Ask support for a fresh payment link." />
          ) : (
            <div className="billing-two-column">
              <div className="billing-main-column">
                <Card className="billing-summary-card">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <div className="billing-doc-header">
                      <div>
                        <Text className="billing-summary-label">Invoice ID</Text>
                        <Title level={4} style={{ margin: '4px 0 0' }}>
                          {invoice.invoiceId}
                        </Title>
                      </div>
                      <Tag color={state.status === 'paid' ? 'green' : state.status === 'overdue' ? 'red' : 'blue'}>
                        {state.status.toUpperCase()}
                      </Tag>
                    </div>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} md={12}>
                        <div className="billing-data-card">
                          <Text className="billing-summary-label">Issue date</Text>
                          <div>{state.issueDate ?? 'Unavailable'}</div>
                        </div>
                      </Col>
                      <Col xs={24} md={12}>
                        <div className="billing-data-card">
                          <Text className="billing-summary-label">Due date</Text>
                          <div>{state.dueDate ?? 'Unavailable'}</div>
                        </div>
                      </Col>
                    </Row>
                    <List
                      dataSource={invoice.lines}
                      renderItem={(line) => (
                        <List.Item>
                          <div className="billing-line-item">
                            <div>
                              <div>{line.description}</div>
                              <Text type="secondary">
                                Qty {line.quantity} • Tax {line.taxPercentage / 100}%
                              </Text>
                            </div>
                            <strong>{showAmount(line.amount, line.currency, true)}</strong>
                          </div>
                        </List.Item>
                      )}
                    />
                    <div className="billing-inline-actions">
                      <Button icon={<DownloadOutlined />} onClick={() => downloadInvoice(invoice.sendPdf)}>
                        Download PDF
                      </Button>
                      <Text type="secondary">Secure payment handling and receipt confirmation are shown after payment.</Text>
                    </div>
                  </Space>
                </Card>
              </div>
              <aside className="billing-side-column">
                <Card className="billing-summary-card">
                  <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    <Text className="billing-summary-label">Amount due</Text>
                    <Title level={2} style={{ margin: 0 }}>
                      {showAmount(invoice.totalAmount, invoice.currency, true)}
                    </Title>
                    <div className="billing-summary-line">
                      <span>Tax</span>
                      <span>{showAmount(invoice.taxAmount, invoice.currency, true)}</span>
                    </div>
                    <div className="billing-summary-line">
                      <span>Status</span>
                      <span>{state.status}</span>
                    </div>
                    <Button
                      type="primary"
                      size="large"
                      block
                      disabled={state.status === 'paid'}
                      loading={paying}
                      onClick={async () => {
                        setPaying(true)
                        window.open(invoice.link || withEnvBasePath('/checkout'), '_blank')
                        setPaying(false)
                      }}
                    >
                      {state.status === 'paid' ? 'Invoice paid' : 'Pay invoice'}
                    </Button>
                  </Space>
                </Card>
              </aside>
            </div>
          )}
        </BillingSection>
      </div>
    </PublicBillingLayout>
  )
}

export function BillingCenterPage() {
  const [loading, setLoading] = useState(false)
  const [subscriptions, setSubscriptions] = useState<ISubscription[]>([])
  const [invoices, setInvoices] = useState<UserInvoice[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const profile = useProfileStore()
  const stripeGatewayId = getStripeGatewayId()

  const load = async () => {
    setLoading(true)
    const [[subRes], [invoiceRes], [methodRes]] = await Promise.all([
      getSublistReq(),
      getInvoiceListReq({ page: 0, count: 5 }),
      stripeGatewayId
        ? getPaymentMethodListReq(stripeGatewayId)
        : Promise.resolve<[PaymentMethod[], null]>([[], null])
    ])
    setLoading(false)

    setSubscriptions(subRes ?? [])
    setInvoices(invoiceRes?.invoices ?? [])
    setMethods(methodRes ?? [])
  }

  useEffect(() => {
    load()
  }, [stripeGatewayId])

  const currentSubscription =
    subscriptions.find((subscription) => subscription.status === 2 || subscription.status === 1) ??
    subscriptions[0]

  const columns: ColumnsType<UserInvoice> = [
    { title: 'Invoice', dataIndex: 'invoiceId', key: 'invoiceId' },
    {
      title: 'Amount',
      key: 'amount',
      render: (_, invoice) => showAmount(invoice.totalAmount, invoice.currency, true)
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, invoice) => (
        <Tag color={invoice.status === 3 ? 'green' : invoice.status === 4 ? 'red' : 'blue'}>
          {invoice.status === 3 ? 'Paid' : invoice.status === 4 ? 'Failed' : 'Awaiting payment'}
        </Tag>
      )
    },
    {
      title: 'Issued',
      key: 'issued',
      render: (_, invoice) => dayjs(invoice.createTime * 1000).format('MMM D, YYYY')
    }
  ]

  return (
    <div className="billing-center-page">
      <Spin spinning={loading} indicator={<LoadingOutlined spin />}>
        <BillingSection
          eyebrow="Billing portal"
          title="Manage subscription, invoices, and payment methods"
          caption="A lightweight billing center for customers who need fast answers and clean controls."
          extra={
            <Space>
              <Button href={withEnvBasePath('/billing/payment-methods')}>Update payment method</Button>
              <Button type="primary" href={withEnvBasePath('/billing/change-plan')}>
                Change plan
              </Button>
            </Space>
          }
        >
          <div className="billing-overview-grid">
            <div className="billing-data-card">
              <Text className="billing-summary-label">Current plan</Text>
              <div>{currentSubscription?.plan.planName ?? 'No active subscription'}</div>
            </div>
            <div className="billing-data-card">
              <Text className="billing-summary-label">Next renewal</Text>
              <div>
                {currentSubscription?.currentPeriodEnd
                  ? dayjs(currentSubscription.currentPeriodEnd * 1000).format('MMMM D, YYYY')
                  : 'Unavailable'}
              </div>
            </div>
            <div className="billing-data-card">
              <Text className="billing-summary-label">Payment method</Text>
              <div>
                {methods[0]?.data?.brand
                  ? `${methods[0].data.brand.toUpperCase()} ending in ${methods[0].data.last4 ?? '••••'}`
                  : profile.paymentMethod || 'No default payment method'}
              </div>
            </div>
            <div className="billing-data-card">
              <Text className="billing-summary-label">Invoices</Text>
              <div>{invoices.length} recent invoice{invoices.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="billing-two-column">
            <div className="billing-main-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <div className="billing-section-header">
                    <div>
                      <Text className="billing-eyebrow">Subscription overview</Text>
                      <Title level={4} style={{ margin: 0 }}>
                        {currentSubscription?.plan.planName ?? 'No active subscription'}
                      </Title>
                    </div>
                    <Tag color="blue">{currentSubscription?.status === 2 ? 'ACTIVE' : 'PENDING'}</Tag>
                  </div>
                  <Paragraph className="billing-caption">
                    {currentSubscription
                      ? `You are billed ${formatCadence(currentSubscription.plan).toLowerCase()} with the next invoice expected on ${dayjs(currentSubscription.currentPeriodEnd * 1000).format('MMMM D, YYYY')}.`
                      : 'Pick a plan to start billing.'}
                  </Paragraph>
                  <Space wrap>
                    <Button href={withEnvBasePath('/billing/change-plan')} icon={<SwapOutlined />}>
                      Upgrade or downgrade
                    </Button>
                    <Button danger href={withEnvBasePath('/billing/cancel')}>
                      Cancel subscription
                    </Button>
                  </Space>
                </Space>
              </Card>
              <Card className="billing-summary-card">
                <div className="billing-section-header">
                  <div>
                    <Text className="billing-eyebrow">Billing history</Text>
                    <Title level={4} style={{ margin: 0 }}>
                      Recent invoices
                    </Title>
                  </div>
                  <Button href={withEnvBasePath('/invoice/list')}>View all</Button>
                </div>
                <Table rowKey="invoiceId" columns={columns} dataSource={invoices} pagination={false} />
              </Card>
            </div>
            <aside className="billing-side-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text className="billing-summary-label">Quick actions</Text>
                  <Button icon={<CreditCardOutlined />} block href={withEnvBasePath('/billing/payment-methods')}>
                    Update payment method
                  </Button>
                  <Button block href={withEnvBasePath('/pricing')}>
                    View pricing
                  </Button>
                  <Button block href={withEnvBasePath('/invoice/list')}>
                    Download receipts
                  </Button>
                </Space>
              </Card>
            </aside>
          </div>
        </BillingSection>
      </Spin>
    </div>
  )
}

export function PaymentMethodsPage() {
  const profile = useProfileStore()
  const [loading, setLoading] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const stripeGatewayId = getStripeGatewayId()

  const load = async () => {
    if (!stripeGatewayId) {
      return
    }
    setLoading(true)
    const [res, err] = await getPaymentMethodListReq(stripeGatewayId)
    setLoading(false)
    if (err) {
      message.error(err.message)
      return
    }
    setMethods(res ?? [])
  }

  useEffect(() => {
    load()
  }, [stripeGatewayId])

  const addMethod = async () => {
    if (!stripeGatewayId) {
      return
    }
    const [res, err] = await addPaymentMethodReq({
      gatewayId: stripeGatewayId,
      redirectUrl: `${window.location.origin}${withEnvBasePath('/add-payment-method-result')}`
    })
    if (err) {
      message.error(err.message)
      return
    }
    window.open(res.url, '_blank')
  }

  const setDefault = async (paymentMethodId: string) => {
    if (!stripeGatewayId) {
      return
    }
    const [_, err] = await changeGlobalPaymentMethodReq({
      gatewayId: stripeGatewayId,
      paymentMethodId
    })
    if (err) {
      message.error(err.message)
      return
    }
    message.success('Default payment method updated.')
  }

  const removeMethod = async (paymentMethodId: string) => {
    if (!stripeGatewayId) {
      return
    }
    const [_, err] = await removePaymentMethodReq({
      gatewayId: stripeGatewayId,
      paymentMethodId
    })
    if (err) {
      message.error(err.message)
      return
    }
    load()
  }

  return (
    <div className="billing-center-page">
      <BillingSection
        eyebrow="Payment methods"
        title="Update the card used for future billing"
        caption="Replace the card on file, set a default billing method, and avoid service interruption before the next renewal."
        extra={
          <Button type="primary" onClick={addMethod}>
            Add payment method
          </Button>
        }
      >
        <TrustBanner compact />
        <Card className="billing-summary-card">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Text className="billing-summary-label">Current default</Text>
            <div>{profile.paymentMethod || 'No default payment method set'}</div>
          </Space>
        </Card>
        <List
          className="billing-method-list"
          loading={loading}
          dataSource={methods}
          locale={{ emptyText: 'No saved payment methods yet.' }}
          renderItem={(method) => (
            <List.Item
              actions={[
                <Button key="default" type="link" onClick={() => setDefault(method.id)}>
                  Set as default
                </Button>,
                <Popconfirm
                  key="remove"
                  title="Remove payment method?"
                  onConfirm={() => removeMethod(method.id)}
                  okText="Remove"
                >
                  <Button type="link" danger>
                    Remove
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                avatar={<CreditCardOutlined />}
                title={`${method.data.brand.toUpperCase()} •••• ${method.data.last4 ?? '••••'}`}
                description={`Expires ${method.data.expMonth}/${method.data.expYear} • ${method.data.country}`}
              />
            </List.Item>
          )}
        />
      </BillingSection>
    </div>
  )
}

export function PlanChangePage() {
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [subscriptions, setSubscriptions] = useState<ISubscription[]>([])
  const [plans, setPlans] = useState<IPlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<number>()
  const [preview, setPreview] = useState<IPreview | null>(null)

  const currentSubscription =
    subscriptions.find((subscription) => subscription.status === 2 || subscription.status === 1) ??
    subscriptions[0]
  const candidatePlans = plans.filter(
    (plan) => plan.productId === currentSubscription?.productId && plan.id !== currentSubscription?.planId
  )
  const selectedPlan = candidatePlans.find((plan) => plan.id === selectedPlanId) ?? candidatePlans[0]

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [[subRes], [planRes]] = await Promise.all([getSublistReq(), getPlanList({ type: [1] })])
      setLoading(false)
      setSubscriptions(subRes ?? [])
      setPlans(planRes ?? [])
    }

    load()
  }, [])

  useEffect(() => {
    if (!currentSubscription || !selectedPlan) {
      return
    }

    const loadPreview = async () => {
      const [res, err] = await createUpdatePreviewReq({
        planId: selectedPlan.id,
        addons: [],
        subscriptionId: currentSubscription.subscriptionId
      })
      if (err) {
        return
      }
      setPreview(res)
    }

    loadPreview()
  }, [currentSubscription?.subscriptionId, selectedPlan?.id])

  const planChangePreview =
    currentSubscription && selectedPlan
      ? buildPlanChangePreview(currentSubscription, selectedPlan)
      : null

  const confirm = async () => {
    if (!currentSubscription || !selectedPlan || !preview) {
      return
    }

    setSubmitting(true)
    const [res, err] = await updateSubscriptionReq({
      newPlanId: selectedPlan.id,
      subscriptionId: currentSubscription.subscriptionId,
      addons: [],
      confirmTotalAmount: preview.totalAmount,
      confirmCurrency: preview.currency,
      prorationDate: preview.prorationDate ?? 0
    })
    setSubmitting(false)
    if (err) {
      message.error(err.message)
      return
    }

    if (res?.link) {
      window.open(res.link, '_blank')
    }
    message.success('Plan change submitted.')
  }

  return (
    <div className="billing-center-page">
      <BillingSection
        eyebrow="Plan change"
        title="Review upgrades or downgrades before you confirm"
        caption="See current plan, target plan, prorated charges or credits, and the next billing impact before anything changes."
      >
        {loading ? (
          <div className="billing-empty-state">
            <Spin indicator={<LoadingOutlined spin />} />
          </div>
        ) : !currentSubscription ? (
          <Empty description="No active subscription to update." />
        ) : (
          <div className="billing-two-column">
            <div className="billing-main-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <div className="billing-section-header">
                    <div>
                      <Text className="billing-summary-label">Target plan</Text>
                      <Title level={4} style={{ margin: 0 }}>
                        Change from {currentSubscription.plan.planName}
                      </Title>
                    </div>
                  </div>
                  <Select
                    value={selectedPlan?.id}
                    options={candidatePlans.map((plan) => ({
                      label: `${plan.planName} • ${showAmount(plan.amount, plan.currency)}`,
                      value: plan.id
                    }))}
                    onChange={setSelectedPlanId}
                  />
                  {planChangePreview ? (
                    <div className="billing-overview-grid">
                      <div className="billing-data-card">
                        <Text className="billing-summary-label">Current plan</Text>
                        <div>{planChangePreview.currentPlanName}</div>
                      </div>
                      <div className="billing-data-card">
                        <Text className="billing-summary-label">New plan</Text>
                        <div>{planChangePreview.nextPlanName}</div>
                      </div>
                      <div className="billing-data-card">
                        <Text className="billing-summary-label">Proration</Text>
                        <div>{showAmount(planChangePreview.proratedAmount, planChangePreview.currency)}</div>
                      </div>
                      <div className="billing-data-card">
                        <Text className="billing-summary-label">Effective date</Text>
                        <div>{planChangePreview.effectiveDate}</div>
                      </div>
                    </div>
                  ) : null}
                </Space>
              </Card>
            </div>
            <aside className="billing-side-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Text className="billing-summary-label">Billing effect</Text>
                  <div className="billing-summary-line">
                    <span>Due now</span>
                    <strong>{showAmount(preview?.totalAmount ?? 0, preview?.currency ?? selectedPlan?.currency)}</strong>
                  </div>
                  <div className="billing-summary-line">
                    <span>Next billing</span>
                    <span>
                      {showAmount(
                        preview?.nextPeriodInvoice?.totalAmount ?? selectedPlan?.amount ?? 0,
                        preview?.currency ?? selectedPlan?.currency
                      )}
                    </span>
                  </div>
                  <Button type="primary" block loading={submitting} onClick={confirm}>
                    Confirm plan change
                  </Button>
                </Space>
              </Card>
            </aside>
          </div>
        )}
      </BillingSection>
    </div>
  )
}

export function CancelSubscriptionPage() {
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const [subscription, setSubscription] = useState<ISubscription | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [res] = await getSublistReq()
      setLoading(false)
      const active =
        res?.find((item: ISubscription) => item.status === 2 || item.status === 1) ?? null
      setSubscription(active)
    }

    load()
  }, [])

  const preview: CancellationPreview | null = subscription
    ? buildCancellationPreview(subscription)
    : null

  const confirm = async () => {
    if (!subscription) {
      return
    }

    const request =
      subscription.status === 1
        ? cancelSubReq(subscription.subscriptionId)
        : terminateOrResumeSubReq({
            subscriptionId: subscription.subscriptionId,
            action: 'CANCEL'
          })

    const [_, err] = await request
    if (err) {
      message.error(err.message)
      return
    }
    message.success(reason ? 'Cancellation scheduled and feedback recorded locally.' : 'Cancellation scheduled.')
    navigate(withEnvBasePath('/billing'))
  }

  return (
    <div className="billing-center-page">
      <BillingSection
        eyebrow="Cancellation"
        title="Cancel with clear timing and no dark patterns"
        caption="Review what stays active, when access ends, and confirm the change with calm language."
      >
        {loading ? (
          <div className="billing-empty-state">
            <Spin indicator={<LoadingOutlined spin />} />
          </div>
        ) : !preview ? (
          <Empty description="No active subscription to cancel." />
        ) : (
          <div className="billing-two-column">
            <div className="billing-main-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <div className="billing-overview-grid">
                    <div className="billing-data-card">
                      <Text className="billing-summary-label">Plan</Text>
                      <div>{preview.planName}</div>
                    </div>
                    <div className="billing-data-card">
                      <Text className="billing-summary-label">Access remains until</Text>
                      <div>{preview.accessEndsAt}</div>
                    </div>
                  </div>
                  <Alert
                    type="info"
                    showIcon
                    message="Your access remains active until the end of the current billing period unless this subscription is still pending."
                  />
                  <div>
                    <Text className="billing-summary-label">Reason for leaving</Text>
                    <Select
                      style={{ width: '100%', marginTop: 8 }}
                      value={reason || undefined}
                      onChange={setReason}
                      options={[
                        { label: 'Too expensive', value: 'too_expensive' },
                        { label: 'Missing features', value: 'missing_features' },
                        { label: 'Temporary pause', value: 'temporary_pause' },
                        { label: 'Switching providers', value: 'switching_providers' }
                      ]}
                      placeholder="Optional"
                    />
                  </div>
                </Space>
              </Card>
            </div>
            <aside className="billing-side-column">
              <Card className="billing-summary-card">
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Text className="billing-summary-label">Before you leave</Text>
                  <Paragraph className="billing-caption" style={{ marginBottom: 0 }}>
                    A lighter plan or payment-method update can prevent interruption without changing your current access immediately.
                  </Paragraph>
                  <Button block href={withEnvBasePath('/billing/change-plan')}>
                    Review plan options
                  </Button>
                  <Button danger type="primary" block onClick={confirm}>
                    Confirm cancellation
                  </Button>
                </Space>
              </Card>
            </aside>
          </div>
        )}
      </BillingSection>
    </div>
  )
}

export async function refreshProfileIntoStore() {
  const [user] = await getProfileReq()
  if (user) {
    useProfileStore.getState().setProfile(user)
  }
}
