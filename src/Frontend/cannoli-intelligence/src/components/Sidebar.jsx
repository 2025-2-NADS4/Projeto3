import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import "./layout.css";
import logo from "../assets/img/logo-cannoli-intelligence.png";

export default function Sidebar() {
  const [perfil, setPerfil] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const tipo = (localStorage.getItem("userPerfil") || "").toLowerCase();
    setPerfil(tipo);
  }, []);

  function logout() {
    localStorage.removeItem("userToken");
    localStorage.removeItem("userPerfil");
    navigate("/");
  }

  const navClass = ({ isActive }) => "nav-item" + (isActive ? " active" : "");

  return (
    <aside className="sidebar">
      <div className="sidebar-brand" aria-label="Cannoli Intelligence">
        <img src={logo} alt="Cannoli Intelligence" className="sidebar-logo" />
      </div>

      <nav className="sidebar-nav">
        {perfil === "estabelecimento" && (
          <>
            <NavLink to="/campanhas/estab" className={navClass}>
              Campanhas
            </NavLink>
            <NavLink to="/queue/estab" className={navClass}>
              Engajamento das Mensagens
            </NavLink>
            <NavLink to="/clientes/estab" className={navClass}>
              Clientes
            </NavLink>
            <NavLink to="/pedidos/estab" className={navClass}>
              Pedidos
            </NavLink>
          </>
        )}

        {perfil === "admin" && (
          <>
            <NavLink to="/campanhas/admin" className={navClass}>
              Campanhas
            </NavLink>
            <NavLink to="/queue/admin" className={navClass}>
              Engajamento das Mensagens
            </NavLink>
            <NavLink to="/clientes/admin" className={navClass}>
              Clientes
            </NavLink>
            <NavLink to="/pedidos/admin" className={navClass}>
              Pedidos
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