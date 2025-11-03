import express from 'express';
import campaignRoutes from './campaignRoutes.js';
import clientRoutes from './clientRoutes.js';
import orderRoutes from './orderRoutes.js';

const router = express.Router();

router.use(campaignRoutes);
router.use(clientRoutes);
router.use(orderRoutes);

export default router;