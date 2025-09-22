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

// ✅ Beautiful Landing Page
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>מערכת איסוף הזמנות | Pickup System</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          overflow: hidden;
        }

        .container {
          text-align: center;
          max-width: 600px;
          padding: 40px;
          position: relative;
          z-index: 2;
        }

        .logo {
          width: 120px;
          height: 120px;
          margin: 0 auto 30px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          backdrop-filter: blur(10px);
          border: 2px solid rgba(255, 255, 255, 0.2);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .title {
          font-size: 3rem;
          font-weight: 700;
          margin-bottom: 15px;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          background: linear-gradient(45deg, #fff, #f0f8ff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .subtitle {
          font-size: 1.4rem;
          margin-bottom: 40px;
          opacity: 0.9;
          font-weight: 300;
        }

        .status-card {
          background: rgba(255, 255, 255, 0.1);
          padding: 30px;
          border-radius: 20px;
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          margin-bottom: 30px;
          transition: transform 0.3s ease;
        }

        .status-card:hover {
          transform: translateY(-5px);
        }

        .status-icon {
          font-size: 2.5rem;
          margin-bottom: 15px;
          animation: bounce 2s infinite;
        }

        @keyframes bounce {
          0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-10px); }
          60% { transform: translateY(-5px); }
        }

        .status-text {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 10px;
        }

        .features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin: 30px 0;
        }

        .feature {
          background: rgba(255, 255, 255, 0.08);
          padding: 20px;
          border-radius: 15px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }

        .feature:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: scale(1.02);
        }

        .feature-icon {
          font-size: 2rem;
          margin-bottom: 10px;
        }

        .feature-title {
          font-weight: 600;
          margin-bottom: 5px;
        }

        .feature-desc {
          font-size: 0.9rem;
          opacity: 0.8;
        }

        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
          font-size: 0.9rem;
          opacity: 0.7;
        }

        /* Background Animation */
        .bg-animation {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          z-index: 1;
        }

        .floating-shape {
          position: absolute;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          animation: float 6s ease-in-out infinite;
        }

        .shape1 {
          width: 80px;
          height: 80px;
          top: 10%;
          left: 10%;
          animation-delay: 0s;
        }

        .shape2 {
          width: 120px;
          height: 120px;
          top: 70%;
          right: 10%;
          animation-delay: 2s;
        }

        .shape3 {
          width: 60px;
          height: 60px;
          top: 20%;
          right: 20%;
          animation-delay: 4s;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }

        @media (max-width: 768px) {
          .container {
            padding: 20px;
          }
          
          .title {
            font-size: 2rem;
          }
          
          .subtitle {
            font-size: 1.1rem;
          }
          
          .features {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <div class="bg-animation">
        <div class="floating-shape shape1"></div>
        <div class="floating-shape shape2"></div>
        <div class="floating-shape shape3"></div>
      </div>

      <div class="container">
        <div class="logo">
          🚀
        </div>
        
        <h1 class="title">מערכת איסוף</h1>
        <p class="subtitle">Pickup Management System</p>
        
        <div class="status-card">
          <div class="status-icon">✅</div>
          <div class="status-text">השרת פעיל ומוכן לשימוש</div>
          <div style="opacity: 0.8;">Server is Live & Healthy</div>
        </div>

        <div class="features">
          <div class="feature">
            <div class="feature-icon">📦</div>
            <div class="feature-title">ניהול הזמנות</div>
            <div class="feature-desc">מעקב ועדכון סטטוס הזמנות</div>
          </div>
          
          <div class="feature">
            <div class="feature-icon">🔐</div>
            <div class="feature-title">אבטחה מתקדמת</div>
            <div class="feature-desc">הגנה עם טוקנים מוצפנים</div>
          </div>
          
          <div class="feature">
            <div class="feature-icon">⚡</div>
            <div class="feature-title">מהירות גבוהה</div>
            <div class="feature-desc">עיבוד מהיר ויעיל</div>
          </div>
          
          <div class="feature">
            <div class="feature-icon">📱</div>
            <div class="feature-title">נגיש בכל מקום</div>
            <div class="feature-desc">תומך בכל המכשירים</div>
          </div>
        </div>

        <div class="footer">
          <p>🌟 Powered by Modern Technology Stack</p>
          <p>Port: ${PORT} | Version: 1.0</p>
        </div>
      </div>

      <script>
        // Add some interactive sparkle effect
        document.addEventListener('mousemove', (e) => {
          if (Math.random() > 0.9) {
            createSparkle(e.clientX, e.clientY);
          }
        });

        function createSparkle(x, y) {
          const sparkle = document.createElement('div');
          sparkle.style.position = 'fixed';
          sparkle.style.left = x + 'px';
          sparkle.style.top = y + 'px';
          sparkle.style.width = '4px';
          sparkle.style.height = '4px';
          sparkle.style.background = 'white';
          sparkle.style.borderRadius = '50%';
          sparkle.style.pointerEvents = 'none';
          sparkle.style.zIndex = '9999';
          sparkle.style.animation = 'sparkle 1s ease-out forwards';
          
          document.body.appendChild(sparkle);
          
          setTimeout(() => {
            sparkle.remove();
          }, 1000);
        }

        // Add sparkle animation
        const style = document.createElement('style');
        style.textContent = \`
          @keyframes sparkle {
            0% { 
              opacity: 1; 
              transform: scale(0) rotate(0deg); 
            }
            50% { 
              opacity: 1; 
              transform: scale(1) rotate(180deg); 
            }
            100% { 
              opacity: 0; 
              transform: scale(0) rotate(360deg); 
            }
          }
        \`;
        document.head.appendChild(style);
      </script>
    </body>
    </html>
  `);
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