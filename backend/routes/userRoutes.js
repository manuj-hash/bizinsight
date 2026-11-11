const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;
const { getUsers, getUser, updateMyProfile, updateMyPassword, updateUserRole, inviteStaff } = require("../controllers/userController");

router.use(protect);
router.get("/me", getUser);
router.put("/me", updateMyProfile);
router.put("/me/password", updateMyPassword);
router.get("/", allowRoles("admin"), getUsers);
router.post("/invite", allowRoles("admin"), inviteStaff);
router.patch("/:id/role", allowRoles("admin"), updateUserRole);

module.exports = router;
