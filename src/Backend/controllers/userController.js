import db from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

export const login = async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: "Por favor, forneça email e senha." });
  }

  try {
    const [rows] = await db.execute(
      "SELECT id, nome, email, senha, perfil, establishment_id FROM usuarios WHERE email = ? LIMIT 1",
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ erro: "Usuário não encontrado." });
    }

    const user = rows[0];
    const senhaOk = await bcrypt.compare(senha, user.senha);

    if (!senhaOk) {
      return res.status(401).json({ erro: "Senha incorreta." });
    }

    const establishment_id =
      user.perfil === "ADMIN" ? null : user.establishment_id;

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        nome: user.nome,
        perfil: user.perfil,
        establishment_id,
      },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(200).json({
      id: user.id,
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
      establishment_id,
      message: "Login bem-sucedido.",
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: "Erro ao consultar o banco de dados." });
  }
};


export const register = async (req, res) => {
  try {
    let { nome, email, senha, perfil, establishment_id } = req.body;

    nome = (nome || '').trim();
    email = (email || '').trim().toLowerCase();
    senha = (senha || '').trim();
    const perfisPermitidos = ['ADMIN', 'ESTABELECIMENTO'];
    const perfilFinal = perfisPermitidos.includes((perfil || '').toUpperCase())
      ? (perfil || '').toUpperCase()
      : 'ESTABELECIMENTO';

    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'Por favor, preencha nome, email e senha.' });
    }

    if (perfilFinal === 'ESTABELECIMENTO') {
      establishment_id = (establishment_id || '').toString().trim().toUpperCase();
      if (!establishment_id) {
        return res.status(400).json({ erro: 'Para perfil ESTABELECIMENTO, o establishment_id é obrigatório (ex.: EST008).' });
      }

      const [estRows] = await db.execute(
        'SELECT 1 FROM estabelecimentos WHERE companyId = ? LIMIT 1',
        [establishment_id]
      );
      if (estRows.length === 0) {
        return res.status(400).json({ erro: 'establishment_id inválido. Não encontrado em estabelecimentos.' });
      }
    } else {
      establishment_id = null;
    }

    const [exist] = await db.execute(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [email]
    );
    if (exist.length > 0) {
      return res.status(409).json({ erro: 'Email já cadastrado.' });
    }

    const hash = await bcrypt.hash(senha, 10);

    await db.execute(
      `INSERT INTO usuarios (nome, email, senha, perfil, establishment_id)
       VALUES (?, ?, ?, ?, ?)`,
      [nome, email, hash, perfilFinal, establishment_id]
    );

    return res.status(201).json({
      mensagem: 'Usuário registrado com sucesso.',
      perfil: perfilFinal,
      establishment_id: establishment_id || null
    });
  } catch (erro) {
    console.error(erro);
    return res.status(500).json({ erro: 'Erro ao registrar o usuário.' });
  }
};
