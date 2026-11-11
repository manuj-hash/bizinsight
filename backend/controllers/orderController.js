const supabase = require("../config/supabase");

const getOrders = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select(`
                *,
                customers(name, email),
                order_items(
                    id,
                    product_id,
                    quantity,
                    unit_price,
                    line_total,
                    products(name, sku)
                )
            `)
            .order("ordered_at", { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getOrder = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select(`
                *,
                customers(name, email),
                order_items(
                    id,
                    product_id,
                    quantity,
                    unit_price,
                    line_total,
                    products(name, sku)
                )
            `)
            .eq("id", req.params.id)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Order not found"
            });
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createOrder = async (req, res) => {
    try {
        const { customer_id = null, items, tax_amount = 0, discount_amount = 0, status = "pending" } = req.body;
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "At least one order item is required" });
        const seen = new Set();
        for (const item of items) {
            if (!item.product_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0)
                return res.status(400).json({ message: "Each item requires product_id and a positive integer quantity" });
            if (seen.has(item.product_id)) return res.status(400).json({ message: "Duplicate products are not allowed in one order" });
            seen.add(item.product_id);
        }
        const tax = Number(tax_amount), discount = Number(discount_amount);
        if (!Number.isFinite(tax) || !Number.isFinite(discount) || tax < 0 || discount < 0)
            return res.status(400).json({ message: "Invalid tax or discount amount" });
        if (!["pending", "processing", "completed", "cancelled"].includes(status))
            return res.status(400).json({ message: "Invalid order status" });

        const orderNumber = `ORD-${Date.now()}-${require("crypto").randomBytes(3).toString("hex").toUpperCase()}`;
        const { data: orderId, error: rpcError } = await supabase.rpc("create_bizinsight_order", {
            p_order_number: orderNumber,
            p_customer_id: customer_id,
            p_items: items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })),
            p_tax_amount: tax,
            p_discount_amount: discount,
            p_status: status
        });
        if (rpcError) throw rpcError;

        const { data: completeOrder, error: fetchError } = await supabase
            .from("orders").select("*, customers(name, email), order_items(id, product_id, quantity, unit_price, line_total, products(name, sku))")
            .eq("id", orderId).single();
        if (fetchError) throw fetchError;
        return res.status(201).json({ message: "Order created and stock updated successfully", order: completeOrder });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
};

const updateOrder = async (req, res) => {
    try {
        const { status } = req.body;

        if (!["pending", "processing", "completed", "cancelled"].includes(status)) {
            return res.status(400).json({
                message: "A valid order status is required"
            });
        }

        const { data, error } = await supabase
            .from("orders")
            .update({ status })
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Order not found"
            });
        }

        res.status(200).json({
            message: "Order updated successfully",
            order: data
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const deleteOrder = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .delete()
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Order not found"
            });
        }

        res.status(200).json({
            message: "Order deleted successfully"
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getOrders,
    getOrder,
    createOrder,
    updateOrder,
    deleteOrder
};