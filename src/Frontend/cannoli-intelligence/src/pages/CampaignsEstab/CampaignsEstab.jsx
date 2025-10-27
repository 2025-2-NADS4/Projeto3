import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import Sidebar from "../../components/Sidebar";
import Header from "../../components/Header";
import "./campaigns.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

const API_BASE = "http://localhost:3000";

export default function CampaignsEstab() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");
  const [campanhaId, setCampanhaId] = useState("");
  const [lojaNome, setLojaNome] = useState("Estabelecimento");
  const [kpis, setKpis] = useState({});
  const [statusData, setStatusData] = useState([]);
  const [badgeData, setBadgeData] = useState([]);
  const [mesData, setMesData] = useState([]);
  const [filtros, setFiltros] = useState({ campanhas: [], mesesDisponiveis: [] });

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/estabelecimento/campanhas`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const { meta, kpis, graficos, filtros } = res.data;

      setLojaNome(meta?.loja?.nome || "Estabelecimento");
      setKpis(kpis || {});
      setStatusData(graficos?.status || []);
      setBadgeData(graficos?.badges || []);
      setMesData(graficos?.meses || []);
      setFiltros(filtros || {});

      // Preenche período automaticamente na 1ª carga
      if (!mesInicio && filtros?.mesesDisponiveis?.length) {
        setMesInicio(filtros.mesesDisponiveis[0]);
      }
      if (!mesFim && filtros?.mesesDisponiveis?.length) {
        setMesFim(filtros.mesesDisponiveis.at(-1));
      }
      setErr("");
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.erro || "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  // 1ª carga
  useEffect(() => {
    fetchData({});
  }, []);

  // Recarrega ao mudar filtros
  useEffect(() => {
    if (mesInicio || mesFim || campanhaId) {
      fetchData({ mesInicio, mesFim, campanhaId });
    }
  }, [mesInicio, mesFim, campanhaId]);

  const accent = "#ff7a00";
  const rail = "#1f2835";

  const chartStatus = useMemo(
    () => ({
      labels: statusData.map((s) => s.status_desc),
      datasets: [
        { label: "Qtd", data: statusData.map((s) => s.qtd), backgroundColor: accent, borderRadius: 8 },
      ],
    }),
    [statusData]
  );

  const chartBadge = useMemo(() => {
    const sorted = [...badgeData].sort((a, b) => b.qtd - a.qtd);
    const top8 = sorted.slice(0, 8);
    const others = sorted.slice(8).reduce((sum, r) => sum + r.qtd, 0);
    const labels = top8.map((b) => b.badge);
    const values = top8.map((b) => b.qtd);
    if (others > 0) {
      labels.push("Outros");
      values.push(others);
    }
    return {
      labels,
      datasets: [{ label: "Qtd", data: values, backgroundColor: accent, borderRadius: 8 }],
    };
  }, [badgeData]);

  const chartMes = useMemo(
    () => ({
      labels: mesData.map((m) => m.mes),
      datasets: [
        {
          label: "Qtd",
          data: mesData.map((m) => m.qtd),
          borderColor: accent,
          backgroundColor: "rgba(255,122,0,.2)",
          fill: true,
          tension: 0.35,
        },
      ],
    }),
    [mesData]
  );

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: "#cdd6e4" } },
      y: { grid: { color: rail }, ticks: { color: "#cdd6e4" }, beginAtZero: true },
    },
    plugins: { legend: { labels: { color: "#cdd6e4" } } },
  };

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <Header title={`Dashboard • Campanhas (${lojaNome})`} />

        <div className="filters-bar">
          <div className="field">
            <label>Campanha</label>
            <select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}>
              <option value="">Todas</option>
              {filtros.campanhas?.map((c, i) => (
                <option key={i} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Mês inicial</label>
            <select value={mesInicio} onChange={(e) => setMesInicio(e.target.value)}>
              {filtros.mesesDisponiveis?.map((m, i) => (
                <option key={i} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Mês final</label>
            <select value={mesFim} onChange={(e) => setMesFim(e.target.value)}>
              {filtros.mesesDisponiveis?.map((m, i) => (
                <option key={i} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {err && <div className="error">{err}</div>}
        {loading && <div className="loading">Carregando…</div>}

        <section className="kpis">
          <div className="kpi">
            <div className="kpi_title">Total de campanhas</div>
            <div className="kpi_value">{kpis.total ?? "—"}</div>
            <div className="kpi_hint">
              Período: {mesInicio || "—"} — {mesFim || "—"}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi_title">Ativas</div>
            <div className="kpi_value">{kpis.ativas ?? "—"}</div>
            <div className="kpi_hint">{kpis.ativasPct ?? 0}% do total</div>
          </div>
          <div className="kpi">
            <div className="kpi_title">Concluídas</div>
            <div className="kpi_value">{kpis.concluidas ?? "—"}</div>
            <div className="kpi_hint">{kpis.concluidasPct ?? 0}% do total</div>
          </div>
          <div className="kpi">
            <div className="kpi_title">Novas no período</div>
            <div className="kpi_value">{kpis.novasPeriodo ?? "—"}</div>
            <div className="kpi_hint">{mesInicio || mesFim ? "filtrado" : "—"}</div>
          </div>
        </section>

        <div className="grid2">
          <div className="panel">
            <div className="panel_title">Campanhas por status</div>
            <div className="chartbox">
              <Bar data={chartStatus} options={opts} />
            </div>
          </div>
          <div className="panel">
            <div className="panel_title">Campanhas por badge (Top 8 + Outros)</div>
            <div className="chartbox">
              <Bar data={chartBadge} options={opts} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel_title">Campanhas por mês</div>
          <div className="chartbox tall">
            <Line data={chartMes} options={opts} />
          </div>
        </div>
      </div>
    </div>
  );
}