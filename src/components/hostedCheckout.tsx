import React, { useEffect } from 'react'
import { Result } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'

const APP_PATH = import.meta.env.BASE_URL

export default function HostedCheckout() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const session = searchParams.get('session')
    const planId = searchParams.get('planId')
    const productId = searchParams.get('productId')

    if (!session) {
      return
    }

    const redirectParams = new URLSearchParams()
    redirectParams.set('autoOpen', '1')

    if (planId) {
      redirectParams.set('planId', planId)
    }

    if (productId) {
      redirectParams.set('productId', productId)
    }

    navigate(
      `${APP_PATH}session-result?session=${encodeURIComponent(session)}&redirect=${encodeURIComponent(
        `${APP_PATH}plans?${redirectParams.toString()}`
      )}`,
      { replace: true }
    )
  }, [navigate, searchParams])

  return <Result title="Preparing checkout..." subTitle="Signing you in to the billing portal." />
}
