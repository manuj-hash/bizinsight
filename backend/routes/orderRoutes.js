const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;

const {
    getOrders,
    getOrder,
    createOrder,
    updateOrder,
    deleteOrder
} = require("../controllers/orderController");

router.use(protect, allowRoles("admin", "staff"));

router.get("/", getOrders);
router.get("/:id", getOrder);
router.post("/", createOrder);
router.put("/:id", updateOrder);
router.delete("/:id", allowRoles("admin"), deleteOrder);

module.exports = router;