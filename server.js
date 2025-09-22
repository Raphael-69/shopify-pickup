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

    // Get order with more detailed logging
    const order = await fetchOrder(order_id);
    if (!order) {
      return res.status(404).send("<h2>❌ ההזמנה לא נמצאה</h2>");
    }

    console.log("Order details:", {
      id: order.id,
      fulfillment_status: order.fulfillment_status,
      financial_status: order.financial_status,
      line_items_count: order.line_items?.length,
      location_id: order.location_id
    });

    // Check if already fulfilled
    if (order.fulfillment_status === "fulfilled") {
      return res.status(200).send("<h2>✅ ההזמנה כבר נאספה, הקישור אינו פעיל יותר</h2>");
    }

    // Check payment status
    if (order.financial_status !== "paid") {
      return res.status(403).send("<h2>❌ לא ניתן לאשר את האיסוף – התשלום לא בוצע</h2>");
    }

    // Check if there are unfulfilled line items
    const unfulfilledLineItems = order.line_items.filter(li => 
      (li.fulfillment_status === null || li.fulfillment_status === 'unfulfilled') && 
      li.fulfillable_quantity > 0
    );

    if (unfulfilledLineItems.length === 0) {
      return res.status(400).send("<h2>❌ אין פריטים זמינים למילוי</h2>");
    }

    console.log("Unfulfilled line items:", unfulfilledLineItems.map(li => ({
      id: li.id,
      quantity: li.quantity,
      fulfillable_quantity: li.fulfillable_quantity,
      fulfillment_status: li.fulfillment_status
    })));

    // Build line items with quantity
    const lineItems = unfulfilledLineItems.map(li => ({ 
      id: li.id,
      quantity: li.fulfillable_quantity
    }));

    let locationId = order.location_id;

    // Get location if not set
    if (!locationId) {
      try {
        const locResp = await axios.get(`https://${SHOP_NAME}/admin/api/${API_VERSION}/locations.json`, {
          headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN }
        });
        if (locResp.data.locations?.length > 0) {
          locationId = locResp.data.locations[0].id;
          console.log("Using location:", locationId);
        } else {
          console.log("No locations found");
        }
      } catch (locErr) {
        console.error("Location fetch error:", locErr.response?.data || locErr.message);
      }
    }

    // Try different fulfillment data structures to avoid 406
    const fulfillmentData = {
      fulfillment: {
        line_items: lineItems,
        location_id: locationId,
        notify_customer: true,
        tracking_company: null,
        tracking_number: null,
        message: "Pickup confirmed by customer"
      },
    };

    console.log("Creating fulfillment with data:", JSON.stringify(fulfillmentData, null, 2));

    // Create fulfillment with proper headers
    const fulfillmentUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${order_id}/fulfillments.json`;
    const fulfillmentResp = await axios.post(fulfillmentUrl, fulfillmentData, {
      headers: { 
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, 
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
    });

    console.log("Fulfillment created:", fulfillmentResp.data);
    res.status(200).send("<h2>✅ האיסוף אושר בהצלחה!</h2>");

  } catch (err) {
    console.error("Pickup execute error:", {
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      message: err.message,
      headers: err.response?.headers
    });
    
    // Handle specific Shopify API errors
    if (err.response?.status === 406) {
      // Try alternative fulfillment approach for 406 errors
      try {
        console.log("Attempting alternative fulfillment method...");
        await handleAlternativeFulfillment(order_id, res);
        return;
      } catch (altErr) {
        console.error("Alternative fulfillment failed:", altErr);
        return res.status(406).send("<h2>❌ שגיאה בממשק API של Shopify. צור קשר עם התמיכה.</h2>");
      }
    }
    
    if (err.response?.status === 422) {
      const errors = err.response.data?.errors || {};
      console.log("422 errors:", errors);
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

// Alternative fulfillment method for 406 errors
async function handleAlternativeFulfillment(order_id, res) {
  try {
    // First, try to get the order again to get fresh data
    const order = await fetchOrder(order_id);
    
    // Get all unfulfilled line items
    const unfulfilledItems = order.line_items.filter(item => 
      item.fulfillment_status === null || item.fulfillment_status === 'unfulfilled'
    );

    if (unfulfilledItems.length === 0) {
      return res.status(400).send("<h2>❌ כל הפריטים כבר מולאו</h2>");
    }

    // Try different approaches in order of preference
    const approaches = [
      // Approach 1: Minimal fulfillment without line_items (fulfill all unfulfilled)
      {
        fulfillment: {
          notify_customer: true,
          message: "Order ready for pickup"
        }
      },
      // Approach 2: Just location and notification
      {
        fulfillment: {
          location_id: 78097875044, // חנות location from your setup
          notify_customer: false
        }
      },
      // Approach 3: Absolutely minimal
      {
        fulfillment: {
          notify_customer: false
        }
      }
    ];

    for (let i = 0; i < approaches.length; i++) {
      try {
        console.log(`Trying approach ${i + 1}:`, JSON.stringify(approaches[i], null, 2));
        
        const fulfillmentUrl = `https://${SHOP_NAME}/admin/api/${API_VERSION}/orders/${order_id}/fulfillments.json`;
        const response = await axios.post(fulfillmentUrl, approaches[i], {
          headers: { 
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN, 
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
        });

        console.log(`Approach ${i + 1} succeeded:`, response.data);
        return res.status(200).send("<h2>✅ האיסוף אושר בהצלחה!</h2>");
      } catch (err) {
        console.log(`Approach ${i + 1} failed:`, err.response?.status, err.response?.data);
        if (i === approaches.length - 1) {
          throw err; // Re-throw if this was the last approach
        }
      }
    }
  } catch (finalErr) {
    console.error("All alternative approaches failed:", finalErr.response?.data || finalErr.message);
    throw finalErr;
  }
}

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

// 🔹 Debug specific order fulfillment status
app.get("/debug-order/:orderId", async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const order = await fetchOrder(orderId);
    
    const debugInfo = {
      order_id: order.id,
      order_number: order.name,
      fulfillment_status: order.fulfillment_status,
      financial_status: order.financial_status,
      location_id: order.location_id,
      fulfillment_service: order.fulfillment_service,
      line_items: order.line_items.map(li => ({
        id: li.id,
        name: li.name,
        quantity: li.quantity,
        fulfillable_quantity: li.fulfillable_quantity,
        fulfillment_status: li.fulfillment_status,
        fulfillment_service: li.fulfillment_service,
        product_exists: li.product_exists,
        requires_shipping: li.requires_shipping
      })),
      existing_fulfillments: order.fulfillments || [],
      shipping_lines: order.shipping_lines?.map(sl => ({
        title: sl.title,
        source: sl.source,
        code: sl.code
      })) || []
    };
    
    res.json({ success: true, debug: debugInfo });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.response?.data || err.message 
    });
  }
});

// ✅ Start server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));