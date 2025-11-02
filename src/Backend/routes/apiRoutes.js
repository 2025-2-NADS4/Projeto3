import express from 'express';
import campaignRoutes from './campaignRoutes.js';
import clientRoutes from './clientRoutes.js';

const router = express.Router();

router.use(campaignRoutes);
router.use(clientRoutes);

export default router;