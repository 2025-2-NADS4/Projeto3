import express from 'express';
import campaignRoutes from './campaignRoutes.js';
import clientRoutes from './clientRoutes.js';
import orderRoutes from './orderRoutes.js';
import adminRoutes from './adminRoutes.js';

const router = express.Router();

router.use(campaignRoutes);
router.use(clientRoutes);
router.use(orderRoutes);
router.use(adminRoutes);

export default router;