import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { FortyGuardIntelligencePage } from './pages/FortyGuardIntelligencePage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SiteHeatIntelligencePage } from './pages/SiteHeatIntelligencePage'
import { SitesPage } from './pages/SitesPage'
import { UrbanAnalysisPage } from './pages/UrbanAnalysisPage'
import { UrbanBeforeAfterPage } from './pages/UrbanBeforeAfterPage'
import { UrbanDistrictsPage } from './pages/UrbanDistrictsPage'
import { UrbanHeatIslandsPage } from './pages/UrbanHeatIslandsPage'
import { UrbanInterventionsPage } from './pages/UrbanInterventionsPage'
import { UrbanOverviewPage } from './pages/UrbanOverviewPage'
import { WorkforceAuditPage } from './pages/WorkforceAuditPage'
import { WorkforceCommandCenterPage } from './pages/WorkforceCommandCenterPage'
import { WorkforceOperationsPage } from './pages/WorkforceOperationsPage'
import { WorkforcePage } from './pages/WorkforcePage'
import './agriculture-polish.css'

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <RouteEffects />
        <Routes>
          <Route path="/" element={<ModuleSelectionPage />} />

          <Route path="/workforce" element={<WorkforceCommandCenterPage />} />
          <Route path="/workforce/workers" element={<WorkforcePage />} />
          <Route path="/workforce/sites" element={<SitesPage />} />
          <Route path="/workforce/operations" element={<WorkforceOperationsPage />} />
          <Route path="/workforce/site-heat-intelligence" element={<SiteHeatIntelligencePage />} />
          <Route path="/workforce/reports" element={<WorkforceAuditPage />} />

          {/* Workforce legacy aliases: keep older bookmarks and cached links working. */}
          <Route path="/workforce/home" element={<Navigate to="/workforce" replace />} />
          <Route path="/workforce/workforce" element={<Navigate to="/workforce/workers" replace />} />
          <Route path="/workforce/add-worker" element={<Navigate to="/workers/new" replace />} />
          <Route path="/workforce/generate-plan" element={<Navigate to="/workforce/operations" replace />} />
          <Route path="/workforce/plan" element={<Navigate to="/workforce/operations" replace />} />
          <Route path="/workforce/historical-intelligence" element={<Navigate to="/workforce/site-heat-intelligence" replace />} />
          <Route path="/workforce/heat-history" element={<Navigate to="/workforce/site-heat-intelligence" replace />} />
          <Route path="/workforce/heat-reports" element={<Navigate to="/workforce/reports" replace />} />
          <Route path="/workforce/*" element={<Navigate to="/workforce" replace />} />

          <Route path="/workers/new" element={<AddWorkerPage />} />
          <Route path="/add-worker" element={<AddWorkerPage />} />
          <Route path="/plan" element={<WorkforceOperationsPage />} />
          <Route path="/sites" element={<SitesPage />} />
          <Route path="/historical-intelligence" element={<SiteHeatIntelligencePage />} />
          <Route path="/heat-history" element={<SiteHeatIntelligencePage />} />
          <Route path="/reports" element={<WorkforceAuditPage />} />

          <Route path="/enterprise" element={<EnterpriseOverviewPage />} />
          <Route path="/enterprise/sites" element={<EnterpriseSitesPage />} />
          <Route path="/enterprise/property-exposure" element={<EnterprisePropertyExposurePage />} />
          <Route path="/enterprise/assets" element={<EnterpriseAssetsPage />} />
          <Route path="/enterprise/industrial" element={<EnterpriseIndustrialPage />} />
          <Route path="/enterprise/portfolio-risk" element={<EnterprisePortfolioRiskPage />} />
          <Route path="/enterprise/reports" element={<EnterpriseHeatRiskReportsPage />} />
          <Route path="/enterprise/fortyguard-intelligence" element={<FortyGuardIntelligencePage />} />
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
