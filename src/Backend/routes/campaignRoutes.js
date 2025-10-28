import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getCampanhasEstabelecimento, getCampanhasAdmin } from '../controllers/campaignController.js';
import { getCampaignQueueAdmin, getCampaignQueueEstabelecimento } from '../controllers/campaignQueueController.js';

const router = Router();

router.get('/estabelecimento/campanhas', autenticarToken, getCampanhasEstabelecimento);
router.get('/admin/campanhas', autenticarToken, getCampanhasAdmin);
router.get('/estabelecimento/campaignqueue', autenticarToken, getCampaignQueueEstabelecimento);
router.get('/admin/campaignqueue', autenticarToken, getCampaignQueueAdmin);

export default router;