import { CheckCircleOutlined, InfoCircleOutlined, RightOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Space, Tag, Typography } from 'antd'
import type { ReactNode } from 'react'
import type { CheckoutSummary, PaymentState, PricingPlanCard } from '@/shared.types'
import { formatCadence, formatMoney } from './utils'

const { Paragraph, Text, Title } = Typography

export function BillingSection({
  eyebrow,
  title,
  caption,
  extra,
  children
}: {
  eyebrow: string
  title: string
  caption?: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="billing-section">
      <div className="billing-section-header">
        <div>
          <Text className="billing-eyebrow">{eyebrow}</Text>
          <Title level={2} style={{ margin: '8px 0 6px' }}>
            {title}
          </Title>
          {caption ? <Paragraph className="billing-caption">{caption}</Paragraph> : null}
        </div>
        {extra ? <div>{extra}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function PlanCard({
  plan,
  ctaLabel,
  onSelect
}: {
  plan: PricingPlanCard
  ctaLabel: string
  onSelect: (plan: PricingPlanCard) => void
}) {
  return (
    <Card className="billing-plan-card" hoverable onClick={() => onSelect(plan)}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div className="billing-plan-card__header">
          <div>
            <Text className="billing-plan-card__product">{plan.productName}</Text>
            <Title level={4} style={{ margin: '4px 0 0' }}>
              {plan.name}
            </Title>
          </div>
          {plan.isRecommended ? <Tag color="blue">Recommended</Tag> : null}
        </div>
        <Paragraph className="billing-caption" style={{ marginBottom: 0 }}>
          {plan.description}
        </Paragraph>
        <div className="billing-plan-card__price">{formatMoney(plan.amount, plan.currency)}</div>
        <Text type="secondary">{formatCadence(plan)}</Text>
        <Button type="primary" block icon={<RightOutlined />}>
          {ctaLabel}
        </Button>
      </Space>
    </Card>
  )
}

export function OrderSummaryCard({
  summary,
  mobile = false
}: {
  summary: CheckoutSummary
  mobile?: boolean
}) {
  return (
    <Card className={mobile ? 'billing-summary-card billing-summary-card--mobile' : 'billing-summary-card'}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="billing-section-header">
          <div>
            <Text className="billing-summary-label">Order summary</Text>
            <Title level={4} style={{ margin: 0 }}>
              {formatMoney(summary.totalDueNow, summary.currency)}
            </Title>
          </div>
          <Tag color="blue">{summary.cadenceLabel}</Tag>
        </div>
        <div className="billing-summary-lines">
          {summary.lines.map((line) => (
            <div className="billing-summary-line" key={line.label}>
              <span>{line.label}</span>
              <strong>{formatMoney(line.value, line.currency)}</strong>
            </div>
          ))}
        </div>
      </Space>
    </Card>
  )
}

export function StatePanel({
  state,
  children
}: {
  state: PaymentState
  children?: ReactNode
}) {
  return (
    <Card className="billing-summary-card billing-state-panel">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div className="billing-state-panel__title">
          <CheckCircleOutlined />
          <div>
            <Title level={3} style={{ margin: 0 }}>
              {state.title}
            </Title>
            <Paragraph className="billing-caption" style={{ marginBottom: 0 }}>
              {state.description}
            </Paragraph>
          </div>
        </div>
        {children}
        {state.actionLabel && state.actionHref ? (
          <Button type="primary" href={state.actionHref} icon={<RightOutlined />}>
            {state.actionLabel}
          </Button>
        ) : null}
      </Space>
    </Card>
  )
}

export function StickyMobileBar({
  amount,
  currency,
  cta,
  onClick,
  disabled
}: {
  amount: number
  currency: string
  cta: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <div className="billing-sticky-mobile-bar">
      <div>
        <Text type="secondary">Due now</Text>
        <div className="billing-sticky-mobile-bar__amount">{formatMoney(amount, currency)}</div>
      </div>
      <Button type="primary" onClick={onClick} disabled={disabled}>
        {cta}
      </Button>
    </div>
  )
}

export function TrustBanner({ compact = false }: { compact?: boolean }) {
  return (
    <Alert
      className={compact ? 'billing-trust-banner billing-trust-banner--compact' : 'billing-trust-banner'}
      showIcon
      icon={<InfoCircleOutlined />}
      message="Secure checkout, live billing data, and clear renewal details before you confirm."
      type="info"
    />
  )
}
