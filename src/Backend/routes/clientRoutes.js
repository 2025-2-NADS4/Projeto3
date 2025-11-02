import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getClientesEstabelecimento, getClientesAdmin } from '../controllers/clientController.js';

const router = Router();

router.get('/estabelecimento/clientes', autenticarToken, getClientesEstabelecimento);
router.get('/admin/clientes', autenticarToken, getClientesAdmin);

export default router;