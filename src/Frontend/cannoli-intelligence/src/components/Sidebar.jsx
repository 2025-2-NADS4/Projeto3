import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "./layout.css";
import logo from "../assets/img/logo_cannoli.jpg";

export default function Sidebar() {
  const [perfil, setPerfil] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    // Busca o perfil do usuário salvo no login
    const tipo = localStorage.getItem("userPerfil");
    if (tipo) setPerfil(tipo.toLowerCase());
  }, []);

  function logout() {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userPerfil");
    navigate("/");
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={logo} alt="Logo" className="sidebar-logo" />
        <div className="sidebar-title">
          <h2>Cannoli</h2>
          <small>Intelligence</small>
        </div>
      </div>
      
      <nav className="sidebar-nav">
        {perfil === "estabelecimento" && (
          <>
            <NavLink to="/campanhas/estab" className="nav-item">
              Campanhas
            </NavLink>
            <NavLink to="/queue/estab" className="nav-item">
              Engajamento das Mensagens
            </NavLink>
            <NavLink to="/clientes/estab" className="nav-item">
              Clientes
            </NavLink>
          </>
        )}

        {perfil === "admin" && (
          <>
            <NavLink to="/campanhas/admin" className="nav-item">
              Campanhas
            </NavLink>
            <NavLink to="/queue/admin" className="nav-item">
              Engajamento das Mensagens
            </NavLink>
            <NavLink to="/clientes/admin" className="nav-item">
              Clientes
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={logout}>
          Sair
        </button>
      </div>
    </aside>
  );
}
