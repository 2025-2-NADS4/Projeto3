import { useState } from 'react'
import LoginPage from "./pages/LoginPage/LoginPage";
import { Routes, Route, Navigate } from "react-router-dom";
import CampaignsEstab from "./pages/CampaignsEstab/CampaignsEstab";
import CampaignsAdmin from './pages/CampaignsAdmin/CampaignsAdmin';
import CampaignQueueEstab from './pages/CampaignQueueEstab/CampaignQueueEstab';
import CampaignQueueAdmin from './pages/CampaignQueueAdmin/CampaignQueueAdmin';

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
            <Routes>
                <Route path="/" element={<LoginPage />} />
                <Route path="/campanhas/estab" element={<CampaignsEstab />} />
                <Route path="/campanhas/admin" element={<CampaignsAdmin />} />
                <Route path="/queue/estab" element={<CampaignQueueEstab />} />
                <Route path="/queue/admin" element={<CampaignQueueAdmin />} />
            </Routes>
        </div>
    </>
  )
}

export default App