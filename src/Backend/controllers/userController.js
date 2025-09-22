import db from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

export const login = async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json("Por favor, forneça email e senha.");
  }

  try {
    const [rows] = await db.execute(
      "SELECT id, nome, email, senha, perfil FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json("Usuário não encontrado.");
    }

    const user = rows[0];
    const ok = await bcrypt.compare(senha, user.senha);

    if (!ok) {
      return res.status(401).json("Senha incorreta.");
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, nome: user.nome, perfil: user.perfil },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      id: user.id,
      message: "Login bem-sucedido",
      token,
      perfil: user.perfil
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json("Erro ao consultar o banco de dados.");
  }
};

export const register = async (req, res) => {
  const { nome, email, senha, perfil } = req.body;

  const perfisPermitidos = ['ADMIN', 'ESTABELECIMENTO'];
  const perfilFinal = perfisPermitidos.includes(perfil) ? perfil : 'ESTABELECIMENTO';

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Por favor, preencha nome, email e senha." });
  }

  try {
    const [exist] = await db.execute("SELECT id FROM usuarios WHERE email = ? LIMIT 1", [email]);
    if (exist.length > 0) {
      return res.status(400).json({ erro: "Email já cadastrado." });
    }

    const hash = await bcrypt.hash(senha, 10);

    await db.execute(
      `INSERT INTO usuarios (nome, email, senha, perfil)
       VALUES (?, ?, ?, ?)`,
      [nome, email, hash, perfilFinal]
    );

    return res.json({ mensagem: "Usuário registrado com sucesso.", perfil: perfilFinal });
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: "Erro ao registrar o usuário." });
  }
};