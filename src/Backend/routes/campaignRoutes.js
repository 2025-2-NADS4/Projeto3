import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getCampanhasEstabelecimento, getCampanhasAdmin } from '../controllers/campaignController.js';

const router = Router();

router.get('/estabelecimento/campanhas', autenticarToken, getCampanhasEstabelecimento);
router.get('/admin/campanhas', autenticarToken, getCampanhasAdmin);

export default router;