import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getClientesRiscoEstabelecimento, getClientesRiscoAdmin, exportClientesRiscoEstabPdf } from '../controllers/clientRiskController.js';

const router = Router();

router.get("/estabelecimento/clientes-risco", autenticarToken, getClientesRiscoEstabelecimento);
router.get("/admin/clientes-risco", autenticarToken, getClientesRiscoAdmin);
router.get("/estabelecimento/clientes-risco/export/pdf", autenticarToken, exportClientesRiscoEstabPdf);

export default router;