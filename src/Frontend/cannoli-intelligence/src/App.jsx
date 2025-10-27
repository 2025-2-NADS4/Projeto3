import { useState } from 'react'
import LoginPage from "./pages/LoginPage/LoginPage";
import { Routes, Route, Navigate } from "react-router-dom";
import CampaignsEstab from "./pages/CampaignsEstab/CampaignsEstab";
import './App.css'
import "./styles.css";


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
            <Routes>
                <Route path="/" element={<LoginPage />} />
                <Route path="/campanhas" element={<CampaignsEstab />} />
            </Routes>
        </div>
    </>
  )
}

export default App