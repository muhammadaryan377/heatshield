import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { RouteEffects } from './components/app/RouteEffects'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { EnterpriseAssetsPage } from './pages/EnterpriseAssetsPage'
import { EnterpriseHeatRiskReportsPage } from './pages/EnterpriseHeatRiskReportsPage'
import { EnterpriseIndustrialPage } from './pages/EnterpriseIndustrialPage'
import { EnterpriseOverviewPage } from './pages/EnterpriseOverviewPage'
import { EnterprisePortfolioRiskPage } from './pages/EnterprisePortfolioRiskPage'
import { EnterprisePropertyExposurePage } from './pages/EnterprisePropertyExposurePage'
import { EnterpriseSitesPage } from './pages/EnterpriseSitesPage'
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ModuleLandingPage } from './pages/ModuleLandingPage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReportsPage } from './pages/ReportsPage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'
import { SitesPage } from './pages/SitesPage'

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <RouteEffects />
        <Routes>
          <Route path="/" element={<ModuleSelectionPage />} />

          <Route path="/workforce" element={<SiteIntelligencePage />} />
          <Route path="/workers/new" element={<AddWorkerPage />} />
          <Route path="/add-worker" element={<AddWorkerPage />} />
          <Route path="/plan" element={<GeneratePlanPage />} />
          <Route path="/sites" element={<SitesPage />} />
          <Route path="/historical-intelligence" element={<HeatHistoryPage />} />
          <Route path="/heat-history" element={<HeatHistoryPage />} />
          <Route path="/reports" element={<ReportsPage />} />

          <Route path="/enterprise" element={<EnterpriseOverviewPage />} />
          <Route path="/enterprise/sites" element={<EnterpriseSitesPage />} />
          <Route path="/enterprise/property-exposure" element={<EnterprisePropertyExposurePage />} />
          <Route path="/enterprise/assets" element={<EnterpriseAssetsPage />} />
          <Route path="/enterprise/industrial" element={<EnterpriseIndustrialPage />} />
          <Route path="/enterprise/portfolio-risk" element={<EnterprisePortfolioRiskPage />} />
          <Route path="/enterprise/reports" element={<EnterpriseHeatRiskReportsPage />} />
          <Route path="/enterprise/*" element={<NotFoundPage />} />
          <Route path="/agriculture/*" element={<ModuleLandingPage module="agriculture" />} />
          <Route path="/urban/*" element={<ModuleLandingPage module="urban" />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
