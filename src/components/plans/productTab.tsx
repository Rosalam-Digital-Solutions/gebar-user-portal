import { getSublistReq } from '@/requests'
import { IProduct, ISubAddon, ISubscription } from '@/shared.types'
import { LoadingOutlined, StarOutlined } from '@ant-design/icons'
import { Spin, Tabs, message } from 'antd'
import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MainPlanList from './mainPlanList'

const Index = ({ productList }: { productList: IProduct[] }) => {
  const getDefaultProductId = (products: IProduct[]) => {
    const firstRealProduct = products.find((product) => product.id !== 0)
    return (firstRealProduct ?? products[0])?.id?.toString() ?? '0'
  }

  const [searchParams, setSearchParams] = useSearchParams()
  const targetPlanId = Number(searchParams.get('planId') ?? '0') || undefined
  const autoOpen = searchParams.get('autoOpen') === '1'
  // const [productList, setProductList] = useState<IProduct[]>([])
  const [loading, setLoading] = useState(false)
  // const appConfigStore = useAppConfigStore();
  const [productId, setProductId] = useState(
    searchParams.get('productId') ?? getDefaultProductId(productList)
  ) // set default tab
  const [subList, setSubList] = useState<ISubscription[]>([])

  const updateQuery = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value == null || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    setSearchParams(next)
  }

  const fetchData = async () => {
    setLoading(true)
    const [subs, subErr] = await getSublistReq()
    setLoading(false)
    if (null != subErr) {
      message.error(subErr.message)
      return
    }
    setSubList(
      subs == null
        ? []
        : subs.map((sub: ISubscription & { addonParams: ISubAddon[] }) => {
            // const { id, status, planId, productId } = s.subscription
            // return { id, status, planId, productId }
            const activeSub = { ...sub.subscription }
            ;(activeSub as ISubscription).addons = sub.addonParams
            // setActiveSub(localActiveSub)
            // setSelectedPlan(sub.subscription.planId)
            return activeSub
          })
    )
  }

  const onTabChange = (newActiveKey: string) => {
    setProductId(newActiveKey)
    updateQuery({ productId: newActiveKey })
  }

  const activateProductTab = (newProductId: number) => {
    const nextProductId = newProductId.toString()
    if (productId === nextProductId) {
      return
    }
    setProductId(nextProductId)
    updateQuery({ productId: nextProductId })
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (productList.length > 0 && (productId === '0' || productId === '')) {
      const nextProductId = getDefaultProductId(productList)
      setProductId(nextProductId)
      updateQuery({ productId: nextProductId })
    }
  }, [productId, productList])

  return (
    <div>
      <Spin
        spinning={loading}
        indicator={<LoadingOutlined style={{ fontSize: 32 }} spin />}
      >
        <Tabs
          activeKey={productId}
          items={productList.map((p) => ({
            label: p.productName,
            key: p.id.toString(),
            children: (
              <MainPlanList
                productId={p.id}
                activeSub={subList.find((s) => s.productId == p.id)}
                targetPlanId={targetPlanId}
                autoOpen={autoOpen}
                isActiveProduct={productId === p.id.toString()}
                activateProductTab={activateProductTab}
              />
            ),
            icon:
              subList.find((s) => s.productId == p.id) != null ? (
                <StarOutlined />
              ) : null
          }))}
          onChange={onTabChange}
        />
      </Spin>
    </div>
  )
}

export default Index
