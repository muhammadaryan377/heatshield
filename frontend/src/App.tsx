import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { HeatHistoryPage } from './pages/HeatHistoryPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'
import { SitesPage } from './pages/SitesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SiteIntelligencePage />} />
        <Route path="/workers/new" element={<AddWorkerPage />} />
        <Route path="/plan" element={<GeneratePlanPage />} />
        <Route path="/sites" element={<SitesPage />} />
        <Route path="/heat-history" element={<HeatHistoryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
