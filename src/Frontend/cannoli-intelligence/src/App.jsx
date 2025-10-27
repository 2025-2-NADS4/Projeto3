import { useState } from 'react'
import LoginPage from "./pages/LoginPage/LoginPage";
import { Routes, Route, Navigate } from "react-router-dom";
import './App.css'
import "./styles.css";


function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
            </Routes>
        </div>
    </>
  )
}

export default App