import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { BuildQueuePage } from './pages/BuildQueuePage'
import { SiteIntelligencePage } from './pages/SiteIntelligencePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SiteIntelligencePage />} />
        <Route path="/workers/new" element={<BuildQueuePage />} />
        <Route path="/plan" element={<BuildQueuePage />} />
        <Route path="/sites" element={<BuildQueuePage />} />
        <Route path="/reports" element={<BuildQueuePage />} />
        <Route path="/settings" element={<BuildQueuePage />} />
      </Routes>
    </BrowserRouter>
  )
}
