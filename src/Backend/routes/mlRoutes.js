import { Router } from 'express';
import autenticarToken from '../middlewares/autenticarToken.js';
import { runIA } from "../controllers/runIAController.js";

const router = Router();

router.post("/executar-ia", autenticarToken, runIA);

export default router;