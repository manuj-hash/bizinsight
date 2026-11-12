const express=require("express");
const router=express.Router();
const protect=require("../middleware/authMiddleware");
const {allowRoles,requirePermission}=protect;
const permissions=require("../controllers/permissionController");
const management=require("../controllers/permissionManagementController");

router.use(protect);
router.get("/me",permissions.catalog);
router.get("/delegations",allowRoles("admin","manager"),requirePermission("permissions.grant_staff","permissions.revoke_staff"),permissions.getDelegations);
router.put("/delegations",allowRoles("admin"),permissions.setDelegation);
router.get("/users/:id",allowRoles("admin","manager"),requirePermission("staff.view"),management.getStaffPermissions);
router.post("/users/:id",allowRoles("admin","manager"),requirePermission("permissions.grant_staff","permissions.revoke_staff"),permissions.changeStaffPermission);

module.exports=router;
