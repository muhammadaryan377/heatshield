import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { RouteEffects } from './components/app/RouteEffects'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { AgenticOperationsPage } from './pages/AgenticOperationsPage'
import { AgricultureAlertsPage } from './pages/AgricultureAlertsPage'
import { AgricultureCropHeatStressPage } from './pages/AgricultureCropHeatStressPage'
import { AgricultureFarmsPage } from './pages/AgricultureFarmsPage'
import { AgricultureFieldsPage } from './pages/AgricultureFieldsPage'
import { AgricultureFieldWorkPlannerPage } from './pages/AgricultureFieldWorkPlannerPage'
import { AgricultureIrrigationPlannerPage } from './pages/AgricultureIrrigationPlannerPage'
import { AgricultureOverviewPage } from './pages/AgricultureOverviewPage'
import { EnterpriseAssetsPage } from './pages/EnterpriseAssetsPage'
import { EnterpriseHeatRiskReportsPage } from './pages/EnterpriseHeatRiskReportsPage'
import { EnterpriseIndustrialPage } from './pages/EnterpriseIndustrialPage'
import { EnterpriseOverviewPage } from './pages/EnterpriseOverviewPage'
import { EnterprisePortfolioRiskPage } from './pages/EnterprisePortfolioRiskPage'
import { EnterprisePropertyExposurePage } from './pages/EnterprisePropertyExposurePage'
import { EnterpriseSitesPage } from './pages/EnterpriseSitesPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlatformReadinessPage } from './pages/PlatformReadinessPage'
import { ReportsPage } from './pages/ReportsPage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'
import { SitesPage } from './pages/SitesPage'
import { UrbanAnalysisPage } from './pages/UrbanAnalysisPage'
import { UrbanBeforeAfterPage } from './pages/UrbanBeforeAfterPage'
import { UrbanDistrictsPage } from './pages/UrbanDistrictsPage'
import { UrbanHeatIslandsPage } from './pages/UrbanHeatIslandsPage'
import { UrbanInterventionsPage } from './pages/UrbanInterventionsPage'
import { UrbanOverviewPage } from './pages/UrbanOverviewPage'
import './agriculture-polish.css'

const AGRICULTURE_FARM_STORAGE_KEY = 'heatshield:selected-agriculture-farm'
const URBAN_DISTRICT_STORAGE_KEY = 'heatshield:selected-urban-district'

function RootRoute() {
  const location = useLocation()
  const siteId = new URLSearchParams(location.search).get('site')
  if (siteId) return <Navigate to={`/workforce?site=${encodeURIComponent(siteId)}`} replace />
  return <ModuleSelectionPage />
}

function AgricultureContextRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const search = new URLSearchParams(location.search)
  const requestedFarm = search.get('farm')
  const storedFarm = typeof window !== 'undefined' ? window.localStorage.getItem(AGRICULTURE_FARM_STORAGE_KEY) : null

  if (!requestedFarm && storedFarm) {
    search.set('farm', storedFarm)
    const query = search.toString()
    return <Navigate to={`${location.pathname}${query ? `?${query}` : ''}`} replace />
  }

  return children
}

function UrbanContextRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const search = new URLSearchParams(location.search)
  const requestedDistrict = search.get('district')
  const storedDistrict = typeof window !== 'undefined' ? window.localStorage.getItem(URBAN_DISTRICT_STORAGE_KEY) : null

  if (!requestedDistrict && storedDistrict) {
    search.set('district', storedDistrict)
    const query = search.toString()
    return <Navigate to={`${location.pathname}${query ? `?${query}` : ''}`} replace />
  }

  return children
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <RouteEffects />
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/platform-readiness" element={<PlatformReadinessPage />} />

          <Route path="/workforce" element={<SiteIntelligencePage />} />
          <Route path="/workers/new" element={<AddWorkerPage />} />
          <Route path="/add-worker" element={<AddWorkerPage />} />
          <Route path="/plan" element={<AgenticOperationsPage />} />
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

          <Route path="/agriculture" element={<AgricultureContextRoute><AgricultureOverviewPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/farms" element={<AgricultureContextRoute><AgricultureFarmsPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/fields" element={<AgricultureContextRoute><AgricultureFieldsPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/crop-heat-stress" element={<AgricultureContextRoute><AgricultureCropHeatStressPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/irrigation" element={<AgricultureContextRoute><AgricultureIrrigationPlannerPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/field-work" element={<AgricultureContextRoute><AgricultureFieldWorkPlannerPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/alerts" element={<AgricultureContextRoute><AgricultureAlertsPage /></AgricultureContextRoute>} />
          <Route path="/agriculture/*" element={<NotFoundPage />} />

          <Route path="/urban" element={<UrbanContextRoute><UrbanOverviewPage /></UrbanContextRoute>} />
          <Route path="/urban/districts" element={<UrbanContextRoute><UrbanDistrictsPage /></UrbanContextRoute>} />
          <Route path="/urban/heat-islands" element={<UrbanContextRoute><UrbanHeatIslandsPage /></UrbanContextRoute>} />
          <Route path="/urban/analysis" element={<UrbanContextRoute><UrbanAnalysisPage /></UrbanContextRoute>} />
          <Route path="/urban/interventions" element={<UrbanContextRoute><UrbanInterventionsPage /></UrbanContextRoute>} />
          <Route path="/urban/before-after" element={<UrbanContextRoute><UrbanBeforeAfterPage /></UrbanContextRoute>} />
          <Route path="/urban/*" element={<NotFoundPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
