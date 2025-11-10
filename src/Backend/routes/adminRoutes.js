import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getAdminOverview, exportAdminOverviewPdf } from '../controllers/adminOverviewController.js';

const router = Router();

router.get("/admin/overview", autenticarToken, getAdminOverview);
router.get("/admin/overview/export/pdf", autenticarToken, exportAdminOverviewPdf);

export default router;