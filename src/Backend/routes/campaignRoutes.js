import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getCampanhasEstabelecimento, getCampanhasAdmin, getCampanhasSugestoesAdmin, getCampanhasSugestoesEstabelecimento } from '../controllers/campaignController.js';
import { getCampaignQueueAdmin, getCampaignQueueEstabelecimento } from '../controllers/campaignQueueController.js';

const router = Router();

router.get('/estabelecimento/campanhas', autenticarToken, getCampanhasEstabelecimento);
router.get('/admin/campanhas', autenticarToken, getCampanhasAdmin);
router.get('/estabelecimento/campaignqueue', autenticarToken, getCampaignQueueEstabelecimento);
router.get('/admin/campaignqueue', autenticarToken, getCampaignQueueAdmin);
router.get('/estabelecimento/campanhas/sugestoes', autenticarToken, getCampanhasSugestoesEstabelecimento);
router.get('/admin/campanhas/sugestoes', autenticarToken, getCampanhasSugestoesAdmin);

export default router;