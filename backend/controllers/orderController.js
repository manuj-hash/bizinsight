const { getAdminClient } = require("../config/supabase");

const ORDER_SELECT = `
    *,
    customers(name, email),
    order_items(
        id, product_id, quantity, unit_price, line_total,
        products(name, sku)
    )
`;

const getOrders = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("orders")
            .select(ORDER_SELECT)
            .order("ordered_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json(data || []);
    } catch (error) {
        console.error("Get orders:", error.message);
        return res.status(500).json({ message: "Unable to load orders" });
    }
};

const getOrder = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("orders")
            .select(ORDER_SELECT)
            .eq("id", req.params.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Order not found" });
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load order" });
    }
};

const createOrder = async (req, res) => {
    try {
        const {
            customer_id = null, items,
            tax_amount = 0, discount_amount = 0,
            status = "pending"
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "At least one order item is required" });
        }

        const seen = new Set();
        for (const item of items) {
            if (!item.product_id ||
                !Number.isInteger(Number(item.quantity)) ||
                Number(item.quantity) <= 0) {
                return res.status(400).json({
                    message: "Each item requires product_id and a positive integer quantity"
                });
            }
            if (seen.has(item.product_id)) {
                return res.status(400).json({
                    message: "Duplicate products are not allowed in one order"
                });
            }
            seen.add(item.product_id);
        }

        const tax = Number(tax_amount);
        const discount = Number(discount_amount);
        if (!Number.isFinite(tax) || !Number.isFinite(discount) || tax < 0 || discount < 0) {
            return res.status(400).json({ message: "Invalid tax or discount amount" });
        }
        if (!["pending", "processing", "completed"].includes(status)) {
            return res.status(400).json({ message: "Invalid initial order status" });
        }

        const orderNumber =
            `ORD-${Date.now()}-${require("crypto").randomBytes(3).toString("hex").toUpperCase()}`;

        // This RPC is deliberately service_role-only. The route's protect
        // middleware has already verified the caller and their staff/admin role.
        const { data: orderId, error: rpcError } = await getAdminClient().rpc(
            "create_bizinsight_order",
            {
                p_order_number: orderNumber,
                p_customer_id: customer_id,
                p_items: items.map(item => ({
                    product_id: item.product_id,
                    quantity: Number(item.quantity)
                })),
                p_tax_amount: tax,
                p_discount_amount: discount,
                p_status: status,
                p_created_by: req.user.id
            }
        );

        if (rpcError) throw rpcError;

        const { data: completeOrder, error: fetchError } = await req.supabase
            .from("orders")
            .select(ORDER_SELECT)
            .eq("id", orderId)
            .single();

        if (fetchError) throw fetchError;

        return res.status(201).json({
            message: "Order created and stock movement recorded",
            order: completeOrder
        });
    } catch (error) {
        console.error("Create order:", error.message);
        return res.status(400).json({ message: error.message || "Unable to create order" });
    }
};

const updateOrder = async (req, res) => {
    try {
        const { status } = req.body;
        if (!["pending", "processing", "completed", "cancelled"].includes(status)) {
            return res.status(400).json({ message: "A valid order status is required" });
        }

        const { data: orderId, error } = await getAdminClient().rpc(
            "set_bizinsight_order_status",
            {
                p_order_id: req.params.id,
                p_status: status,
                p_reason: req.body.reason || null,
                p_changed_by: req.user.id
            }
        );

        if (error) throw error;

        const { data: order, error: fetchError } = await req.supabase
            .from("orders")
            .select(ORDER_SELECT)
            .eq("id", orderId)
            .single();

        if (fetchError) throw fetchError;

        return res.status(200).json({
            message: status === "cancelled"
                ? "Order cancelled and stock restored"
                : "Order status updated successfully",
            order
        });
    } catch (error) {
        console.error("Update order:", error.message);
        return res.status(400).json({ message: error.message || "Unable to update order" });
    }
};

// Orders are permanent business records. Use the cancellation workflow instead.
const deleteOrder = async (req, res) => {
    return res.status(405).json({
        message: "Orders cannot be deleted. Cancel the order to preserve its history and restore stock."
    });
};

module.exports = { getOrders, getOrder, createOrder, updateOrder, deleteOrder };
