import { Router } from "express";
import { get_clients, post_client, get_client, patch_client_email_or_name } from "../controllers/clientes.controllers.js";

const router = Router();

router.get("/", get_clients)
router.post("/",post_client)
router.get("/:id", get_client)
router.patch("/:id", patch_client_email_or_name)

export default router;