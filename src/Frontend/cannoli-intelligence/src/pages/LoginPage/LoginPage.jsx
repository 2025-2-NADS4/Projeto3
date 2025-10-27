import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./login.css";
import logoCannoli from "../../assets/img/logo_cannoli.jpg"; 

const url = "http://localhost:3000/auth"; 

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const inputs = document.querySelectorAll(".input");
    function addFocus() {
      const parent = this.parentNode?.parentNode;
      if (parent) parent.classList.add("focus");
    }
    function removeFocus() {
      const parent = this.parentNode?.parentNode;
      if (parent && this.value === "") parent.classList.remove("focus");
    }
    inputs.forEach((i) => {
      i.addEventListener("focus", addFocus);
      i.addEventListener("blur", removeFocus);
    });
    return () => {
      inputs.forEach((i) => {
        i.removeEventListener("focus", addFocus);
        i.removeEventListener("blur", removeFocus);
      });
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (loading) return;

    setMessage("");
    setLoading(true);

    axios
      .post(`${url}/login`, { email, senha })
      .then((res) => {
        if (res.status === 200) {
          const { perfil, token } = res.data;
          localStorage.setItem("userToken", token);
          setMessage("Login realizado com sucesso!");
          setMessageType("success");

          setTimeout(() => {
            if (perfil === "ADMIN") {
              navigate("/");
            } else if (perfil === "ESTABELECIMENTO") {
              navigate("/dashboardLoja");
            } else {
              navigate("/dashboard");
            }
          }, 800);
        }
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          setMessage("Email ou senha incorreta!");
          setMessageType("error");
        } else {
          setMessage("Ocorreu um erro. Tente novamente mais tarde.");
          setMessageType("error");
        }
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="center">
      <div className="card" role="dialog" aria-labelledby="title" aria-describedby="subtitle">
        <div className="brand">
          <img src={logoCannoli} alt="Logo Cannoli Intelligence" />
          <div className="txt">
            <h1 id="title">Cannoli</h1>
            <small>Intelligence</small>
          </div>
        </div>

        <div className="headline">
          <h2>
            Bem-vindo de volta <span aria-hidden="true">👋</span>
          </h2>
          <p id="subtitle">Faça login para acessar o painel do Cannoli Intelligence</p>
        </div>

        {message && <div className={`error ${messageType === "success" ? "ok" : ""}`} style={{ display: "block" }}>{message}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            className="input"
            placeholder="voce@empresa.com"
            autoComplete="username"
            required
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="senha">Senha</label>
          <input
            id="senha"
            name="senha"
            type="password"
            className="input"
            placeholder="••••••••"
            autoComplete="current-password"
            minLength={6}
            required
            onChange={(e) => setSenha(e.target.value)}
          />

          <div className="row-inline">
            <label className="remember">
              <input type="checkbox" id="remember" /> Lembrar de mim
            </label>
            <a className="link" href="#">Esqueceu sua senha?</a>
          </div>

          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
