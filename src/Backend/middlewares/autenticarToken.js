import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const verifyAsync = promisify(jwt.verify);

export default async function autenticarToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ erro: 'Token não fornecido' });
    }

    try {
        const decoded = await verifyAsync(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
    }
}
