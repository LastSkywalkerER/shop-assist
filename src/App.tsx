import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CityProvider } from './config/CityContext'
import { DashboardPage } from './pages/DashboardPage'
import { AddPurchasePage } from './pages/AddPurchasePage'
import { ProductPage } from './pages/ProductPage'
import { StoresPage } from './pages/StoresPage'
import { ExpensesPage } from './pages/ExpensesPage'
import { AddExpensePage } from './pages/AddExpensePage'
import { ExpenseDetailsPage } from './pages/ExpenseDetailsPage'
import { SplitGroupsPage } from './pages/SplitGroupsPage'
import { GroupSettlementPage } from './pages/GroupSettlementPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { SettingsPage } from './pages/SettingsPage'
import { ShoppingListPage } from './pages/ShoppingListPage'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div key={location.key} className="animate-page-enter flex-1 flex flex-col min-h-0 overflow-clip">
      <Routes>
        <Route path="/" element={<ExpensesPage />} />
        <Route path="/products" element={<DashboardPage />} />
        <Route path="/add" element={<AddPurchasePage />} />
        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/stores" element={<StoresPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/expenses/add" element={<AddExpensePage />} />
        <Route path="/expenses/settlement" element={<SplitGroupsPage />} />
        <Route path="/expenses/settlement/:groupId" element={<GroupSettlementPage />} />
        <Route path="/expenses/:id" element={<ExpenseDetailsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/shopping-list" element={<ShoppingListPage />} />
      </Routes>
    </div>
  )
}

export function App() {
  return (
    <CityProvider>
      <MemoryRouter>
        <AppShell>
          <AnimatedRoutes />
        </AppShell>
      </MemoryRouter>
    </CityProvider>
  )
}
