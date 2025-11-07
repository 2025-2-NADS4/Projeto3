import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getClientesRiscoEstabelecimento, getClientesRiscoAdmin } from '../controllers/clientRiskController.js';

const router = Router();

router.get("/estabelecimento/clientes-risco", autenticarToken, getClientesRiscoEstabelecimento);
router.get("/admin/clientes-risco", autenticarToken, getClientesRiscoAdmin);

export default router;