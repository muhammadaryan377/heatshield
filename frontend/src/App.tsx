import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { AgricultureCropHeatStressPage } from './pages/AgricultureCropHeatStressPage'
import { AgricultureFarmsPage } from './pages/AgricultureFarmsPage'
import { AgricultureFieldsPage } from './pages/AgricultureFieldsPage'
import { AgricultureOverviewPage } from './pages/AgricultureOverviewPage'
import { EnterpriseOverviewPage } from './pages/EnterpriseOverviewPage'
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ModuleLandingPage } from './pages/ModuleLandingPage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'
import { SitesPage } from './pages/SitesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ModuleSelectionPage />} />

        <Route path="/workforce" element={<SiteIntelligencePage />} />
        <Route path="/workers/new" element={<AddWorkerPage />} />
        <Route path="/plan" element={<GeneratePlanPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/heat-history" element={<HeatHistoryPage />} />

        <Route path="/enterprise" element={<EnterpriseOverviewPage />} />
        <Route path="/enterprise/*" element={<ModuleLandingPage module="enterprise" />} />
        <Route path="/agriculture" element={<AgricultureOverviewPage />} />
        <Route path="/agriculture/farms" element={<AgricultureFarmsPage />} />
        <Route path="/agriculture/fields" element={<AgricultureFieldsPage />} />
        <Route path="/agriculture/crop-heat-stress" element={<AgricultureCropHeatStressPage />} />
        <Route path="/agriculture/*" element={<ModuleLandingPage module="agriculture" />} />
        <Route path="/urban/*" element={<ModuleLandingPage module="urban" />} />

        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
