import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseCatalog } from '../data/catalog'
import { CatalogProvider } from '../data/CatalogProvider'
import { RAW } from '../test/fixtures'
import { Menu } from './Menu'
import { ShopFacts } from './ShopFacts'

const ready = () => Promise.resolve(parseCatalog(RAW))

describe('Menu', () => {
  it('lists each service with its duration and price', async () => {
    render(
      <CatalogProvider load={ready}>
        <Menu />
      </CatalogProvider>,
    )

    const services = within(await screen.findByRole('list', { name: 'Serviços' }))
    const barba = services.getByText('Barba').closest('li')
    expect(barba).toHaveTextContent('Na navalha.')
    expect(barba).toHaveTextContent('30 min')
    expect(barba).toHaveTextContent('R$ 40')
    expect(services.getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows each barber with what they do and the days they work', async () => {
    render(
      <CatalogProvider load={ready}>
        <Menu />
      </CatalogProvider>,
    )

    const ana = (await screen.findByRole('heading', { name: 'Ana' })).closest('li')
    expect(ana).toHaveTextContent('Barba.')
    expect(ana).toHaveTextContent('ter, qua')
  })

  it('says it is loading, then shows the menu', async () => {
    render(
      <CatalogProvider load={ready}>
        <Menu />
      </CatalogProvider>,
    )

    expect(screen.getAllByText(/carregando/i).length).toBeGreaterThan(0)
    await screen.findByRole('list', { name: 'Serviços' })
    expect(screen.queryByText(/carregando/i)).not.toBeInTheDocument()
  })

  it('says so when the menu cannot be loaded', async () => {
    render(
      <CatalogProvider load={() => Promise.reject(new Error('offline'))}>
        <Menu />
      </CatalogProvider>,
    )

    expect((await screen.findAllByText(/não deu para carregar/i)).length).toBeGreaterThan(0)
  })

  it('says so when the page has no data source', () => {
    render(
      <CatalogProvider load={null}>
        <Menu />
      </CatalogProvider>,
    )

    expect(screen.getAllByText(/não deu para carregar/i).length).toBeGreaterThan(0)
  })
})

describe('ShopFacts', () => {
  it('counts barbers and services and says which days the shop opens', async () => {
    render(
      <CatalogProvider load={ready}>
        <ShopFacts />
      </CatalogProvider>,
    )

    const facts = within(await screen.findByRole('list', { name: 'A barbearia' }))
    expect(facts.getByText('2 barbeiros')).toBeInTheDocument()
    expect(facts.getByText('2 serviços')).toBeInTheDocument()
    expect(facts.getByText('ter, qua, sáb')).toBeInTheDocument()
  })
})
