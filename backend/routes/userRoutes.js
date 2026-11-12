const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { getUser, updateMyProfile, updateMyPassword } = require("../controllers/userController");

router.use(protect);
router.get("/me", getUser);
router.put("/me", updateMyProfile);
router.put("/me/password", updateMyPassword);

module.exports = router;
