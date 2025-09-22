// server.js
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;

const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOP_NAME = process.env.SHOP_NAME;
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

// 🔹 Helper: fetch order by ID
async function fetchOrder(orderId) {
  const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${orderId}.json`;
  const response = await axios.get(url, {
    headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
  });
  return response.data.order;
}

// 🔹 Show pickup confirmation page (Hebrew + button)
app.get("/pickup/confirm", async (req, res) => {
  try {
    const { order_id, token } = req.query;
    if (!order_id || !token) return res.status(400).send("בקשה לא חוקית: חסר order_id או token");

    const validToken = generateToken(order_id);
    if (token !== validToken) return res.status(403).send("קישור לא חוקי או פג תוקף");

    const order = await fetchOrder(order_id);
    if (!order) return res.status(404).send("ההזמנה לא נמצאה");

    // Already fulfilled
    if (order.fulfillment_status === "fulfilled") {
      return res.send("<h2>✅ ההזמנה כבר נאספה, הקישור אינו פעיל יותר</h2>");
    }

    // Payment not paid
    if (order.financial_status !== "paid") {
      return res.send("<h2>❌ לא ניתן לאשר את האיסוף – התשלום לא בוצע</h2>");
    }

    // Render confirmation page with JS for execution
    res.send(`
      <html>
      <body style="font-family:sans-serif;text-align:center;padding:50px;">
        <h2>האם לאשר את האיסוף?</h2>
        <button id="confirmBtn" style="padding:10px 20px;font-size:16px;">אישור איסוף</button>
        <p id="status" style="margin-top:20px;font-weight:bold;"></p>

        <script>
          const btn = document.getElementById("confirmBtn");
          const status = document.getElementById("status");

          btn.addEventListener("click", async () => {
            btn.disabled = true;
            status.textContent = "⏳ מתבצע אישור האיסוף...";

            try {
              const res = await fetch("/pickup/confirm/execute", {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                },
                body: JSON.stringify({ order_id: "${order_id}", token: "${token}" })
              });
              
              if (!res.ok) {
                throw new Error(\`HTTP \${res.status}: \${res.statusText}\`);
              }
              
              const text = await res.text();
              status.innerHTML = text;
            } catch (err) {
              console.error("Error:", err);
              status.textContent = "❌ שגיאה בביצוע האיסוף. נסה שוב מאוחר יותר.";
              btn.disabled = false;
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Pickup confirm error:", err.response?.data || err.message || err);
    res.status(500).send("שגיאה בשרת. נסה שוב מאוחר יותר.");
  }
});

// 🔹 Execute pickup fulfillment - SINGLE DEFINITION
app.post("/pickup/confirm/execute", async (req, res) => {
  try {
    console.log("Pickup execute request:", req.body);
    
    const { order_id, token } = req.body;
    if (!order_id || !token) {
      return res.status(400).send("<h2>❌ בקשה לא חוקית: חסר order_id או token</h2>");
    }

    // Validate token
    const validToken = generateToken(order_id);
    if (token !== validToken) {
      return res.status(403).send("<h2>❌ הקישור אינו חוקי או פג תוקף</h2>");
    }

    // Get order
    const order = await fetchOrder(order_id);
    if (!order) {
      return res.status(404).send("<h2>❌ ההזמנה לא נמצאה</h2>");
    }

    // Check if already fulfilled
    if (order.fulfillment_status === "fulfilled") {
      return res.status(200).send("<h2>✅ ההזמנה כבר נאספה, הקישור אינו פעיל יותר</h2>");
    }

    // Check payment status
    if (order.financial_status !== "paid") {
      return res.status(403).send("<h2>❌ לא ניתן לאשר את האיסוף – התשלום לא בוצע</h2>");
    }

    // Build fulfillment payload
    const lineItems = order.line_items.map(li => ({ id: li.id }));
    let locationId = order.location_id;

    // Get location if not set
    if (!locationId) {
      try {
        const locResp = await axios.get(`https://${SHOP_NAME}/admin/api/${API_VERSION}/locations.json`, {
          headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN }
        });
        if (locResp.data.locations?.length > 0) {
          locationId = locResp.data.locations[0].id;
        }
      } catch (locErr) {
        console.error("Location fetch error:", locErr.response?.data || locErr.message);
      }
    }

    const fulfillmentData = {
      fulfillment: {
        message: "Pickup confirmed by customer",
        notify_customer: true,
        line_items: lineItems,
        location_id: locationId,
      },
    };

    console.log("Creating fulfillment with data:", JSON.stringify(fulfillmentData, null, 2));

    // Create fulfillment
    const fulfillmentUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${order_id}/fulfillments.json`;
    const fulfillmentResp = await axios.post(fulfillmentUrl, fulfillmentData, {
      headers: { 
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, 
        "Content-Type": "application/json" 
      },
    });

    console.log("Fulfillment created:", fulfillmentResp.data);
    res.status(200).send("<h2>✅ האיסוף אושר בהצלחה!</h2>");

  } catch (err) {
    console.error("Pickup execute error:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    
    // Handle specific Shopify API errors
    if (err.response?.status === 422) {
      const errors = err.response.data?.errors || {};
      if (errors.line_items) {
        return res.status(422).send("<h2>❌ שגיאה: פריטים לא זמינים למילוי</h2>");
      }
      if (errors.base) {
        return res.status(422).send("<h2>❌ שגיאה בעיבוד ההזמנה</h2>");
      }
    }
    
    res.status(500).send("<h2>❌ שגיאה בביצוע האיסוף. נסה שוב מאוחר יותר.</h2>");
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
      headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
    });

    res.json({
      success: true,
      shop: response.data.shop,
      apiVersion: API_VERSION,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// 🔹 Robust test-order
app.get("/test-order", async (req, res) => {
  const orderId = req.query.id;
  if (!orderId) return res.status(400).json({ error: "Missing order ID in query string." });
  if (!/^\d+$/.test(orderId)) return res.status(400).json({ error: "Invalid order ID format. Must be numeric." });

  try {
    const order = await fetchOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found." });
    res.json({ success: true, order });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || err.message || err;
    console.error("Shopify API error:", status, data);
    res.status(status).json({ success: false, error: "Shopify API error", status, details: data });
  }
});

// 🔹 List recent orders
app.get("/list-orders", async (req, res) => {
  try {
    const url = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders.json?limit=5`;
    const response = await axios.get(url, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
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
    res.status(err.response?.status || 500).json({ success: false, error: err.response?.data || err.message });
  }
});

// ✅ Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));