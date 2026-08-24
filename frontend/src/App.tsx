import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

const AddWorkerPage = lazy(() => import('./pages/AddWorkerPage').then((module) => ({ default: module.AddWorkerPage })))
const AgricultureAlertsPage = lazy(() => import('./pages/AgricultureAlertsPage').then((module) => ({ default: module.AgricultureAlertsPage })))
const AgricultureCropHeatStressPage = lazy(() => import('./pages/AgricultureCropHeatStressPage').then((module) => ({ default: module.AgricultureCropHeatStressPage })))
const AgricultureFarmsPage = lazy(() => import('./pages/AgricultureFarmsPage').then((module) => ({ default: module.AgricultureFarmsPage })))
const AgricultureFieldsPage = lazy(() => import('./pages/AgricultureFieldsPage').then((module) => ({ default: module.AgricultureFieldsPage })))
const AgricultureFieldWorkPlannerPage = lazy(() => import('./pages/AgricultureFieldWorkPlannerPage').then((module) => ({ default: module.AgricultureFieldWorkPlannerPage })))
const AgricultureIrrigationPlannerPage = lazy(() => import('./pages/AgricultureIrrigationPlannerPage').then((module) => ({ default: module.AgricultureIrrigationPlannerPage })))
const AgricultureOverviewPage = lazy(() => import('./pages/AgricultureOverviewPage').then((module) => ({ default: module.AgricultureOverviewPage })))
const EnterpriseOverviewPage = lazy(() => import('./pages/EnterpriseOverviewPage').then((module) => ({ default: module.EnterpriseOverviewPage })))
const GeneratePlanPage = lazy(() => import('./pages/GeneratePlanPage').then((module) => ({ default: module.GeneratePlanPage })))
const HeatHistoryPage = lazy(() => import('./pages/HeatHistoryPage').then((module) => ({ default: module.HeatHistoryPage })))
const ModuleLandingPage = lazy(() => import('./pages/ModuleLandingPage').then((module) => ({ default: module.ModuleLandingPage })))
const ModuleSelectionPage = lazy(() => import('./pages/ModuleSelectionPage').then((module) => ({ default: module.ModuleSelectionPage })))
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const SiteIntelligencePage = lazy(() => import('./pages/SiteIntelligencePage').then((module) => ({ default: module.SiteIntelligencePage })))
const SitesPage = lazy(() => import('./pages/SitesPage').then((module) => ({ default: module.SitesPage })))

function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f8f7', color: '#46605a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading HeatShield…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/agriculture/irrigation" element={<AgricultureIrrigationPlannerPage />} />
          <Route path="/agriculture/field-work" element={<AgricultureFieldWorkPlannerPage />} />
          <Route path="/agriculture/alerts" element={<AgricultureAlertsPage />} />
          <Route path="/agriculture/*" element={<ModuleLandingPage module="agriculture" />} />
          <Route path="/urban/*" element={<ModuleLandingPage module="urban" />} />

          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
