import { useState } from 'react'
import LoginPage from "./pages/LoginPage/LoginPage";
import { Routes, Route, Navigate } from "react-router-dom";
import CampaignsEstab from "./pages/Campaigns/CampaignsEstab";
import CampaignsAdmin from './pages/Campaigns/CampaignsAdmin';
import CampaignQueueEstab from './pages/CampaignQueue/CampaignQueueEstab';
import CampaignQueueAdmin from './pages/CampaignQueue/CampaignQueueAdmin';
import CustomersEstab from './pages/Customers/CustomersEstab';
import CustomersAdmin from './pages/Customers/CustomersAdmin';
import OrdersEstab from './pages/Orders/OrdersEstab';
import OrdersAdmin from './pages/Orders/OrdersAdmin';
import AdminOverview from './pages/Admin/AdminOverview';

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
                <Route path="/clientes/estab" element={<CustomersEstab />} />
                <Route path="/clientes/admin" element={<CustomersAdmin />} />
                <Route path="/pedidos/estab" element={<OrdersEstab />} />
                <Route path="/pedidos/admin" element={<OrdersAdmin />} />
                <Route path="/overview/admin" element={<AdminOverview />} />
            </Routes>
        </div>
    </>
  )
}

export default App