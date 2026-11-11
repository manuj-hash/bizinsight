const supabase = require("../config/supabase");

const getDashboardAnalytics = async (req, res) => {
    try {
        const [
            ordersResult,
            productsResult,
            customersResult
        ] = await Promise.all([
            supabase
                .from("orders")
                .select("id, total_amount, status, ordered_at"),

            supabase
                .from("products")
                .select("id, stock_quantity, reorder_level, is_active"),

            supabase
                .from("customers")
                .select("id", { count: "exact", head: true })
        ]);

        if (ordersResult.error) throw ordersResult.error;
        if (productsResult.error) throw productsResult.error;
        if (customersResult.error) throw customersResult.error;

        const orders = ordersResult.data || [];
        const products = productsResult.data || [];

        const completedOrders = orders.filter(
            order => order.status === "completed"
        );

        const totalSales = completedOrders.reduce(
            (sum, order) => sum + Number(order.total_amount || 0),
            0
        );

        const lowStockProducts = products.filter(
            product =>
                product.is_active !== false &&
                Number(product.stock_quantity) <= Number(product.reorder_level)
        );

        const now = new Date();
        const currentMonthStart = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
        );

        const previousMonthStart = new Date(
            now.getFullYear(),
            now.getMonth() - 1,
            1
        );

        const currentMonthSales = completedOrders
            .filter(order => new Date(order.ordered_at) >= currentMonthStart)
            .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

        const previousMonthSales = completedOrders
            .filter(order => {
                const date = new Date(order.ordered_at);
                return date >= previousMonthStart && date < currentMonthStart;
            })
            .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

        const growthPercent = previousMonthSales === 0
            ? null
            : Number(
                (
                    ((currentMonthSales - previousMonthSales) /
                        previousMonthSales) *
                    100
                ).toFixed(2)
            );

        res.status(200).json({
            totalProducts: products.length,
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
        res.status(500).json({
            message: error.message
        });
    }
};

const getSalesAnalytics = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select("id, order_number, total_amount, status, ordered_at")
            .order("ordered_at", { ascending: true });

        if (error) throw error;

        const monthlySales = {};

        (data || [])
            .filter(order => order.status === "completed")
            .forEach(order => {
                const date = new Date(order.ordered_at);
                const month = `${date.getFullYear()}-${String(
                    date.getMonth() + 1
                ).padStart(2, "0")}`;

                monthlySales[month] =
                    (monthlySales[month] || 0) +
                    Number(order.total_amount || 0);
            });

        res.status(200).json({
            monthlySales: Object.entries(monthlySales).map(
                ([month, sales]) => ({
                    month,
                    sales: Number(sales.toFixed(2))
                })
            ),
            orders: data || []
        });
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

const getInventoryAnalytics = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("products")
            .select("id, sku, name, category, price, stock_quantity, reorder_level, is_active")
            .order("name");

        if (error) throw error;

        const products = data || [];

        const lowStock = products.filter(
            product =>
                product.is_active !== false &&
                Number(product.stock_quantity) <= Number(product.reorder_level)
        );

        const inventoryValue = products.reduce(
            (sum, product) =>
                sum +
                Number(product.price || 0) *
                Number(product.stock_quantity || 0),
            0
        );

        res.status(200).json({
            totalProducts: products.length,
            lowStockCount: lowStock.length,
            inventoryValue: Number(inventoryValue.toFixed(2)),
            lowStockProducts: lowStock,
            products
        });
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

module.exports = {
    getDashboardAnalytics,
    getSalesAnalytics,
    getInventoryAnalytics
};