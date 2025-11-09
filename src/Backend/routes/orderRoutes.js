import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getPedidosEstabelecimento, getPedidosAdmin, exportPedidosEstabPdf } from '../controllers/orderController.js';

const router = Router();

router.get("/estabelecimento/pedidos", autenticarToken, getPedidosEstabelecimento);
router.get("/admin/pedidos", autenticarToken, getPedidosAdmin);
router.get("/estabelecimento/pedidos/export/pdf", autenticarToken, exportPedidosEstabPdf);

export default router;