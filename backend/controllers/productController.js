const supabase = require("../config/supabase");

const getProducts = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("products")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getProduct = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("products")
            .select("*")
            .eq("id", req.params.id)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const addProduct = async (req, res) => {
    try {
        const {
            sku,
            name,
            description,
            category,
            price,
            cost_price,
            stock_quantity,
            reorder_level
        } = req.body;

        if (!sku || !name || price === undefined) {
            return res.status(400).json({
                message: "SKU, name and price are required"
            });
        }

        if (
            Number(price) < 0 ||
            Number(cost_price || 0) < 0 ||
            Number(stock_quantity || 0) < 0 ||
            Number(reorder_level || 0) < 0
        ) {
            return res.status(400).json({
                message: "Price and stock values cannot be negative"
            });
        }

        const { data, error } = await supabase
            .from("products")
            .insert([{
                sku,
                name,
                description: description || null,
                category: category || null,
                price: Number(price),
                cost_price: Number(cost_price || 0),
                stock_quantity: Number(stock_quantity || 0),
                reorder_level: Number(reorder_level || 0)
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            message: "Product added successfully",
            product: data
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const updateProduct = async (req, res) => {
    try {
        const allowedFields = [
            "sku",
            "name",
            "description",
            "category",
            "price",
            "cost_price",
            "stock_quantity",
            "reorder_level",
            "is_active"
        ];

        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) updates[field] = req.body[field];
        }

        for (const field of ["price", "cost_price", "stock_quantity", "reorder_level"]) {
            if (updates[field] !== undefined) {
                const value = Number(updates[field]);
                if (!Number.isFinite(value) || value < 0 ||
                    (["stock_quantity", "reorder_level"].includes(field) && !Number.isInteger(value))) {
                    return res.status(400).json({ message: `${field} must be a valid non-negative ${["stock_quantity", "reorder_level"].includes(field) ? "integer" : "number"}` });
                }
                updates[field] = value;
            }
        }
        if (updates.name !== undefined && (typeof updates.name !== "string" || !updates.name.trim())) {
            return res.status(400).json({ message: "Product name cannot be empty" });
        }
        if (updates.sku !== undefined && (typeof updates.sku !== "string" || !updates.sku.trim())) {
            return res.status(400).json({ message: "SKU cannot be empty" });
        }
        if (updates.name) updates.name = updates.name.trim();
        if (updates.sku) updates.sku = updates.sku.trim();

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                message: "No valid fields provided for update"
            });
        }

        const { data, error } = await supabase
            .from("products")
            .update(updates)
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        res.status(200).json({
            message: "Product updated successfully",
            product: data
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("products")
            .delete()
            .eq("id", req.params.id)
            .select()
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        res.status(200).json({
            message: "Product deleted successfully"
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getProducts,
    getProduct,
    addProduct,
    updateProduct,
    deleteProduct
};