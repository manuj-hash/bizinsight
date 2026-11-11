const fields = ["name", "email", "phone", "address"];

const getCustomers = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("customers")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false });
        if (error) throw error;
        return res.status(200).json(data || []);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load customers" });
    }
};

const getCustomer = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("customers")
            .select("*")
            .eq("id", req.params.id)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load customer" });
    }
};

const addCustomer = async (req, res) => {
    try {
        if (typeof req.body.name !== "string" || !req.body.name.trim()) {
            return res.status(400).json({ message: "Customer name is required" });
        }

        const payload = { name: req.body.name.trim() };
        for (const key of fields.slice(1)) {
            if (req.body[key] !== undefined) payload[key] = req.body[key];
        }

        const { data, error } = await req.supabase
            .from("customers")
            .insert(payload)
            .select()
            .single();
        if (error) throw error;

        return res.status(201).json({
            message: "Customer added successfully",
            customer: data
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to add customer" });
    }
};

const updateCustomer = async (req, res) => {
    try {
        const updates = {};
        for (const key of fields) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }
        if (!Object.keys(updates).length) {
            return res.status(400).json({ message: "No valid customer fields provided" });
        }
        if (updates.name !== undefined &&
            (typeof updates.name !== "string" || !updates.name.trim())) {
            return res.status(400).json({ message: "Customer name cannot be empty" });
        }
        if (updates.name) updates.name = updates.name.trim();

        const { data, error } = await req.supabase
            .from("customers")
            .update(updates)
            .eq("id", req.params.id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });

        return res.status(200).json({
            message: "Customer updated successfully",
            customer: data
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || "Unable to update customer" });
    }
};

// The Phase 1 migration adds is_active; this endpoint archives instead of deleting.
const deleteCustomer = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("customers")
            .update({ is_active: false })
            .eq("id", req.params.id)
            .select()
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });

        return res.status(200).json({
            message: "Customer archived. Historical orders are preserved.",
            customer: data
        });
    } catch (error) {
        return res.status(400).json({
            message: error.message || "Unable to archive customer. Apply the approved BizInsight migration first."
        });
    }
};

module.exports = { getCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer };
