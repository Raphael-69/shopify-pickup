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

// 🔑 Generate token from order ID
function generateToken(orderId) {
  return crypto.createHash("sha1").update(orderId.toString()).digest("hex");
}

// ✅ Root health check
app.get("/", (req, res) => {
  res.send("🚀 Server is live and healthy!");
});

// 🔹 Confirm pickup → fulfill order
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

    // Step 1: Get fulfillment orders
    const fulfillmentOrdersUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${order_id}/fulfillment_orders.json`;
    const fulfillmentOrdersResp = await axios.get(fulfillmentOrdersUrl, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    const fulfillmentOrders = fulfillmentOrdersResp.data.fulfillment_orders;
    if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
      return res.status(404).send("No fulfillment orders found for this order.");
    }

    // Step 2: Create a fulfillment
    const fulfillmentOrderId = fulfillmentOrders[0].id;
    const fulfillmentUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/fulfillments.json`;
    const fulfillmentResp = await axios.post(
      fulfillmentUrl,
      {
        fulfillment: {
          message: "Pickup confirmed by customer",
          line_items_by_fulfillment_order: [
            { fulfillment_order_id: fulfillmentOrderId },
          ],
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (!fulfillmentResp.data.fulfillment) {
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
    res.status(err.response?.status || 500).send({
      success: false,
      error: err.response?.data || err.message || err,
    });
  }
});

// 🔹 Test env vars
app.get("/test-env", (req, res) => {
  res.json({
    SHOPIFY_ADMIN_TOKEN: SHOPIFY_ADMIN_TOKEN ? "✅ exists" : "❌ missing",
    SHOP_NAME: SHOP_NAME || "❌ missing",
    SHOPIFY_API_VERSION: API_VERSION || "❌ missing",
  });
});

// 🔹 Shopify shop test
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

// 🔹 Robust test-order
app.get("/test-order", async (req, res) => {
  const orderId = req.query.id;

  if (!orderId) {
    return res.status(400).json({ error: "Missing order ID in query string." });
  }
  if (!/^\d+$/.test(orderId)) {
    return res.status(400).json({ error: "Invalid order ID format. Must be numeric." });
  }

  try {
    const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${orderId}.json`;
    const response = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!response.data || !response.data.order) {
      return res.status(404).json({
        error: "Order not found. Double-check the order ID and Shopify store.",
        shopifyResponse: response.data,
      });
    }

    res.json({ success: true, order: response.data.order });
  } catch (err) {
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

// 🔹 List recent orders
app.get("/list-orders", async (req, res) => {
  try {
    const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders.json?limit=5`;
    const response = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!response.data.orders || response.data.orders.length === 0) {
      return res.json({ success: true, orders: [], message: "No orders found." });
    }

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

// ✅ Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
