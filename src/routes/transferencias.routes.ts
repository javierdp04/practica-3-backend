import { Router } from "express";
import { post_transfer } from "../controllers/transferencias.controllers.js"
const router = Router();

router.post("/", post_transfer)

export default router;