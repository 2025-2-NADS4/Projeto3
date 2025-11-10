import sys
import json
from pathlib import Path

import mysql.connector
import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    classification_report,
)

# CONFIGURAÇÃO DO BANCO

DB_CONFIG = {
    "host": "localhost",      # ex: "localhost"
    "user": "root",
    "password": "",
    "database": "cannoli",
}



# CONEXÃO

def get_connection():
    """Abre conexão com MySQL usando DB_CONFIG. Retorna um objeto connection."""
    return mysql.connector.connect(**DB_CONFIG)



# CARREGAR CAMPANHAS

def carregar_campanhas() -> pd.DataFrame:
    """
    Lê a tabela campaign e devolve um DataFrame.

    Premissas (colunas mínimas):
      id, storeId, name, status_desc, badge, type, _mes,
      createdAt, updatedAt, isDefault

    Obs.: Ajustar o SELECT se o esquema divergir.
    """
    conn = get_connection()
    query = """
        SELECT
            id,
            storeId,
            name,
            status_desc,
            badge,
            type,
            _mes,
            createdAt,
            updatedAt,
            isDefault
        FROM campaign
    """
    df = pd.read_sql(query, conn)
    conn.close()

    if df.empty:
        # Falha controlada para evitar treino sem dados
        raise RuntimeError("Nenhuma campanha encontrada na tabela `campaign`.")

    return df


 
# FEATURE ENGINEERING

