"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("all protected API route groups authenticate before controllers", () => {
    for (const file of [
        "backend/routes/staffRoutes.js",
        "backend/routes/productRoutes.js",
        "backend/routes/orderRoutes.js",
        "backend/routes/customerRoutes.js",
        "backend/routes/permissionRoutes.js",
        "backend/routes/communicationRoutes.js"
    ]) {
        assert.match(read(file), /router\.use\(protect\)/, file);
    }
});

test("Managers cannot invite or edit Manager accounts", () => {
    const staff = read("backend/controllers/staffController.js");
    assert.match(staff, /req\.profile\.role === "manager" && role !== "staff"/);
    assert.match(staff, /Managers can manage Staff accounts only|Only Admin can appoint Managers/);
    assert.match(staff, /deleteUser\(data\.user\.id\)/, "failed invitation assignment is compensated");
});

test("Manager salary listing is restricted to Staff targets", () => {
    const staff = read("backend/controllers/staffController.js");
    assert.match(staff, /staffRows\.filter\(person => person\.role === "staff"\)/);
    const migration = read("backend/migrations/009_manager_compensation_scope.sql");
    assert.match(migration, /employee\.role = 'staff'/);
    assert.match(migration, /staff\.compensation\.view/);
});

test("browser Data API cannot directly mutate stock, orders, or customer registry", () => {
    const migration = read("backend/migrations/006_permission_aware_rls_hardening.sql");
    for (const table of ["products", "orders", "order_items", "customers", "inventory_movements"]) {
        assert.match(migration, new RegExp("REVOKE INSERT, UPDATE, DELETE[^;]*public\\." + table));
    }
});

test("product archival and communication write RPCs are server-role only", () => {
    const migration = read("backend/migrations/006_permission_aware_rls_hardening.sql");
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.archive_bizinsight_product\(uuid, uuid\) TO service_role/);
    const communication = read("backend/migrations/008_atomic_communication_notifications.sql");
    assert.match(communication, /GRANT EXECUTE ON FUNCTION public\.publish_bizinsight_message[^;]*TO service_role/);
    assert.match(communication, /GRANT EXECUTE ON FUNCTION public\.create_bizinsight_issue[^;]*TO service_role/);
});

test("Access Control page loads an existing shared stylesheet", () => {
    const html = read("front-end/access-control.html");
    const match = html.match(/href="([^"]+\.css)"/);
    assert.ok(match, "stylesheet link exists");
    assert.ok(fs.existsSync(path.join(root, "front-end", match[1])), "linked stylesheet exists");
});

test("employee edit controls are governed by staff.manage", () => {
    assert.match(read("front-end/staff.html"), /dataset\.bizAction="staff\.manage"/);
    assert.match(read("front-end/permissions.js"), /button\.dataset\.bizAction==="staff\.manage"/);
});
