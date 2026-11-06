import { Router } from "express";
import { get_accounts, post_account, get_account, get_account_movements, patch_account_state, deposit_money, withdraw_money} from "../controllers/cuentas.controllers.js"
const router = Router();

router.get("/", get_accounts)
router.post("/",post_account)
router.get("/:id", get_account)
router.get("/:id/movimientos", get_account_movements)
router.patch("/:id/estado", patch_account_state)

router.post("/:id/ingresos", deposit_money)
router.post("/:id/retiradas", withdraw_money)

export default router;
