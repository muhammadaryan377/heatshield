import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { EnterpriseOverviewPage } from './pages/EnterpriseOverviewPage'
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ModuleLandingPage } from './pages/ModuleLandingPage'
import { ModuleSelectionPage } from './pages/ModuleSelectionPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'
import { SitesPage } from './pages/SitesPage'

const AgricultureOverviewPage = lazy(() => import('./pages/AgricultureOverviewPage').then((module) => ({ default: module.AgricultureOverviewPage })))
const AgricultureFarmsPage = lazy(() => import('./pages/AgricultureFarmsPage').then((module) => ({ default: module.AgricultureFarmsPage })))
const AgricultureFieldsPage = lazy(() => import('./pages/AgricultureFieldsPage').then((module) => ({ default: module.AgricultureFieldsPage })))
const AgricultureCropHeatStressPage = lazy(() => import('./pages/AgricultureCropHeatStressPage').then((module) => ({ default: module.AgricultureCropHeatStressPage })))
const AgricultureIrrigationPlannerPage = lazy(() => import('./pages/AgricultureIrrigationPlannerPage').then((module) => ({ default: module.AgricultureIrrigationPlannerPage })))
const AgricultureFieldWorkPlannerPage = lazy(() => import('./pages/AgricultureFieldWorkPlannerPage').then((module) => ({ default: module.AgricultureFieldWorkPlannerPage })))
const AgricultureAlertsPage = lazy(() => import('./pages/AgricultureAlertsPage').then((module) => ({ default: module.AgricultureAlertsPage })))

function AgricultureRouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f5f8f7', color: '#46605a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      Loading Agriculture Intelligence…
    </div>
  )
}

function agricultureRoute(element: React.ReactNode) {
  return <Suspense fallback={<AgricultureRouteFallback />}>{element}</Suspense>
}

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
        <Route path="/agriculture" element={agricultureRoute(<AgricultureOverviewPage />)} />
        <Route path="/agriculture/farms" element={agricultureRoute(<AgricultureFarmsPage />)} />
        <Route path="/agriculture/fields" element={agricultureRoute(<AgricultureFieldsPage />)} />
        <Route path="/agriculture/crop-heat-stress" element={agricultureRoute(<AgricultureCropHeatStressPage />)} />
        <Route path="/agriculture/irrigation" element={agricultureRoute(<AgricultureIrrigationPlannerPage />)} />
        <Route path="/agriculture/field-work" element={agricultureRoute(<AgricultureFieldWorkPlannerPage />)} />
        <Route path="/agriculture/alerts" element={agricultureRoute(<AgricultureAlertsPage />)} />
        <Route path="/agriculture/*" element={<ModuleLandingPage module="agriculture" />} />
        <Route path="/urban/*" element={<ModuleLandingPage module="urban" />} />

        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
