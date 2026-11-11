
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
}

// Middleware
const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Same-origin requests do not need CORS headers. Cross-origin access
        // is allowed only for explicitly configured frontend origins.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
    }
}));
app.use(express.json({ limit: "1mb" }));

// Exact frontend location
const frontendPath = path.resolve(__dirname, "../front-end");

const loginPage = path.join(frontendPath, "index.html");

// Verify frontend
console.log("Frontend folder:", frontendPath);
console.log("Login page exists:", fs.existsSync(loginPage));

// Serve CSS, JS and other frontend files
app.use(express.static(frontendPath));

// Homepage
app.get("/", (req, res) => {
    res.sendFile(loginPage, (error) => {
        if (error) {
            console.error("Login page error:", error);
            res.status(500).send("Unable to load BizInsight login page.");
        }
    });
});

// API status
app.get("/api/status", (req, res) => {
    res.json({
        project: "BizInsight",
        database: "Supabase",
        status: "Running",
        message: "Backend API is working!"
    });
});

// API routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/inventory/movements", require("./routes/inventoryMovementRoutes"));
app.use("/api/customers", require("./routes/customerRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/api/users", require("./routes/userRoutes"));

// Unknown API
app.use("/api", (req, res) => {
    res.status(404).json({
        message: "API route not found",
        path: req.originalUrl
    });
});

// Unknown pages
app.use((req, res) => {
    res.status(404).send("Page not found");
});

// Error handler
app.use((error, req, res, next) => {
    console.error("Server Error:", error);
    res.status(500).json({
        message: "Internal server error"
    });
});

// Start server
app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("BIZINSIGHT SERVER RUNNING");
    console.log("--------------------------------");
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/status`);
    console.log("--------------------------------");
});