def adicionar_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cria variáveis derivadas para melhorar o poder preditivo.
    Importante: não remove colunas originais (mantém rastreabilidade).
    """
    df = df.copy()

    # Normalização de categorias textuais (reduz nulos e padroniza)
    df["status_desc"] = df["status_desc"].fillna("(sem status)")
    df["badge"] = df["badge"].fillna("(sem badge)")
    df["type"] = df["type"].fillna("(sem tipo)")
    df["_mes"] = df["_mes"].astype(str)
    df["storeId"] = df["storeId"].astype(str)

    # Conversão de datas (erros coerçidos para NaT)
    for col in ["createdAt", "updatedAt"]:
        df[col] = pd.to_datetime(df[col], errors="coerce")

    # Medida de "tempo em atividade" como proxy de maturidade
    df["dias_ativos"] = (df["updatedAt"] - df["createdAt"]).dt.days
    df["dias_ativos"] = df["dias_ativos"].fillna(0)

    # Sazonalidade (mês de criação)
    df["mes_criacao_num"] = df["createdAt"].dt.month.fillna(0).astype(int)

    # Proxies simples de complexidade/branding
    df["tam_nome"] = df["name"].fillna("").astype(str).str.len()
    df["tem_badge"] = np.where(df["badge"] == "(sem badge)", 0, 1)

    # Normalização para inteiro
    df["isDefault"] = df["isDefault"].fillna(0).astype(int)

    return df


# TREINAR MODELO
def treinar_modelo(df: pd.DataFrame):
    """
    Treina RandomForest para prever status_desc.

    Retorna:
      model: classificador treinado
      encoders: dicionário com LabelEncoders (features categóricas + alvo)
      df_feat: DataFrame com features + colunas auxiliares (__id, __name, __storeId_raw)
      feature_cols: lista de colunas usadas como X
      metrics: dicionário de métricas (para persistência em JSON)
    """
    df = df.copy()

    # Garantia de alvo presente (evita label encoder vazio)
    df = df[df["status_desc"].notna()].reset_index(drop=True)
    if df.empty:
        raise RuntimeError("Não há status_desc válidos para treinar o modelo.")

    # Engenharia de atributos
    df = adicionar_features(df)

    # Guardar identificadores para pós-predição
    ids = df["id"].astype(int)
    nomes = df["name"].fillna("").astype(str)
    store_ids_raw = df["storeId"].astype(str)

    # Codificação de categorias (LabelEncoder por coluna)
    cat_cols = ["storeId", "badge", "type", "_mes"]
    encoders = {}

    for col in cat_cols:
        le = LabelEncoder()
        df[col] = df[col].astype(str)
        df[col] = le.fit_transform(df[col])
        encoders[col] = le

    # Alvo
    target_col = "status_desc"
    y_text = df[target_col].astype(str)

    enc_status = LabelEncoder()
    y = enc_status.fit_transform(y_text)
    encoders[target_col] = enc_status

    # Seleção de variáveis preditoras (X)
    feature_cols = cat_cols + [
        "dias_ativos",
        "mes_criacao_num",
        "tam_nome",
        "tem_badge",
        "isDefault",
    ]
    X = df[feature_cols]

    # Divisão estratificada (melhor representação das classes no teste)
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.25,
        random_state=42,
        stratify=y,
    )

    # Hiperparâmetros conservadores para evitar overfitting inicial
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=8,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    model.fit(X_train, y_train)

    # Avaliação objetiva (acurácia + F1 ponderado)
    y_pred = model.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    f1w = f1_score(y_test, y_pred, average="weighted")

    # Relatórios para auditoria de desempenho
    report_dict = classification_report(
        y_test,
        y_pred,
        target_names=enc_status.classes_,
        output_dict=True,
        zero_division=0,
    )
    report_text = classification_report(
        y_test,
        y_pred,
        target_names=enc_status.classes_,
        zero_division=0,
    )

    print("\n===== MÉTRICAS DO MODELO =====")
    print("Acurácia:", round(acc, 3))
    print("F1 (weighted):", round(f1w, 3))
    print("\nRelatório por classe:")
    print(report_text)

    metrics = {
        "accuracy": float(acc),
        "f1_weighted": float(f1w),
        "classes": list(enc_status.classes_),
        "classification_report": report_dict,
        "classification_report_text": report_text,
        "n_samples_total": int(len(df)),
        "n_samples_train": int(len(X_train)),
        "n_samples_test": int(len(X_test)),
    }

    # df_feat mantém contexto para geração de sugestões
    df_feat = df.copy()
    df_feat["__id"] = ids
    df_feat["__name"] = nomes
    df_feat["__storeId_raw"] = store_ids_raw

    return model, encoders, df_feat, feature_cols, metrics


# GERAR SUGESTÕES
def gerar_sugestoes(df_feat: pd.DataFrame, feature_cols, model, encoders):
    """
    Produz recomendações por campanha com base nas probabilidades do modelo.

    Saída (lista de dicts):
      campaignId, storeId, name, status_previsto, confianca, grupo
    """
    X_full = df_feat[feature_cols]
    probs = model.predict_proba(X_full)
    y_pred = model.predict(X_full)

    enc_status = encoders["status_desc"]
    classes = enc_status.classes_

    sugestoes = []

    for i, row in df_feat.iterrows():
        camp_id = int(row["__id"])
        store_id = str(row["__storeId_raw"])
        nome_campanha = str(row["__name"])

        idx_classe = y_pred[i]
        status_previsto = classes[idx_classe]
        conf = float(probs[i, idx_classe])

        # Heurística simples de agrupamento:
        # - priorizar: status positivo com alta confiança
        # - ajustar_ou_pausar: status inicial/rascunho com baixa confiança
        # - monitorar: demais casos
        status_lower = status_previsto.lower()

        if (("conclu" in status_lower) or ("ativ" in status_lower)) and conf >= 0.6:
            grupo = "priorizar"
        elif (("rascunho" in status_lower) or ("agend" in status_lower)) and conf <= 0.4:
            grupo = "ajustar_ou_pausar"
        else:
            grupo = "monitorar"

        sugestoes.append(
            {
                "campaignId": camp_id,
                "storeId": store_id,
                "name": nome_campanha,
                "status_previsto": status_previsto,
                "confianca": conf,
                "grupo": grupo,
            }
        )

    print(f"\nGeradas {len(sugestoes)} sugestões.")
    return sugestoes


# SALVAR SUGESTÕES NA TABELA
def salvar_sugestoes_no_banco(sugestoes, modelo_versao="rf_v1"):
    """
    Persiste sugestões em `campaign_ai_sugestoes`.

    Nota: TRUNCATE remove histórico. Se for necessário manter versões,
    comentar o TRUNCATE e incluir carimbo de tempo/versão.
    """
    if not sugestoes:
        print("Nenhuma sugestão para salvar no banco.")
        return

    conn = get_connection()
    cur = conn.cursor()

    # Atenção: limpa a tabela inteira antes de inserir
    cur.execute("TRUNCATE TABLE campaign_ai_sugestoes")

    insert_sql = """
        INSERT INTO campaign_ai_sugestoes
          (campaignId, storeId, status_previsto, confianca, grupo, modelo_versao)
        VALUES (%s, %s, %s, %s, %s, %s)
    """

    data = [
        (
            s["campaignId"],
            s["storeId"],
            s["status_previsto"],
            round(s["confianca"], 4),
            s["grupo"],
            modelo_versao,
        )
        for s in sugestoes
    ]

    cur.executemany(insert_sql, data)
    conn.commit()
    cur.close()
    conn.close()

    print(f"Inseridas {len(sugestoes)} linhas em `campaign_ai_sugestoes`.")


# SALVAR JSONS (metrics.json e sugestoes.json)
def salvar_jsons(metrics: dict, sugestoes: list):
    """
    Salva artefatos de auditoria e consumo downstream:
      - metrics.json: desempenho do modelo
      - sugestoes.json: recomendações geradas
    """
    base_dir = Path(".").resolve()

    metrics_path = base_dir / "metrics.json"
    sugestoes_path = base_dir / "sugestoes.json"

    with metrics_path.open("w", encoding="utf-8") as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)

    with sugestoes_path.open("w", encoding="utf-8") as f:
        json.dump(sugestoes, f, ensure_ascii=False, indent=2)

    print(f"Métricas salvas em: {metrics_path}")
    print(f"Sugestões salvas em: {sugestoes_path}")


# MAIN
def main():
    """Pipeline orquestrado: carrega dados -> treina -> sugere -> persiste -> salva artefatos."""
    print("Carregando campanhas do banco...")
    df_raw = carregar_campanhas()

    print("Treinando modelo...")
    model, encoders, df_feat, feature_cols, metrics = treinar_modelo(df_raw)

    print("Gerando sugestões para todas as campanhas...")
    sugestoes = gerar_sugestoes(df_feat, feature_cols, model, encoders)

    print("Salvando sugestões no MySQL...")
    salvar_sugestoes_no_banco(sugestoes, modelo_versao="rf_v1")

    print("Salvando JSONs (metrics.json e sugestoes.json)...")
    salvar_jsons(metrics, sugestoes)

    print("\n[OK] Processo concluído.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        # Tratamento simples para falhas operacionais: log e saída com erro
        print(f"[ERRO] {e}")
        sys.exit(1)
