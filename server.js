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

// 🔹 Hardcoded Shopify Location IDs
const LOCATIONS = {
  STORE: 78097875044,     // חנות - Tel Aviv
  WAREHOUSE: 79217262692  // מחסן - Holon
};

// 🔹 In-memory store to track picked-up orders
// For production, use a database
const pickedUpOrders = {};

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

// 🔹 Show pickup confirmation page
app.get("/pickup/confirm", async (req, res) => {
  try {
    const { order_id, token } = req.query;
    if (!order_id || !token) return res.status(400).send("בקשה לא חוקית: חסר order_id או token");

    const validToken = generateToken(order_id);
    if (token !== validToken) return res.status(403).send("קישור לא חוקי או פג תוקף");

    // Check if already picked up
    if (pickedUpOrders[order_id]) {
      return res.send("<h2>❌ הקישור פג תוקף – האיסוף כבר אושר</h2>");
    }

    const order = await fetchOrder(order_id);
    if (!order) return res.status(404).send("ההזמנה לא נמצאה");

    // Payment not paid
    if (order.financial_status !== "paid") {
      return res.send("<h2>❌ לא ניתן לאשר את האיסוף – התשלום לא בוצע</h2>");
    }

    // Render confirmation page
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
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ order_id: "${order_id}", token: "${token}" })
              });
              
              if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`);
              const text = await res.text();
              status.innerHTML = text;
            } catch (err) {
              status.textContent = "❌ שגיאה בביצוע האיסוף. נסה שוב מאוחר יותר.";
              btn.disabled = false;
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Pickup confirm error:", err.response?.data || err.message);
    res.status(500).send("שגיאה בשרת. נסה שוב מאוחר יותר.");
  }
});

// 🔹 Execute pickup fulfillment
app.post("/pickup/confirm/execute", async (req, res) => {
  try {
    const { order_id, token } = req.body;
    if (!order_id || !token)
      return res.status(400).send("<h2>❌ בקשה לא חוקית: חסר order_id או token</h2>");

    const validToken = generateToken(order_id);
    if (token !== validToken)
      return res.status(403).send("<h2>❌ הקישור אינו חוקי או פג תוקף</h2>");

    // Check if already picked up
    if (pickedUpOrders[order_id]) {
      return res.status(200).send("<h2>❌ הקישור פג תוקף – האיסוף כבר אושר</h2>");
    }

    const order = await fetchOrder(order_id);
    if (!order) return res.status(404).send("<h2>❌ ההזמנה לא נמצאה</h2>");
    if (order.financial_status !== "paid") return res.status(403).send("<h2>❌ לא ניתן לאשר את האיסוף – התשלום לא בוצע</h2>");

    // Find unfulfilled items
    const unfulfilledLineItems = order.line_items.filter(
      li => (!li.fulfillment_status || li.fulfillment_status === "unfulfilled") && li.fulfillable_quantity > 0
    );

    if (unfulfilledLineItems.length === 0) {
      return res.status(400).send("<h2>❌ אין פריטים זמינים למילוי</h2>");
    }

    const shopifyItems = unfulfilledLineItems.filter(
      li => li.fulfillment_service !== "manual"
    );
    const manualItems = unfulfilledLineItems.filter(
      li => li.fulfillment_service === "manual"
    );

    // Determine location
    let locationId = LOCATIONS.STORE;
    if (order.shipping_lines && order.shipping_lines.length > 0) {
      const shippingLine = order.shipping_lines[0];
      if (shippingLine.title.includes("מחסן") || shippingLine.code === "מחסן") {
        locationId = LOCATIONS.WAREHOUSE;
      } else if (shippingLine.title.includes("חנות") || shippingLine.code === "חנות") {
        locationId = LOCATIONS.STORE;
      }
    }

    // Fulfill Shopify items via API
    if (shopifyItems.length > 0) {
      const lineItems = shopifyItems.map(li => ({ id: li.id, quantity: li.fulfillable_quantity }));

      const fulfillmentData = {
        fulfillment: {
          location_id: locationId,
          line_items: lineItems,
          notify_customer: true,
          message: "Pickup confirmed by customer"
        }
      };

      const fulfillmentUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${order_id}/fulfillments.json`;

      try {
        const response = await axios.post(fulfillmentUrl, fulfillmentData, {
          headers: {
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
            "Content-Type": "application/json",
            Accept: "application/json"
          }
        });
        console.log("Fulfillment response:", response.data);
      } catch (err) {
        console.error("Shopify fulfillment error:", err.response?.data || err.message);
        return res.status(500).send("<h2>❌ שגיאה בביצוע האיסוף</h2>");
      }
    }

    // Log manual items
    if (manualItems.length > 0) {
      console.log(`Manual items picked up for order ${order_id}:`, manualItems.map(i => i.title));
      // Optionally, mark them as picked up in your DB
    }

    // ✅ Mark order as picked up (single-use)
    pickedUpOrders[order_id] = true;

    return res.status(200).send("<h2>✅ האיסוף אושר בהצלחה!</h2>");
  } catch (err) {
    console.error("Pickup execute error full:", err.response?.data || err.message);
    res.status(500).send(`<h2>❌ Error: ${err.response?.data?.errors || err.message}</h2>`);
  }
});

// ✅ Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
