const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "laundry.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

// Helper functions wrapping sqlite3 in Promises for async/await usage
const dbQuery = {
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  },

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  exec(sql) {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
};

// Initialize schema and seed data
async function initDatabase() {
  try {
    // Enable foreign keys
    await dbQuery.exec("PRAGMA foreign_keys = ON;");

    // 1. Create Customers Table
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

    // 2. Create Service Rates Table (Added: category)
    await dbQuery.exec(`
      CREATE TABLE IF NOT EXISTS service_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        pricePerUnit REAL NOT NULL,
        unit TEXT NOT NULL,
        category TEXT NOT NULL
      )
    `);

    // 3. Create Orders Table
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

    // 4. Create Order Items Table
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

    // Seed service rates if empty (categorized list - Synced with Dialogflow)
    const ratesCount = await dbQuery.get(
      "SELECT COUNT(*) as count FROM service_rates",
    );
    if (ratesCount.count === 0) {
      const initialRates = [
        // 1. เสื้อ (Tops)
        { name: "ซักพับ เสื้อยืด / เสื้อโปโล / เสื้อกล้าม", pricePerUnit: 20.0, unit: "ชิ้น", category: "เสื้อ" },
        { name: "ซักพับ เสื้อกันหนาว / เสื้อแขนยาว", pricePerUnit: 40.0, unit: "ชิ้น", category: "เสื้อ" },
        { name: "ซักรีด เสื้อยืด / เสื้อโปโล", pricePerUnit: 35.0, unit: "ชิ้น", category: "เสื้อ" },
        { name: "ซักรีด เสื้อเชิ้ตทำงาน", pricePerUnit: 45.0, unit: "ชิ้น", category: "เสื้อ" },
        { name: "ซักรีด เสื้อไหมพรม / เสื้อแฟชั่น", pricePerUnit: 60.0, unit: "ชิ้น", category: "เสื้อ" },

        // 2. กางเกง (Bottoms)
        { name: "ซักพับ กางเกงขาสั้น / ชุดนอน", pricePerUnit: 20.0, unit: "ชิ้น", category: "กางเกง" },
        { name: "ซักพับ กางเกงขายาว / ยีนส์ / วอร์ม", pricePerUnit: 30.0, unit: "ชิ้น", category: "กางเกง" },
        { name: "ซักรีด กางเกงขาสั้น", pricePerUnit: 35.0, unit: "ชิ้น", category: "กางเกง" },
        { name: "ซักรีด กางเกงขายาว / สแล็ค / ยีนส์", pricePerUnit: 45.0, unit: "ชิ้น", category: "กางเกง" },
        { name: "ซักรีด กระโปรงทั่วไป", pricePerUnit: 40.0, unit: "ชิ้น", category: "กางเกง" },
        { name: "ซักรีด กระโปรงพลีท (อัดกลีบ)", pricePerUnit: 60.0, unit: "ชิ้น", category: "กางเกง" },

        // 3. ชุดเครื่องนอน (Bedding)
        { name: "ซักพับ ปลอกหมอน / ปลอกหมอนข้าง", pricePerUnit: 20.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
        { name: "ซักพับ ผ้าปูที่นอน (3.5 / 5 / 6 ฟุต)", pricePerUnit: 80.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
        { name: "ซักพับ ผ้ารองกันเปื้อน", pricePerUnit: 100.0, unit: "ชิ้น", category: "ชุดเครื่องนอน" },
        { name: "ซักพับ ผ้านวม / ผ้าห่มนวมผืนใหญ่", pricePerUnit: 180.0, unit: "ผืน", category: "ชุดเครื่องนอน" },

        // 4. สูท & ชุดพิเศษ (Suits & Special)
        { name: "ซักรีด/ซักแห้ง เสื้อสูท / Blazer", pricePerUnit: 120.0, unit: "ชิ้น", category: "สูท" },
        { name: "ซักรีด/ซักแห้ง กางเกงสูท / กระโปรงสูท", pricePerUnit: 80.0, unit: "ชิ้น", category: "สูท" },
        { name: "ซักรีด/ซักแห้ง ชุดสูทเซ็ต (เสื้อ + กางเกง)", pricePerUnit: 180.0, unit: "ชุด", category: "สูท" },
        { name: "ซักรีด/ซักแห้ง เสื้อกั๊กสูท (Vest)", pricePerUnit: 60.0, unit: "ชิ้น", category: "สูท" },
        { name: "ซักรีด/ซักแห้ง ชุดราตรี / ชุดพิธีการ", pricePerUnit: 200.0, unit: "ชุด", category: "สูท" },
      ];

      for (const rate of initialRates) {
        await dbQuery.run(
          "INSERT INTO service_rates (name, pricePerUnit, unit, category) VALUES (?, ?, ?, ?)",
          [rate.name, rate.pricePerUnit, rate.unit, rate.category],
        );
      }
      console.log("Seeded initial categorized service rates.");
    }

    console.log("Database initialized successfully.");
  } catch (error) {
    console.error("Failed to initialize database:", error);
  }
}

module.exports = {
  dbQuery,
  initDatabase,
};
