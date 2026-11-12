const { getAdminClient } = require("../config/supabase");

const getMovements = async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
        const { data, error } = await req.supabase
            .from("inventory_movements")
            .select("id, product_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, reference_type, reference_id, created_at, products(name, sku)")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw error;
        return res.status(200).json(data || []);
    } catch (error) {
        console.error("Get inventory movements:", error.message);
        return res.status(500).json({
            message: "Unable to load stock history. Confirm that the approved inventory-ledger migration has been applied."
        });
    }
};

const createMovement = async (req, res) => {
    try {
        const productId = String(req.body.product_id || "");
        const delta = Number(req.body.quantity_delta);
        const reason = String(req.body.reason || "").trim();

        if (!productId) {
            return res.status(400).json({ message: "product_id is required" });
        }
        if (!Number.isInteger(delta) || delta === 0) {
            return res.status(400).json({ message: "quantity_delta must be a non-zero integer" });
        }
        if (reason.length < 3 || reason.length > 500) {
            return res.status(400).json({ message: "Please provide a reason between 3 and 500 characters" });
        }

        const { data: movementId, error } = await getAdminClient().rpc(
            "record_bizinsight_stock_movement",
            {
                p_product_id: productId,
                p_quantity_delta: delta,
                p_reason: reason,
                p_created_by: req.user.id
            }
        );
        if (error) throw error;

        // The route has checked inventory.stock_movement. Fetch with the server client so this action does not also require inventory.view.
        const { data: movement, error: fetchError } = await getAdminClient()
            .from("inventory_movements")
            .select("id, product_id, movement_type, quantity_delta, quantity_before, quantity_after, reason, created_at, products(name, sku)")
            .eq("id", movementId)
            .single();
        if (fetchError) throw fetchError;

        return res.status(201).json({
            message: "Stock movement recorded successfully",
            movement
        });
    } catch (error) {
        console.error("Create inventory movement:", error.message);
        return res.status(400).json({ message: error.message || "Unable to record stock movement" });
    }
};

module.exports = { getMovements, createMovement };
