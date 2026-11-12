const { getAdminClient } = require("../config/supabase");

const getCustomers = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("customers")
            .select("id,name,email,phone,address,qualification_reason,order_count,lifetime_value,created_at")
            .eq("is_valuable", true)
            .eq("is_active", true)
            .order("lifetime_value", { ascending: false });
        if (error) throw error;
        return res.json(data || []);
    } catch (error) {
        console.error("Customer registry error:", error.message);
        return res.status(500).json({ message: "Unable to load the valuable customer registry" });
    }
};

const getCustomer = async (req, res) => {
    try {
        const { data, error } = await req.supabase
            .from("customers")
            .select("id,name,email,phone,address,qualification_reason,order_count,lifetime_value,created_at")
            .eq("id", req.params.id)
            .eq("is_valuable", true)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Valuable customer not found" });
        return res.json(data);
    } catch (error) {
        return res.status(500).json({ message: "Unable to load customer" });
    }
};

const addCustomer = async (req, res) => res.status(405).json({
    message: "Customer profiles are created automatically when a buyer meets the configured frequent-customer or high-value threshold."
});

const updateCustomer = async (req, res) => res.status(405).json({
    message: "Customer qualification data is maintained from order history. Direct customer creation and editing are disabled."
});

const deleteCustomer = async (req, res) => {
    if (req.profile.role !== "admin") {
        return res.status(403).json({ message: "Only Admin can archive a valuable customer profile" });
    }
    try {
        const { data, error } = await getAdminClient().from("customers")
            .update({ is_active: false })
            .eq("id", req.params.id)
            .eq("is_valuable", true)
            .select("id,name,is_active").maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ message: "Valuable customer not found" });
        return res.json({ message: "Customer archived. Historical orders remain preserved.", customer: data });
    } catch (error) {
        console.error("Customer archive error:", error.message);
        return res.status(400).json({ message: "Unable to archive customer" });
    }
};

module.exports = { getCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer };
