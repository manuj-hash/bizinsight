const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { allowRoles } = protect;
const staff = require("../controllers/staffController");

router.use(protect);
router.get("/", allowRoles("admin", "manager"), staff.getStaff);
router.post("/invite", allowRoles("admin", "manager"), staff.inviteEmployee);
router.patch("/:id", allowRoles("admin", "manager"), staff.updateEmployee);
router.put("/:id/compensation", allowRoles("admin", "manager"), staff.updateCompensation);
router.get("/departments", allowRoles("admin", "manager"), staff.getDepartments);
router.post("/departments", allowRoles("admin", "manager"), staff.createDepartment);
router.patch("/departments/:id", allowRoles("admin", "manager"), staff.updateDepartment);
router.get("/preferences", allowRoles("admin", "manager"), staff.getPreferences);
router.patch("/preferences", allowRoles("admin", "manager"), staff.updatePreferences);

module.exports = router;
