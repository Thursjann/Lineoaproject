const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'laundry.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
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
  }
};

// Initialize schema and seed data
async function initDatabase() {
  try {
    // Enable foreign keys
    await dbQuery.exec('PRAGMA foreign_keys = ON;');

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

    // Seed service rates if empty (categorized list)
    const ratesCount = await dbQuery.get('SELECT COUNT(*) as count FROM service_rates');
    if (ratesCount.count === 0) {
      const initialRates = [
        // 1. เสื้อผ้าทั่วไป
        { name: 'ซักพับ (Wash & Fold)', pricePerUnit: 10.00, unit: 'ชิ้น', category: 'เสื้อผ้าทั่วไป' },
        { name: 'ซักรีด (Wash & Iron)', pricePerUnit: 15.00, unit: 'ชิ้น', category: 'เสื้อผ้าทั่วไป' },
        
        // 2. เครื่องนอน & ผ้าผืนใหญ่
        { name: 'ซักพับ ผ้านวม/ผ้าห่ม', pricePerUnit: 80.00, unit: 'ผืน', category: 'เครื่องนอน & ผ้าผืนใหญ่' },
        { name: 'ซักแห้ง ผ้านวม/ผ้าห่ม', pricePerUnit: 150.00, unit: 'ผืน', category: 'เครื่องนอน & ผ้าผืนใหญ่' },
        
        // 3. บริการพิเศษ
        { name: 'ซักแห้ง สูท/เสื้อนอก', pricePerUnit: 120.00, unit: 'ชุด', category: 'บริการพิเศษ' },
        { name: 'ซักแห้ง รองเท้า/กระเป๋า', pricePerUnit: 180.00, unit: 'คู่', category: 'บริการพิเศษ' }
      ];

      for (const rate of initialRates) {
        await dbQuery.run(
          'INSERT INTO service_rates (name, pricePerUnit, unit, category) VALUES (?, ?, ?, ?)',
          [rate.name, rate.pricePerUnit, rate.unit, rate.category]
        );
      }
      console.log('Seeded initial categorized service rates.');
    }

    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
}

module.exports = {
  dbQuery,
  initDatabase
};
