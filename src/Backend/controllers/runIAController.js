import { exec } from "child_process";
import path from "path";

export async function runIA(req, res) {
  try {
    const scriptPath = path.resolve("ml", "ia_campanhas_sugestoes.py");

    exec(`python "${scriptPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error("Erro ao executar script Python:", error);
        return res
          .status(500)
          .json({ erro: "Falha ao executar script Python.", detalhes: stderr });
      }

      console.log("Script Python executado com sucesso.");
      console.log(stdout);

      res.json({
        mensagem: "IA executada com sucesso!",
        saida: stdout,
      });
    });
  } catch (err) {
    console.error("Erro interno no runIA:", err);
    res.status(500).json({ erro: "Erro interno ao executar a IA." });
  }
}