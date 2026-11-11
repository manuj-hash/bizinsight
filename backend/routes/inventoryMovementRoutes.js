const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;
const { getMovements, createMovement } = require("../controllers/inventoryMovementController");

router.use(protect, allowRoles("admin", "staff"));
router.get("/", getMovements);
router.post("/", createMovement);

module.exports = router;
