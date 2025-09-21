// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOP_NAME = process.env.SHOP_NAME; // e.g. yourstore.myshopify.com
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-07";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function generateToken(orderId) {
  return crypto.createHash("sha1").update(orderId.toString()).digest("hex");
}

async function shopifyREST(method, endpoint, data = null) {
  // Ensure endpoint always starts with "/"
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : "/" + endpoint;

  const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}${cleanEndpoint}`;

  try {
    const response = await axios({
      method,
      url,
      data,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
    });
    return response;
  } catch (err) {
    // Log exact Shopify error for debugging in Render
    console.error("Shopify API error:", err.response?.data || err.message);
    throw err;
  }
}


// ✅ Health check / root route (add this)
app.get("/", (req, res) => {
  res.send("🚀 Server is live and healthy!");
});

// Confirm pickup → fulfill order
app.get("/pickup/confirm", async (req, res) => {
  try {
    const { order_id, token } = req.query;
    if (!order_id || !token) {
      return res.status(400).send("Invalid request: missing order_id or token.");
    }

    // Validate token
    const validToken = generateToken(order_id);
    if (token !== validToken) {
      return res.status(403).send("Invalid or expired link.");
    }

    // Step 1: Get fulfillment orders for this order
    const fulfillmentOrdersResp = await shopifyREST(
      "get",
      `/orders/${order_id}/fulfillment_orders.json`
    );

    const fulfillmentOrders = fulfillmentOrdersResp.data.fulfillment_orders;
    if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
      return res.status(404).send("No fulfillment orders found for this order.");
    }

    // Step 2: Create a fulfillment
    const fulfillmentOrderId = fulfillmentOrders[0].id;
    const fulfillmentResp = await shopifyREST("post", `/fulfillments.json`, {
      fulfillment: {
        message: "Pickup confirmed by customer",
        line_items_by_fulfillment_order: [
          { fulfillment_order_id: fulfillmentOrderId },
        ],
      },
    });

    // Check success
    if (!fulfillmentResp.data.fulfillment) {
      console.error("Fulfillment error:", fulfillmentResp.data);
      return res.status(500).send({
        success: false,
        error: fulfillmentResp.data || "Could not fulfill order.",
      });
    }

    // ✅ Success page
    res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h2>✅ Pickup Confirmed</h2>
          <p>Your order #${order_id} has been marked as Fulfilled.</p>
          <p>Show this screen to staff when picking up.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Server error:", err.response?.data || err.message || err);
    res.status(500).send({
      success: false,
      error: err.response?.data || err.message || err,
    });
  }
});


// Test env
app.get("/test-env", (req, res) => {
  res.json({
    SHOPIFY_ADMIN_TOKEN: SHOPIFY_ADMIN_TOKEN ? "✅ exists" : "❌ missing",
    SHOP_NAME: SHOP_NAME || "❌ missing",
    SHOPIFY_API_VERSION: API_VERSION || "❌ missing",
  });
});

// Shopify test
app.get("/test-shopify", async (req, res) => {
  try {
    const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/shop.json`;
    const response = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    res.send({
      success: true,
      shop: response.data.shop,
      apiVersion: API_VERSION,
    });
  } catch (err) {
    console.error("Shopify test error:", err.response?.data || err.message);
    res.status(500).send({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});

// Robust test-order route
app.get("/test-order", async (req, res) => {
  const orderId = req.query.id;

  // 1️⃣ Validate input
  if (!orderId) {
    return res.status(400).json({ error: "Missing order ID in query string." });
  }

  // Ensure orderId is numeric
  if (!/^\d+$/.test(orderId)) {
    return res.status(400).json({ error: "Invalid order ID format. Must be numeric." });
  }

  try {
    console.log(`Fetching order ID: ${orderId} from Shopify...`);

    const response = await shopifyREST("get", `/orders/${orderId}.json`);

    if (!response.data || !response.data.order) {
      // Shopify returned 200 but no order
      return res.status(404).json({
        error: "Order not found. Double-check the order ID and Shopify store.",
        shopifyResponse: response.data,
      });
    }

    console.log("Shopify order fetched successfully:", response.data.order.id);
    res.json({
      success: true,
      order: response.data.order,
    });

  } catch (err) {
    // Capture Shopify error code and message
    const status = err.response?.status || 500;
    const data = err.response?.data || err.message || err;

    console.error("Shopify API error:", status, data);

    res.status(status).json({
      success: false,
      error: "Shopify API error",
      status,
      details: data,
      hint: "Check order ID, shop name, and API token permissions.",
    });
  }
});

// Route to list recent Shopify orders
app.get("/list-orders", async (req, res) => {
  try {
    const response = await shopifyREST(
      "get",
      "/orders.json?limit=5" // Change limit if you want more orders
    );

    if (!response.data.orders || response.data.orders.length === 0) {
      return res.json({ success: true, orders: [], message: "No orders found." });
    }

    // Return order IDs and basic info
    const orders = response.data.orders.map(order => ({
      id: order.id,
      name: order.name,
      email: order.email,
      created_at: order.created_at,
      total_price: order.total_price,
    }));

    res.json({ success: true, orders });

  } catch (err) {
    console.error("Shopify API error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message,
      hint: "Check Shopify token permissions and shop domain.",
    });
  }
});


// ✅ Always keep app.listen at the bottom
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
