import express from 'express';
import campaignRoutes from './campaignRoutes.js';
import clientRoutes from './clientRoutes.js';
import orderRoutes from './orderRoutes.js';
import adminRoutes from './adminRoutes.js';
import clientRiskRoutes from './clientRiskRoutes.js';

const router = express.Router();

router.use(campaignRoutes);
router.use(clientRoutes);
router.use(orderRoutes);
router.use(adminRoutes);
router.use(clientRiskRoutes);

export default router;