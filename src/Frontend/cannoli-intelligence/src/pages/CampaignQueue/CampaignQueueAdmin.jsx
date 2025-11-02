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
import "../Campaigns/campaigns.css";

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

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

export default function CampaignQueueAdmin() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [lojaId, setLojaId] = useState("");
  const [mesInicio, setMesInicio] = useState("");
  const [mesFim, setMesFim] = useState("");

  const [kpis, setKpis] = useState({
    total: 0, taxaLeitura: 0, lidas: 0, pendentes: 0, enviadas: 0, baseLeitura: 0,
  });
  const [statusData, setStatusData] = useState([]);
  const [mesData, setMesData] = useState([]);
  const [topStores, setTopStores] = useState([]);

  const [filtros, setFiltros] = useState({
    lojas: [],
    mesesDisponiveis: [],
  });

  async function fetchData(params = {}) {
    setLoading(true);
    try {
      const token = localStorage.getItem("userToken");
      const res = await axios.get(`${API_BASE}/api/admin/campaignqueue`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      const { kpis, graficos, filtros } = res.data;

      setKpis(kpis || {});
      setStatusData(graficos?.status || []);
      setMesData(graficos?.meses || []);
      setTopStores(graficos?.topStores || []);
      setFiltros((prev) => ({
        ...prev,
        lojas: filtros?.lojas || [],
        mesesDisponiveis: filtros?.mesesDisponiveis || [],
      }));

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

  useEffect(() => { fetchData({}); }, []);
  useEffect(() => {
    if (mesInicio || mesFim || lojaId) fetchData({ lojaId, mesInicio, mesFim });
  }, [lojaId, mesInicio, mesFim]);

  const accent = "#ff7a00";
  const rail = "#1f2835";

  const chartStatus = useMemo(() => ({
    labels: statusData.map(s => s.status_desc),
    datasets: [{ label: "Qtd", data: statusData.map(s => s.qtd), backgroundColor: accent, borderRadius: 8 }]
  }), [statusData]);

  const chartMes = useMemo(() => ({
    labels: mesData.map(m => m.mes),
    datasets: [{
      label: "Mensagens",
      data: mesData.map(m => m.qtd),
      borderColor: accent,
      backgroundColor: "rgba(255,122,0,.2)",
      fill: true,
      tension: 0.35
    }]
  }), [mesData]);

  const chartTopStores = useMemo(() => ({
    labels: topStores.map(s => `${s.storeId} (${s.base})`),
    datasets: [{
      label: "Taxa de leitura (%)",
      data: topStores.map(s => s.taxa),
      backgroundColor: accent,
      borderRadius: 8
    }]
  }), [topStores]);

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: rail }, ticks: { color: "#cdd6e4" } },
      y: { grid: { color: rail }, ticks: { color: "#cdd6e4" }, beginAtZero: true }
    },
    plugins: { legend: { labels: { color: "#cdd6e4" } } }
  };

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <div className="wrap">
          <div className="topbar">
            <h1>Dashboard - CampaignQueue (Admin)</h1>
            <div className="filters">
              <div className="field">
                <label>Estabelecimento (storeId)</label>
                <select value={lojaId} onChange={e => setLojaId(e.target.value)}>
                  <option value="">Todos</option>
                  {filtros.lojas?.map((id, i) => <option key={i} value={id}>{id}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Mês inicial</label>
                <select value={mesInicio} onChange={e => setMesInicio(e.target.value)}>
                  {filtros.mesesDisponiveis?.map((m, i) => <option key={i} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Mês final</label>
                <select value={mesFim} onChange={e => setMesFim(e.target.value)}>
                  {filtros.mesesDisponiveis?.map((m, i) => <option key={i} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>

          {err && <div className="errorBox">{err}</div>}
          {loading && <div className="errorBox">Carregando…</div>}

          <section className="kpis">
            <div className="kpi">
              <div className="kpi_title">Mensagens total</div>
              <div className="kpi_value">{kpis.total ?? "—"}</div>
              <div className="kpi_hint">Base leitura: {kpis.baseLeitura ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Taxa de leitura</div>
              <div className="kpi_value">{kpis.taxaLeitura ?? 0}%</div>
              <div className="kpi_hint">Leitura = Lidas/Base</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Lidas</div>
              <div className="kpi_value">{kpis.lidas ?? 0}</div>
              <div className="kpi_hint">Mensagens visualizadas</div>
            </div>
            <div className="kpi">
              <div className="kpi_title">Pendentes</div>
              <div className="kpi_value">{kpis.pendentes ?? 0}</div>
              <div className="kpi_hint">Aguardando leitura/envio</div>
            </div>
          </section>

          <div className="grid2">
            <div className="panel">
              <div className="panel_title">Mensagens por status</div>
              <div className="chartbox">
                <Bar data={chartStatus} options={opts} />
              </div>
            </div>
            <div className="panel">
              <div className="panel_title">Top lojas por taxa de leitura</div>
              <div className="chartbox">
                <Bar data={chartTopStores} options={opts} />
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel_title">Mensagens por mês</div>
            <div className="chartbox tall">
              <Line data={chartMes} options={opts} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}