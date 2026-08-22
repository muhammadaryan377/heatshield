import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AddWorkerPage } from './pages/AddWorkerPage'
import { BuildQueuePage } from './pages/BuildQueuePage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SiteIntelligencePage />} />
        <Route path="/workers/new" element={<AddWorkerPage />} />
        <Route path="/plan" element={<BuildQueuePage />} />
        <Route path="/sites" element={<SiteIntelligencePage />} />
        <Route path="/reports" element={<BuildQueuePage />} />
        <Route path="/settings" element={<BuildQueuePage />} />
      </Routes>
    </BrowserRouter>
  )
}
