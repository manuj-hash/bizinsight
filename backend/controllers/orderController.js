const crypto = require("crypto");
const { getAdminClient } = require("../config/supabase");

const ORDER_SELECT = "id, order_number, customer_id, status, subtotal, tax_amount, discount_amount, total_amount, ordered_at, created_at, updated_at, customers(name, email), order_items(id, product_id, quantity, unit_price, line_total, products(name, sku))";

function customerFingerprint({ email, phone }) {
    const secret = process.env.CUSTOMER_IDENTITY_SECRET;
    if (!secret) throw new Error("CUSTOMER_IDENTITY_SECRET is required to securely identify repeat buyers");
    const identity = phone
        ? "phone:" + phone.replace(/[^\d+]/g, "")
        : "email:" + email.trim().toLowerCase();
    if (identity.endsWith(":")) throw new Error("A valid email or phone number is required");
    return crypto.createHmac("sha256", secret).update(identity).digest("hex");
}

const getOrders = async (req, res) => {
    try {
        const { data, error } = await req.supabase.from("orders")
            .select(ORDER_SELECT).order("ordered_at", { ascending: false });
        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        console.error("Get orders:", error.message);
        return res.status(500).json({ message: "Unable to load orders" });
    }
};

const getOrder = async (req, res) => {
    try {
        const { data, error } = await req.supabase.from("orders")
            .select(ORDER_SELECT).eq("id", req.params.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Order not found" });
        return res.json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load order" });
    }
};

const createOrder = async (req, res) => {
    try {
        const {
            customer_id = null, customer_name, customer_email,
            customer_phone, customer_address, items,
            tax_amount = 0, discount_amount = 0, status = "pending"
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "At least one order item is required" });
        }
        const seen = new Set();
        for (const item of items) {
            if (!item.product_id || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
                return res.status(400).json({ message: "Each item requires a product and positive integer quantity" });
            }
            if (seen.has(item.product_id)) return res.status(400).json({ message: "Duplicate products are not allowed" });
            seen.add(item.product_id);
        }

        const tax = Number(tax_amount);
        const discount = Number(discount_amount);
        if (!Number.isFinite(tax) || !Number.isFinite(discount) || tax < 0 || discount < 0) {
            return res.status(400).json({ message: "Tax and discount must be non-negative amounts" });
        }
        if (!["pending", "processing", "completed"].includes(status)) {
            return res.status(400).json({ message: "Invalid initial order status" });
        }

        let knownCustomerId = req.profile.role === "staff" ? null : customer_id;
        let details = {
            name: String(customer_name || "").trim(),
            email: String(customer_email || "").trim().toLowerCase(),
            phone: String(customer_phone || "").trim(),
            address: String(customer_address || "").trim()
        };

        if (knownCustomerId && (!details.name || (!details.email && !details.phone))) {
            const { data: customer, error } = await req.supabase.from("customers")
                .select("name,email,phone,address")
                .eq("id", knownCustomerId).maybeSingle();
            if (error) throw error;
            if (!customer) return res.status(404).json({ message: "Valuable customer record not found" });
            details = {
                name: details.name || customer.name || "",
                email: details.email || customer.email || "",
                phone: details.phone || customer.phone || "",
                address: details.address || customer.address || ""
            };
        }

        let fingerprint = null;
        if (details.name || details.email || details.phone) {
            if (!details.name || (!details.email && !details.phone)) {
                return res.status(400).json({ message: "For customer recognition, enter a name and either phone or email" });
            }
            fingerprint = customerFingerprint(details);
        }

        const orderNumber = "ORD-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
        const rpcArgs = {
            p_order_number: orderNumber,
            p_customer_id: knownCustomerId,
            p_items: items.map(item => ({ product_id: item.product_id, quantity: Number(item.quantity) })),
            p_tax_amount: tax,
            p_discount_amount: discount,
            p_status: status,
            p_created_by: req.user.id,
            p_customer_fingerprint: fingerprint,
            p_customer_name: details.name || null,
            p_customer_email: details.email || null,
            p_customer_phone: details.phone || null,
            p_customer_address: details.address || null
        };

        const { data: orderId, error: rpcError } = await getAdminClient().rpc("create_bizinsight_order", rpcArgs);
        if (rpcError) {
            if (rpcError.code === "PGRST202") {
                return res.status(409).json({
                    message: "The approved department/customer migration is not installed yet. Apply migrations 002 and 003 after review."
                });
            }
            throw rpcError;
        }

        const { data: completeOrder, error: fetchError } = await req.supabase
            .from("orders").select(ORDER_SELECT).eq("id", orderId).single();
        if (fetchError) throw fetchError;

        return res.status(201).json({
            message: "Order created. Customer details are retained only if the configured qualification threshold is met.",
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
        const { data: orderId, error } = await getAdminClient().rpc("set_bizinsight_order_status", {
            p_order_id: req.params.id,
            p_status: status,
            p_reason: req.body.reason || null,
            p_changed_by: req.user.id
        });
        if (error) {
            if (error.code === "PGRST202") {
                return res.status(409).json({ message: "Order lifecycle migration 002 must be applied before status changes." });
            }
            throw error;
        }
        const { data: order, error: fetchError } = await req.supabase
            .from("orders").select(ORDER_SELECT).eq("id", orderId).single();
        if (fetchError) throw fetchError;
        return res.json({
            message: status === "cancelled" ? "Order cancelled and stock restored" : "Order status updated",
            order
        });
    } catch (error) {
        console.error("Update order:", error.message);
        return res.status(400).json({ message: error.message || "Unable to update order" });
    }
};

const deleteOrder = async (req, res) => res.status(405).json({
    message: "Orders cannot be deleted. Cancel the order to preserve its history and restore stock."
});

module.exports = { getOrders, getOrder, createOrder, updateOrder, deleteOrder };
