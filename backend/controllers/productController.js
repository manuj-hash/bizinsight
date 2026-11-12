const { getAdminClient } = require("../config/supabase");

const getProducts = async (req, res) => {
    try {
        const canViewFullInventory = req.profile.role === "admin" ||
            (req.permissions && (req.permissions.has("inventory.view") || req.permissions.has("reports.view")));
        const columns = canViewFullInventory ? "*" : "id,sku,name,description,category,price,stock_quantity,reorder_level,is_active,created_at";
        const { data, error } = await req.supabase
            .from("products")
            .select(columns)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json(data || []);
    } catch (error) {
        console.error("Get products:", error.message);
        return res.status(500).json({ message: "Unable to load products" });
    }
};

const getProduct = async (req, res) => {
    try {
        const canViewFullInventory = req.profile.role === "admin" ||
            (req.permissions && (req.permissions.has("inventory.view") || req.permissions.has("reports.view")));
        const columns = canViewFullInventory ? "*" : "id,sku,name,description,category,price,stock_quantity,reorder_level,is_active,created_at";
        const { data, error } = await req.supabase
            .from("products")
            .select(columns)
            .eq("id", req.params.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Product not found" });
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load product" });
    }
};

const addProduct = async (req, res) => {
    try {
        const {
            sku, name, description, category, price,
            cost_price, stock_quantity = 0, reorder_level = 0
        } = req.body;

        const initialStock = Number(stock_quantity);
        const sellingPrice = Number(price);
        const costPrice = Number(cost_price || 0);
        const reorderLevel = Number(reorder_level || 0);

        if (typeof sku !== "string" || !sku.trim() ||
            typeof name !== "string" || !name.trim() ||
            price === undefined) {
            return res.status(400).json({
                message: "SKU, product name and selling price are required"
            });
        }

        if (![sellingPrice, costPrice, initialStock, reorderLevel].every(Number.isFinite) ||
            sellingPrice < 0 || costPrice < 0 || initialStock < 0 || reorderLevel < 0 ||
            !Number.isInteger(initialStock) || !Number.isInteger(reorderLevel)) {
            return res.status(400).json({
                message: "Prices must be non-negative numbers; stock and reorder level must be non-negative integers"
            });
        }

        // Create with zero stock. Opening stock is added through the audited RPC.
        const { data: product, error } = await req.supabase
            .from("products")
            .insert([{
                sku: sku.trim(),
                name: name.trim(),
                description: description || null,
                category: category || null,
                price: sellingPrice,
                cost_price: costPrice,
                reorder_level: reorderLevel
            }])
            .select()
            .single();

        if (error) throw error;

        if (initialStock > 0) {
            const { error: movementError } = await getAdminClient().rpc(
                "record_bizinsight_stock_movement",
                {
                    p_product_id: product.id,
                    p_quantity_delta: initialStock,
                    p_reason: "Opening stock when product was created",
                    p_created_by: req.user.id
                }
            );

            if (movementError) {
                console.error("Opening stock movement failed:", movementError.message);
                return res.status(202).json({
                    message: "Product created with zero stock. Opening stock could not be recorded; use the stock movement action.",
                    product
                });
            }
        }

        const { data: savedProduct } = await getAdminClient()
            .from("products")
            .select("*")
            .eq("id", product.id)
            .single();

        return res.status(201).json({
            message: "Product added successfully",
            product: savedProduct || product
        });
    } catch (error) {
        console.error("Add product:", error.message);
        return res.status(400).json({ message: error.message || "Unable to add product" });
    }
};

const updateProduct = async (req, res) => {
    try {
        if (req.body.stock_quantity !== undefined) {
            return res.status(400).json({
                message: "Stock cannot be edited in product details. Record a stock movement with a reason."
            });
        }

        const allowedFields = [
            "sku", "name", "description", "category",
            "price", "cost_price", "reorder_level"
        ];
        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        for (const field of ["price", "cost_price", "reorder_level"]) {
            if (updates[field] !== undefined) {
                const value = Number(updates[field]);
                if (!Number.isFinite(value) || value < 0 ||
                    (field === "reorder_level" && !Number.isInteger(value))) {
                    return res.status(400).json({
                        message: `${field} must be a valid non-negative ${field === "reorder_level" ? "integer" : "number"}`
                    });
                }
                updates[field] = value;
            }
        }

        if (updates.name !== undefined) {
            if (typeof updates.name !== "string" || !updates.name.trim()) {
                return res.status(400).json({ message: "Product name cannot be empty" });
            }
            updates.name = updates.name.trim();
        }
        if (updates.sku !== undefined) {
            if (typeof updates.sku !== "string" || !updates.sku.trim()) {
                return res.status(400).json({ message: "SKU cannot be empty" });
            }
            updates.sku = updates.sku.trim();
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: "No valid product fields provided" });
        }

        const { data, error } = await req.supabase
            .from("products")
            .update(updates)
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Product not found" });

        return res.status(200).json({
            message: "Product updated successfully",
            product: data
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update product" });
    }
};

// Archive instead of physically deleting a product referenced by historical orders.
const deleteProduct = async (req, res) => {
    try {
        const { data, error } = await getAdminClient()
            .from("products")
            .update({ is_active: false })
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Product not found" });

        return res.status(200).json({
            message: "Product archived. Historical order records are preserved.",
            product: data
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to archive product" });
    }
};

module.exports = { getProducts, getProduct, addProduct, updateProduct, deleteProduct };
