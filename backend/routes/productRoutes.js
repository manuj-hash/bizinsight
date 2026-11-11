const express = require("express");
const router = express.Router();

const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;

const {
    getProducts,
    getProduct,
    addProduct,
    updateProduct,
    deleteProduct
} = require("../controllers/productController");

router.use(protect, allowRoles("admin", "staff"));

router.get("/", getProducts);
router.get("/:id", getProduct);
router.post("/", addProduct);
router.put("/:id", updateProduct);
router.delete("/:id", allowRoles("admin"), deleteProduct);

module.exports = router;