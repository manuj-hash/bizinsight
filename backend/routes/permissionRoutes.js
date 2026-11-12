const express=require("express");
const router=express.Router();
const protect=require("../middleware/authMiddleware");
const {allowRoles}=protect;
const permissions=require("../controllers/permissionController");
const management=require("../controllers/permissionManagementController");

router.use(protect);
router.get("/me",permissions.catalog);
router.get("/delegations",allowRoles("admin","manager"),permissions.getDelegations);
router.put("/delegations",allowRoles("admin"),permissions.setDelegation);
router.get("/users/:id",allowRoles("admin","manager"),management.getStaffPermissions);
router.post("/users/:id",allowRoles("admin","manager"),permissions.changeStaffPermission);

module.exports=router;
