const PAGE_SIZE = 1000;
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || "Asia/Kolkata";

function monthKey(value) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit"
    }).formatToParts(new Date(value));
    const year = parts.find(part => part.type === "year").value;
    const month = parts.find(part => part.type === "month").value;
    return year + "-" + month;
}

// Supabase REST responses are capped. Fetch in bounded pages rather than
// silently calculating business metrics from only the first response page.
async function fetchAllRows(client, table, columns, orderColumn) {
    const rows = [];
    let from = 0;

    while (true) {
        let query = client.from(table).select(columns);
        if (orderColumn) query = query.order(orderColumn, { ascending: true });

        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const page = data || [];
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }

    return rows;
}

const getDashboardAnalytics = async (req, res) => {
    try {
        const [orders, products, customersResult] = await Promise.all([
            fetchAllRows(req.supabase, "orders", "id, total_amount, status, ordered_at", "ordered_at"),
            fetchAllRows(req.supabase, "products", "id, stock_quantity, reorder_level, is_active", "created_at"),
            req.supabase.from("customers").select("id", { count: "exact", head: true })
        ]);

        if (customersResult.error) throw customersResult.error;

        const completedOrders = orders.filter(order => order.status === "completed");
        const totalSales = completedOrders.reduce(
            (sum, order) => sum + Number(order.total_amount || 0), 0
        );
        const lowStockProducts = products.filter(product =>
            product.is_active !== false &&
            Number(product.stock_quantity) <= Number(product.reorder_level)
        );

        const currentMonthKey = monthKey(new Date());
        const [year, month] = currentMonthKey.split("-").map(Number);
        const previousMonthKey = monthKey(new Date(Date.UTC(year, month - 2, 15, 12)));

        const currentMonthSales = completedOrders.reduce((sum, order) =>
            monthKey(order.ordered_at) === currentMonthKey
                ? sum + Number(order.total_amount || 0)
                : sum, 0);
        const previousMonthSales = completedOrders.reduce((sum, order) =>
            monthKey(order.ordered_at) === previousMonthKey
                ? sum + Number(order.total_amount || 0)
                : sum, 0);
        const growthPercent = previousMonthSales === 0
            ? null
            : Number((((currentMonthSales - previousMonthSales) / previousMonthSales) * 100).toFixed(2));

        return res.status(200).json({
            totalProducts: products.filter(product => product.is_active !== false).length,
            totalCustomers: customersResult.count || 0,
            totalOrders: orders.length,
            completedOrders: completedOrders.length,
            totalSales: Number(totalSales.toFixed(2)),
            lowStockCount: lowStockProducts.length,
            lowStockProducts,
            currentMonthSales: Number(currentMonthSales.toFixed(2)),
            previousMonthSales: Number(previousMonthSales.toFixed(2)),
            growthPercent
        });
    } catch (error) {
        console.error("Dashboard analytics:", error.message);
        return res.status(500).json({ message: "Unable to calculate dashboard analytics" });
    }
};

const getSalesAnalytics = async (req, res) => {
    try {
        const data = await fetchAllRows(
            req.supabase,
            "orders",
            "id, order_number, total_amount, status, ordered_at",
            "ordered_at"
        );

        const monthlySales = {};
        data.filter(order => order.status === "completed").forEach(order => {
            const month = monthKey(order.ordered_at);
            monthlySales[month] = (monthlySales[month] || 0) + Number(order.total_amount || 0);
        });

        return res.status(200).json({
            monthlySales: Object.entries(monthlySales).map(([month, sales]) => ({
                month,
                sales: Number(sales.toFixed(2))
            })),
            orders: data
        });
    } catch (error) {
        console.error("Sales analytics:", error.message);
        return res.status(500).json({ message: "Unable to calculate sales analytics" });
    }
};

const getInventoryAnalytics = async (req, res) => {
    try {
        const products = await fetchAllRows(
            req.supabase,
            "products",
            "id, sku, name, category, price, cost_price, stock_quantity, reorder_level, is_active",
            "name"
        );

        const activeProducts = products.filter(product => product.is_active !== false);
        const lowStock = activeProducts.filter(product =>
            Number(product.stock_quantity) <= Number(product.reorder_level)
        );
        const inventoryCostValue = activeProducts.reduce(
            (sum, product) => sum + Number(product.cost_price || 0) * Number(product.stock_quantity || 0),
            0
        );
        const potentialRetailValue = activeProducts.reduce(
            (sum, product) => sum + Number(product.price || 0) * Number(product.stock_quantity || 0),
            0
        );

        return res.status(200).json({
            totalProducts: activeProducts.length,
            lowStockCount: lowStock.length,
            inventoryValue: Number(inventoryCostValue.toFixed(2)),
            inventoryCostValue: Number(inventoryCostValue.toFixed(2)),
            potentialRetailValue: Number(potentialRetailValue.toFixed(2)),
            lowStockProducts: lowStock,
            products: activeProducts
        });
    } catch (error) {
        console.error("Inventory analytics:", error.message);
        return res.status(500).json({ message: "Unable to calculate inventory analytics" });
    }
};

module.exports = { getDashboardAnalytics, getSalesAnalytics, getInventoryAnalytics };
