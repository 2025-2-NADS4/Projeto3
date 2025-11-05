import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { getAdminOverview } from '../controllers/adminOverviewController.js';

const router = Router();

router.get("/admin/overview", autenticarToken, getAdminOverview);

export default router;