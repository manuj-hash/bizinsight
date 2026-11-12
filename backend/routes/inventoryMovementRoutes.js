const express=require("express");
const router=express.Router();
const protect=require("../middleware/authMiddleware");
const requirePermission=protect.requirePermission;
const {getMovements,createMovement}=require("../controllers/inventoryMovementController");
router.use(protect);
router.get("/",requirePermission("inventory.view"),getMovements);
router.post("/",requirePermission("inventory.stock_movement"),createMovement);
module.exports=router;