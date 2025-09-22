# Cannoli Intelligence - IA/ML 
# - Geração de dados simulados de campanhas
# - IA Reativa: alertas de queda (média móvel e z-score)
# - ML Supervisionado: previsão de conversões (Regressão Linear)
# - Busca Gulosa: recomendação de alocação de orçamento

import os
import math
import json
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from datetime import datetime, timedelta

# Importações de ML
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

np.random.seed(42)

# Gerar dados simulados de campanhas 

def simulate_campaigns(n_campaigns=6, days=90):
    base_date = datetime.today().date() - timedelta(days=days-1)
    rows = []
    for cid in range(1, n_campaigns+1):
        nome = f"Campanha_{cid}"
        # perfis diferentes por campanha
        base_impr = np.random.randint(8_000, 30_000)
        base_ctr = np.random.uniform(0.03, 0.12)   # cliques/impressoes
        base_cr  = np.random.uniform(0.03, 0.18)   # conversoes/cliques
        cpc      = np.random.uniform(0.4, 1.8)     # custo por clique (R$)
        ticket   = np.random.uniform(20, 65)       # ticket médio (R$)

       
        for d in range(days):
            day = base_date + timedelta(days=d)
            saz  = 1 + 0.2*np.sin(2*math.pi*(d/7.0))  # semanal
            impr = int(np.random.normal(base_impr*saz, base_impr*0.08))
            impr = max(impr, 1000)
            clicks = int(impr * max(0.005, np.random.normal(base_ctr, 0.01)))
            convs  = int(clicks * max(0.01, np.random.normal(base_cr, 0.02)))
            cost   = round(clicks * max(0.1, np.random.normal(cpc, 0.15)), 2)
            rev    = round(convs * max(5, np.random.normal(ticket, 5)), 2)

            rows.append({
                "date": day,
                "campanhaId": cid,
                "nome": nome,
                "impressoes": impr,
                "cliques": clicks,
                "conversoes": convs,
                "custo": cost,
                "receita": rev
            })

        # insere queda  em 2 dias
        for drop_day in np.random.choice(range(days//3, days-2), size=2, replace=False):
            idx = (cid-1)*days + drop_day
            rows[idx]["cliques"] = max(1, rows[idx]["cliques"] // 3)
            rows[idx]["conversoes"] = max(0, rows[idx]["conversoes"] // 3)
            rows[idx]["receita"] = round(rows[idx]["receita"] * 0.35, 2)

    df = pd.DataFrame(rows)
    return df

df = simulate_campaigns(n_campaigns=6, days=90)

# Salvar CSV 
csv_path = "campanhas_simulado.csv"
df.to_csv(csv_path, index=False)

# IA Reativa – alertas de queda 

def rolling_alerts(frame, janela=7, queda_perc=0.3, metodo="media"):
    """
    Gera alertas quando o valor do dia fica abaixo de (1 - queda_perc)*media_movel.
    metodo: 'media' ou 'zscore'
    """
    alerts = []
    for cid, grp in frame.sort_values("date").groupby("campanhaId"):
        g = grp.copy()
        g["media_7_cliques"] = g["cliques"].rolling(janela).mean()
        g["media_7_conv"] = g["conversoes"].rolling(janela).mean()
        g["z_cliques"] = (g["cliques"] - g["cliques"].rolling(janela).mean()) / (g["cliques"].rolling(janela).std()+1e-9)

        for i, row in g.iterrows():
            if pd.isna(row["media_7_cliques"]):
                continue
            motivo = None
            if metodo == "media":
                if row["cliques"] < (1-queda_perc) * row["media_7_cliques"]:
                    motivo = f"Cliques {row['cliques']} abaixo de {(1-queda_perc)*row['media_7_cliques']:.0f} (média 7d)"
            else:  
                if row["z_cliques"] < -2.0:
                    motivo = f"Z-score cliques = {row['z_cliques']:.2f} (< -2σ)"

            if motivo:
                alerts.append({
                    "date": row["date"],
                    "campanhaId": int(row["campanhaId"]),
                    "nome": row["nome"],
                    "motivo": motivo
                })
    return pd.DataFrame(alerts).sort_values(["date","campanhaId"])

alerts_df = rolling_alerts(df, janela=7, queda_perc=0.3, metodo="media")
alerts_path = "alertas_queda.csv"
alerts_df.to_csv(alerts_path, index=False)


ex_cid = df["campanhaId"].iloc[0]
serie = df[df.campanhaId==ex_cid].sort_values("date")
serie["mm7"] = serie["cliques"].rolling(7).mean()

plt.figure(figsize=(9,4))
plt.plot(serie["date"], serie["cliques"], label="Cliques")
plt.plot(serie["date"], serie["mm7"], label="Média móvel 7d")
drops = alerts_df[alerts_df.campanhaId==ex_cid]["date"]
plt.scatter(drops, serie[serie["date"].isin(drops)]["cliques"])
plt.title(f"Campanha {ex_cid} – cliques e média móvel")
plt.xlabel("Data"); plt.ylabel("Cliques"); plt.legend()
plot_alerts_path = "alertas.png"
plt.tight_layout(); plt.savefig(plot_alerts_path); plt.close()

# ML – previsão de conversões 

# Features de ontem para prever conversões de hoje (por campanha)
df_sorted = df.sort_values(["campanhaId","date"]).copy()
df_sorted["cliques_lag1"] = df_sorted.groupby("campanhaId")["cliques"].shift(1)
df_sorted["impressoes_lag1"] = df_sorted.groupby("campanhaId")["impressoes"].shift(1)
df_sorted["custo_lag1"] = df_sorted.groupby("campanhaId")["custo"].shift(1)
df_sorted["receita_lag1"] = df_sorted.groupby("campanhaId")["receita"].shift(1)

model_df = df_sorted.dropna().copy()
X = model_df[["cliques_lag1","impressoes_lag1","custo_lag1","receita_lag1"]].values
y = model_df["conversoes"].values

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, shuffle=True, random_state=42)
reg = LinearRegression()
reg.fit(X_train, y_train)
y_pred = reg.predict(X_test)

mae = mean_absolute_error(y_test, y_pred)
rmse = math.sqrt(mean_squared_error(y_test, y_pred))
r2 = r2_score(y_test, y_pred)

metrics = {"MAE": mae, "RMSE": rmse, "R2": r2}

# real vs previsto (amostra)
plt.figure(figsize=(6,6))
plt.scatter(y_test, y_pred, s=12)
plt.plot([y_test.min(), y_test.max()], [y_test.min(), y_test.max()])
plt.title("Previsão de conversões – Real vs Previsto")
plt.xlabel("Real"); plt.ylabel("Previsto")
plot_reg_path = "regressao.png"
plt.tight_layout(); plt.savefig(plot_reg_path); plt.close()

# Busca Gulosa – recomendação de orçamento 

def greedy_recommend(df_ref, data_referencia=None, k=3, orcamento=1000.0, modo="eficiencia"):
    """
    Seleciona top-K campanhas por eficiência e aloca orçamento gulosamente.
    modo: 'eficiencia' (conversoes/custo) ou 'roi' (receita/custo)
    """
    if data_referencia is None:
        data_referencia = df_ref["date"].max()
    snap = df_ref[df_ref["date"]==data_referencia].copy()

    eps = 1e-6
    if modo=="roi":
        snap["score"] = snap["receita"] / (snap["custo"] + eps)
    else:
        snap["score"] = snap["conversoes"] / (snap["custo"] + eps)

    ranked = snap.sort_values("score", ascending=False).reset_index(drop=True)

    # Top-K recomendadas
    priorizar = ranked.head(k).copy()

    # Alocação gulosa de orçamento (até custo diário atual)
    restante = orcamento
    aloc = []
    for _, row in priorizar.iterrows():
        if restante <= 0: break
        sugerido = min(restante, max(100.0, row["custo"]*0.5))  # política simples
        aloc.append({
            "campanhaId": int(row["campanhaId"]),
            "nome": row["nome"],
            "score": float(row["score"]),
            "orcamentoSugerido": round(float(sugerido), 2)
        })
        restante -= sugerido

    # Ajustar/pausar: bottom-K
    ajustar = ranked.tail(min(k, len(ranked))).copy()
    ajustar = [{"campanhaId": int(r.campanhaId), "nome": r.nome, "motivo": "baixo score / alto custo"} for _, r in ajustar.iterrows()]

    return {
        "data_referencia": str(data_referencia),
        "heuristica": modo,
        "orcamento_total": orcamento,
        "priorizar": aloc,
        "ajustar_ou_pausar": ajustar
    }

recs = greedy_recommend(df, k=3, orcamento=1200.0, modo="eficiencia")
json_path = "sugestoes_gulosas.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(recs, f, ensure_ascii=False, indent=2)

# Salvar um relatório-resumo em texto 

summary = f"""
Cannoli Intelligence – IA/ML (dados simulados)

1) Alertas (queda média móvel 7d, 30%):
- Total de alertas gerados: {len(alerts_df)}
- Exemplo primeira linha:
{alerts_df.head(1).to_string(index=False) if not alerts_df.empty else 'Sem alertas'}

2) Regressão Linear – previsão de conversões (features de defasagem 1 dia):
- MAE  : {metrics['MAE']:.3f}
- RMSE : {metrics['RMSE']:.3f}
- R²    : {metrics['R2']:.3f}

3) Busca Gulosa – recomendações (heurística: eficiência = conversões/custo, orçamento R$ 1200):
{json.dumps(recs, ensure_ascii=False, indent=2)}
"""
txt_path = "resultados_ia.txt"
with open(txt_path, "w", encoding="utf-8") as f:
    f.write(summary)

csv_path, alerts_path, plot_alerts_path, plot_reg_path, json_path, txt_path
