const supabase = require("../config/supabase");
const fields = ["name", "email", "phone", "address"];

const getCustomers = async (req, res) => {
    try {
        const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getCustomer = async (req, res) => {
    try {
        const { data, error } = await supabase.from("customers").select("*").eq("id", req.params.id).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const addCustomer = async (req, res) => {
    try {
        if (typeof req.body.name !== "string" || !req.body.name.trim())
            return res.status(400).json({ message: "Customer name is required" });
        const payload = { name: req.body.name.trim() };
        for (const key of fields.slice(1)) if (req.body[key] !== undefined) payload[key] = req.body[key];
        const { data, error } = await supabase.from("customers").insert(payload).select().single();
        if (error) throw error;
        res.status(201).json({ message: "Customer added successfully", customer: data });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const updateCustomer = async (req, res) => {
    try {
        const updates = {};
        for (const key of fields) if (req.body[key] !== undefined) updates[key] = req.body[key];
        if (!Object.keys(updates).length) return res.status(400).json({ message: "No valid customer fields provided" });
        if (updates.name !== undefined && (typeof updates.name !== "string" || !updates.name.trim()))
            return res.status(400).json({ message: "Customer name cannot be empty" });
        if (updates.name) updates.name = updates.name.trim();
        const { data, error } = await supabase.from("customers").update(updates).eq("id", req.params.id).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });
        res.json({ message: "Customer updated successfully", customer: data });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const deleteCustomer = async (req, res) => {
    try {
        const { data, error } = await supabase.from("customers").delete().eq("id", req.params.id).select().maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Customer not found" });
        res.json({ message: "Customer deleted successfully" });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

module.exports = { getCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer };
