import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getClientesEstabelecimento, getClientesAdmin, exportClientesEstabPdf } from '../controllers/clientController.js';

const router = Router();

router.get('/estabelecimento/clientes', autenticarToken, getClientesEstabelecimento);
router.get('/admin/clientes', autenticarToken, getClientesAdmin);
router.get('/estabelecimento/clientes/export/pdf', autenticarToken, exportClientesEstabPdf);

export default router;