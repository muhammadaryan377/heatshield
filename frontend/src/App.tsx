import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { BuildQueuePage } from './pages/BuildQueuePage'
import { GeneratePlanPage } from './pages/GeneratePlanPage'
import { ReportsPage } from './pages/ReportsPage'
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
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<BuildQueuePage />} />
      </Routes>
    </BrowserRouter>
  )
}
