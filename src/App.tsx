import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CityProvider } from './config/CityContext'
import { DashboardPage } from './pages/DashboardPage'
import { AddPurchasePage } from './pages/AddPurchasePage'
import { ProductPage } from './pages/ProductPage'
import { StoresPage } from './pages/StoresPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { AddExpensePage } from './pages/AddExpensePage'
import { ExpenseDetailsPage } from './pages/ExpenseDetailsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShoppingListPage } from './pages/ShoppingListPage'

export function App() {
  return (
    <CityProvider>
      <MemoryRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<ExpensesPage />} />
            <Route path="/products" element={<DashboardPage />} />
            <Route path="/add" element={<AddPurchasePage />} />
            <Route path="/product/:id" element={<ProductPage />} />
            <Route path="/stores" element={<StoresPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/expenses/add" element={<AddExpensePage />} />
            <Route path="/expenses/:id" element={<ExpenseDetailsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/shopping-list" element={<ShoppingListPage />} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    </CityProvider>
  )
}
