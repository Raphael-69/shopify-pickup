// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOP_NAME = process.env.SHOP_NAME; // e.g. yourstore.myshopify.com
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function generateToken(orderId) {
  return crypto.createHash("sha1").update(orderId.toString()).digest("hex");
}

async function shopifyREST(method, endpoint, data = null) {
  const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}${endpoint}`;
  return axios({
    method,
    url,
    data,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
  });
}

// ✅ Health check / root route (add this)
app.get("/", (req, res) => {
  res.send("🚀 Server is live and healthy!");
});

// Confirm pickup → fulfill order
app.get("/pickup/confirm", async (req, res) => {
  try {
    const { order_id, token } = req.query;
    if (!order_id || !token) return res.status(400).send("Invalid request.");

    // Validate token
    const validToken = generateToken(order_id);
    if (token !== validToken) return res.status(403).send("Invalid or expired link.");

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
        line_items_by_fulfillment_order: [
          { fulfillment_order_id: fulfillmentOrderId },
        ],
      },
    });

    // Check success
    if (!fulfillmentResp.data.fulfillment) {
      console.error("Fulfillment error:", fulfillmentResp.data);
      return res.status(500).send("Could not fulfill order.");
    }

    // Success page
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
    res.status(500).send("Server error.");
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

// ✅ Always keep app.listen at the bottom
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
