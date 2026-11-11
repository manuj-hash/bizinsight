const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;

const {
    getDashboardAnalytics,
    getSalesAnalytics,
    getInventoryAnalytics
} = require("../controllers/analyticsController");

router.use(protect, allowRoles("admin", "staff"));

router.get("/", getDashboardAnalytics);
router.get("/sales", getSalesAnalytics);
router.get("/inventory", getInventoryAnalytics);

module.exports = router;