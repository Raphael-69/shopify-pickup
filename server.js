// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOP_NAME = process.env.SHOP_NAME; // e.g. npe6ka-44.myshopify.com
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

function generateToken(orderId) {
  // produce same sha1 hex that Liquid's | sha1 produces
  return crypto.createHash("sha1").update(orderId.toString()).digest("hex");
}

async function shopifyGraphQL(body) {
  const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/graphql.json`;
  return axios.post(url, body, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    },
  });
}

app.get("/pickup/confirm", async (req, res) => {
  try {
    const { order_id, token } = req.query;
    if (!order_id || !token) return res.status(400).send("Invalid request.");

    // Validate token
    const validToken = generateToken(order_id);
    if (token !== validToken) return res.status(403).send("Invalid or expired link.");

    // 1) Query order to check current status
    const queryOrder = `
      query order($id: ID!) {
        order(id: $id) {
          id
          name
          displayFulfillmentStatus
        }
      }
    `;
    const gid = `gid://shopify/Order/${order_id}`;
    const orderResp = await shopifyGraphQL({ query: queryOrder, variables: { id: gid } });
    const orderData = orderResp.data;

    if (orderData.errors) {
      console.error("Order query errors:", orderData.errors);
      return res.status(500).send("Error fetching order.");
    }

    const order = orderData.data.order;
    if (!order) return res.status(404).send("Order not found.");

    // If already fulfilled, don't re-fulfill
    if (order.displayFulfillmentStatus && order.displayFulfillmentStatus.toUpperCase().includes("FULFILLED")) {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h2>✅ Pickup already confirmed</h2>
          <p>Order #${order_id} was already fulfilled.</p>
        </body></html>
      `);
    }

    // 2) Fulfill the order (GraphQL)
    const fulfillMutation = `
      mutation fulfillOrder($orderId: ID!) {
        orderFulfill(orderId: $orderId, fulfillment: { notifyCustomer: false }) {
          order {
            id
            displayFulfillmentStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const fulfillResp = await shopifyGraphQL({ query: fulfillMutation, variables: { orderId: gid } });
    const fulfillData = fulfillResp.data;

    if (fulfillData.errors) {
      console.error("Fulfill errors:", fulfillData.errors);
      return res.status(500).send("Error fulfilling order.");
    }
    if (fulfillData.data.orderFulfill && fulfillData.data.orderFulfill.userErrors.length > 0) {
      console.error("User errors:", fulfillData.data.orderFulfill.userErrors);
      return res.status(500).send("Could not fulfill order.");
    }

    // Success response page
    res.send(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:50px;">
          <h2>✅ Pickup Confirmed</h2>
          <p>Your order #${order_id} has been marked as Fulfilled.</p>
          <p>Show this screen to staff.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Server error:", err.response?.data || err.message || err);
    res.status(500).send("Server error.");
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Add this temporarily at the bottom of server.js

app.get("/test-shopify", async (req, res) => {
  try {
    const url = `https://${process.env.SHOP_NAME}/admin/api/${process.env.SHOPIFY_API_VERSION}/shop.json`;

    const response = await axios.get(url, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json",
      },
    });

    res.send({
      success: true,
      shop: response.data.shop,
      apiVersion: process.env.SHOPIFY_API_VERSION,
    });
  } catch (err) {
    console.error("Shopify test error:", err.response?.data || err.message);
    res.status(500).send({
      success: false,
      error: err.response?.data || err.message,
    });
  }
});
