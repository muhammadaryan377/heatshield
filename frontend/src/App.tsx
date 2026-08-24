import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'
import { RouteEffects } from './components/app/RouteEffects'
import { AddWorkerPage } from './pages/AddWorkerPage'
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
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { NotFoundPage } from './pages/NotFoundPage'
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

          <Route path="/agriculture" element={<AgricultureOverviewPage />} />
          <Route path="/agriculture/farms" element={<AgricultureFarmsPage />} />
          <Route path="/agriculture/fields" element={<AgricultureFieldsPage />} />
          <Route path="/agriculture/crop-heat-stress" element={<AgricultureCropHeatStressPage />} />
          <Route path="/agriculture/irrigation" element={<AgricultureIrrigationPlannerPage />} />
          <Route path="/agriculture/field-work" element={<AgricultureFieldWorkPlannerPage />} />
          <Route path="/agriculture/alerts" element={<AgricultureAlertsPage />} />
          <Route path="/agriculture/*" element={<NotFoundPage />} />

          <Route path="/urban" element={<UrbanOverviewPage />} />
          <Route path="/urban/districts" element={<UrbanDistrictsPage />} />
          <Route path="/urban/heat-islands" element={<UrbanHeatIslandsPage />} />
          <Route path="/urban/analysis" element={<UrbanAnalysisPage />} />
          <Route path="/urban/interventions" element={<UrbanInterventionsPage />} />
          <Route path="/urban/before-after" element={<UrbanBeforeAfterPage />} />
          <Route path="/urban/*" element={<NotFoundPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}
