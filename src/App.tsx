import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CityProvider } from './config/CityContext'
import { DashboardPage } from './pages/DashboardPage'
import { AddPurchasePage } from './pages/AddPurchasePage'
import { ProductPage } from './pages/ProductPage'
import { StoresPage } from './pages/StoresPage'

export function App() {
  return (
    <CityProvider>
      <MemoryRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/add" element={<AddPurchasePage />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/stores" element={<StoresPage />} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    </CityProvider>
  )
}
