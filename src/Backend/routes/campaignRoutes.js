import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getCampanhasEstabelecimento, getCampanhasAdmin, getCampanhasSugestoesAdmin, getCampanhasSugestoesEstabelecimento, exportCampanhasEstabPdf, exportCampanhasAdminPdf } from '../controllers/campaignController.js';
import { getCampaignQueueAdmin, getCampaignQueueEstabelecimento, exportCampaignQueueEstabPdf, exportCampaignQueueAdminPdf  } from '../controllers/campaignQueueController.js';

const router = Router();

router.get('/estabelecimento/campanhas', autenticarToken, getCampanhasEstabelecimento);
router.get('/admin/campanhas', autenticarToken, getCampanhasAdmin);
router.get('/estabelecimento/campaignqueue', autenticarToken, getCampaignQueueEstabelecimento);
router.get('/admin/campaignqueue', autenticarToken, getCampaignQueueAdmin);
router.get('/estabelecimento/campanhas/sugestoes', autenticarToken, getCampanhasSugestoesEstabelecimento);
router.get('/admin/campanhas/sugestoes', autenticarToken, getCampanhasSugestoesAdmin);
router.get("/estabelecimento/campanhas/export/pdf", autenticarToken, exportCampanhasEstabPdf);
router.get("/estabelecimento/campaignqueue/export/pdf", autenticarToken, exportCampaignQueueEstabPdf);
router.get("/admin/campanhas/export/pdf", autenticarToken, exportCampanhasAdminPdf);
router.get("/admin/campaignqueue/export/pdf", autenticarToken, exportCampaignQueueAdminPdf);


export default router;