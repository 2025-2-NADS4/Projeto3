import { NavLink } from "react-router-dom";
import "./layout.css";
import logo from "../assets/img/logo_cannoli.jpg";

export default function Sidebar() {
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
        <NavLink to="/campanhas" className="nav-item">
          Campanhas
        </NavLink>
        <NavLink to="/clientes" className="nav-item">
          Clientes
        </NavLink>
        <NavLink to="/produtos" className="nav-item">
          Produtos
        </NavLink>
        <NavLink to="/feedbacks" className="nav-item">
          Feedbacks
        </NavLink>
      </nav>
    </aside>
  );
}