const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

let useFirestore = false;
let db = null;

// Path to local Firebase Admin SDK JSON file
const serviceAccountPath = path.join(__dirname, "fitcheck-laundry-firebase-adminsdk-fbsvc-939bf48b6f.json");

if (fs.existsSync(serviceAccountPath) || process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    let serviceAccount;
    if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    } else {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    }

    if (!getApps().length) {
      initializeApp({
        credential: cert(serviceAccount)
      });
    }
    db = getFirestore();
    db.settings({ ignoreUndefinedProperties: true });
    useFirestore = true;
    console.log("=======================================================");
    console.log("🔥 Connected to Firebase Firestore Database successfully!");
    console.log("=======================================================");
  } catch (e) {
    console.error("⚠️ Failed to load Firebase credentials. Falling back to local SQLite:", e.message);
  }
}

// ----------------------------------------------------
// 2. Local SQLite Fallback Setup
// ----------------------------------------------------
let sqliteDb = null;
if (!useFirestore) {
  const dbPath = path.join(__dirname, "laundry.db");
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Error opening local SQLite:", err.message);
    else console.log("📁 Connected to local SQLite database.");
  });
}

// ----------------------------------------------------
// 3. Dual Database Adapter API (Firestore + SQLite Fallback)
// ----------------------------------------------------
const dbQuery = {
  // Run dynamic queries / writes
  async run(sql, params = []) {
    if (useFirestore) {
      // 1) Customer updates
      if (sql.includes("UPDATE customers SET displayName")) {
        const [displayName, pictureUrl, id] = params;
        await db.collection("customers").doc(id).set({
          displayName, pictureUrl: pictureUrl || ""
        }, { merge: true });
      } else if (sql.includes("UPDATE customers SET points")) {
        const id = params[params.length - 1];
        const docRef = db.collection("customers").doc(id);
        if (sql.includes("points = points + 1")) {
          await docRef.set({ points: FieldValue.increment(1) }, { merge: true });
        } else if (sql.includes("points = ?, couponCount = ?")) {
          await docRef.set({ points: params[0], couponCount: params[1] }, { merge: true });
        }
      }
      // 2) Order updates
      else if (sql.includes("UPDATE orders SET status = ?")) {
        const status = params[0];
        const id = params[1];
        await db.collection("orders").doc(id).update({ status });
      } else if (sql.includes("UPDATE orders SET pointsEarned = 1")) {
        const id = params[0];
        await db.collection("orders").doc(id).update({ pointsEarned: 1 });
      }
      // 3) Deletions
      else if (sql.includes("DELETE FROM orders WHERE id = ?")) {
        const id = params[0];
        await db.collection("orders").doc(id).delete();
        const items = await db.collection("order_items").where("orderId", "==", id).get();
        items.forEach(doc => doc.ref.delete());
      }
      // 4) Insertions
      else if (sql.includes("INSERT INTO customers")) {
        let id, displayName, pictureUrl, points, couponCount, createdAt;
        if (params.length === 5) {
          [id, displayName, pictureUrl, points, createdAt] = params;
          couponCount = 0;
        } else {
          [id, displayName, pictureUrl, points, couponCount, createdAt] = params;
        }
        await db.collection("customers").doc(id).set({
          id, displayName, pictureUrl: pictureUrl || "", points: points || 0, couponCount: couponCount || 0, createdAt
        }, { merge: true });
      } else if (sql.includes("INSERT INTO orders")) {
        const [id, customerId, latitude, longitude, deliveryDateTime, totalPrice, status, pointsEarned, deliveryMethod, paymentMethod, discountApplied, createdAt] = params;
        await db.collection("orders").doc(id).set({
          id, customerId, latitude, longitude, deliveryDateTime, totalPrice, status, pointsEarned, deliveryMethod, paymentMethod, discountApplied, createdAt
        });
      } else if (sql.includes("INSERT INTO order_items")) {
        const [orderId, serviceType, itemCount, price] = params;
        await db.collection("order_items").add({ orderId, serviceType, itemCount, price });
      }
      return { id: 1, changes: 1 };
    }

    // Local SQLite fallback
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  },

  async get(sql, params = []) {
    if (useFirestore) {
      if (sql.includes("FROM customers WHERE id = ?")) {
        const doc = await db.collection("customers").doc(params[0]).get();
        return doc.exists ? doc.data() : undefined;
      }
      if (sql.includes("FROM customers ORDER BY createdAt DESC LIMIT 1")) {
        const snap = await db.collection("customers").orderBy("createdAt", "desc").limit(1).get();
        return snap.empty ? undefined : snap.docs[0].data();
      }
      if (sql.includes("FROM orders WHERE id = ?")) {
        const doc = await db.collection("orders").doc(params[0]).get();
        return doc.exists ? doc.data() : undefined;
      }
      if (sql.includes("FROM orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1")) {
        const snap = await db.collection("orders").where("customerId", "==", params[0]).get();
        if (snap.empty) return undefined;
        const docs = snap.docs.map(doc => doc.data());
        docs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return docs[0];
      }
      if (sql.includes("FROM orders ORDER BY createdAt DESC LIMIT 1")) {
        const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(1).get();
        return snap.empty ? undefined : snap.docs[0].data();
      }
    }

    // Local SQLite fallback
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  async all(sql, params = []) {
    if (useFirestore) {
      if (sql.includes("FROM service_rates")) {
        const snap = await db.collection("service_rates").get();
        return snap.docs.map(doc => doc.data());
      }
      if (sql.includes("FROM customers")) {
        const snap = await db.collection("customers").get();
        return snap.docs.map(doc => doc.data());
      }
      if (sql.includes("FROM orders WHERE customerId = ?")) {
        const snap = await db.collection("orders").where("customerId", "==", params[0]).get();
        return snap.docs.map(doc => doc.data());
      }
      if (sql.includes("FROM orders")) {
        const snap = await db.collection("orders").orderBy("createdAt", "desc").get();
        const ordersList = snap.docs.map(doc => doc.data());
        
        if (sql.includes("LEFT JOIN customers")) {
          for (let order of ordersList) {
            if (order.customerId) {
              const custDoc = await db.collection("customers").doc(order.customerId).get();
              if (custDoc.exists) {
                const cData = custDoc.data();
                order.displayName = cData.displayName || order.displayName;
                order.pictureUrl = cData.pictureUrl || order.pictureUrl;
                order.points = cData.points !== undefined ? cData.points : order.points;
              }
            }
          }
        }
        return ordersList;
      }
      if (sql.includes("FROM order_items WHERE orderId = ?")) {
        const snap = await db.collection("order_items").where("orderId", "==", params[0]).get();
        return snap.docs.map(doc => doc.data());
      }
    }

    // Local SQLite fallback
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  async exec(sql) {
    if (useFirestore) return;
    return new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};

// ----------------------------------------------------
// 4. Initialize Database Schemas & Initial Rates
// ----------------------------------------------------
async function initDatabase() {
  const initialRates = [
    { id: 1, name: "ซักพับ เสื้อยืด / เสื้อโปโล / เสื้อกล้าม", pricePerUnit: 20.0, unit: "ชิ้น", category: "เสื้อ" },
    { id: 2, name: "ซักพับ เสื้อกันหนาว / เสื้อแขนยาว", pricePerUnit: 40.0, unit: "ชิ้น", category: "เสื้อ" },
    { id: 3, name: "ซักรีด เสื้อยืด / เสื้อโปโล", pricePerUnit: 35.0, unit: "ชิ้น", category: "เสื้อ" },
    { id: 4, name: "ซักรีด เสื้อเชิ้ตทำงาน", pricePerUnit: 45.0, unit: "ชิ้น", category: "เสื้อ" },
    { id: 5, name: "ซักรีด เสื้อไหมพรม / เสื้อแฟชั่น", pricePerUnit: 60.0, unit: "ชิ้น", category: "เสื้อ" },
    { id: 6, name: "ซักพับ กางเกงขาสั้น / ชุดนอน", pricePerUnit: 20.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 7, name: "ซักพับ กางเกงขายาว / ยีนส์ / วอร์ม", pricePerUnit: 30.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 8, name: "ซักรีด กางเกงขาสั้น", pricePerUnit: 35.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 9, name: "ซักรีด กางเกงขายาว / สแล็ค / ยีนส์", pricePerUnit: 45.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 10, name: "ซักรีด กระโปรงทั่วไป", pricePerUnit: 40.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 11, name: "ซักรีด กระโปรงพลีท (อัดกลีบ)", pricePerUnit: 60.0, unit: "ชิ้น", category: "กางเกง" },
    { id: 12, name: "ซักพับ ปลอกหมอน / ปลอกหมอนข้าง", pricePerUnit: 20.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
    { id: 13, name: "ซักพับ ผ้าปูที่นอน (3.5 / 5 / 6 ฟุต)", pricePerUnit: 80.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
    { id: 14, name: "ซักพับ ผ้ารองกันเปื้อน", pricePerUnit: 100.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
    { id: 15, name: "ซักพับ ผ้านวม / ผ้าห่มนวมผืนใหญ่", pricePerUnit: 180.0, unit: "ผืน", category: "ชุดเครื่องนอน" },
    { id: 16, name: "ซักรีด/ซักแห้ง เสื้อสูท / Blazer", pricePerUnit: 120.0, unit: "ชิ้น", category: "สูท" },
    { id: 17, name: "ซักรีด/ซักแห้ง กางเกงสูท / กระโปรงสูท", pricePerUnit: 80.0, unit: "ชิ้น", category: "สูท" },
    { id: 18, name: "ซักรีด/ซักแห้ง ชุดสูทเซ็ต (เสื้อ + กางเกง)", pricePerUnit: 180.0, unit: "ชุด", category: "สูท" },
    { id: 19, name: "ซักรีด/ซักแห้ง เสื้อกั๊กสูท (Vest)", pricePerUnit: 60.0, unit: "ชิ้น", category: "สูท" },
    { id: 20, name: "ซักรีด/ซักแห้ง ชุดราตรี / ชุดพิธีการ", pricePerUnit: 200.0, unit: "ชุด", category: "สูท" }
  ];

  if (useFirestore) {
    const ratesCollection = db.collection("service_rates");
    const snap = await ratesCollection.get();
    if (snap.empty) {
      for (const rate of initialRates) {
        await ratesCollection.doc(String(rate.id)).set(rate);
      }
      console.log("🔥 Seeded initial service rates to Firebase Firestore!");
    }
    return;
  }

  // SQLite fallback initialization
  try {
    await dbQuery.exec("PRAGMA foreign_keys = ON;");
    await dbQuery.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        displayName TEXT,
        pictureUrl TEXT,
        points INTEGER DEFAULT 0,
        couponCount INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL
      )
    `);
    await dbQuery.exec(`
      CREATE TABLE IF NOT EXISTS service_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        pricePerUnit REAL NOT NULL,
        unit TEXT NOT NULL,
        category TEXT NOT NULL
      )
    `);
    await dbQuery.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customerId TEXT,
        latitude REAL,
        longitude REAL,
        deliveryDateTime TEXT NOT NULL,
        totalPrice REAL NOT NULL,
        status TEXT NOT NULL,
        pointsEarned INTEGER DEFAULT 0,
        deliveryMethod TEXT DEFAULT 'pickup',
        paymentMethod TEXT DEFAULT 'cash',
        discountApplied REAL DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (customerId) REFERENCES customers(id)
      )
    `);
    await dbQuery.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId TEXT NOT NULL,
        serviceType TEXT NOT NULL,
        itemCount INTEGER NOT NULL,
        price REAL NOT NULL,
        FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);

    await dbQuery.run("DELETE FROM service_rates");
    for (const rate of initialRates) {
      await dbQuery.run(
        "INSERT INTO service_rates (name, pricePerUnit, unit, category) VALUES (?, ?, ?, ?)",
        [rate.name, rate.pricePerUnit, rate.unit, rate.category],
      );
    }
  } catch (err) {
    console.error("Local SQLite setup error:", err);
  }
}

module.exports = {
  dbQuery,
  initDatabase,
};
